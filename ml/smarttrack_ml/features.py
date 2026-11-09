"""Dependency-free, location-free telemetry features (schema version 1).

K6 adapter contract
-------------------
``extract_features(record, previous=None)`` accepts decoded wire-v1 telemetry
mappings, optionally including the server's ``received_at`` timestamp. It returns
exactly ``features`` (dict[str, float]), ``reasons`` (list[str]), ``quality``
(dict[str, float]), and ``available`` (bool). All numbers returned are finite.
No coordinate, identifier, or absolute timestamp is included in model inputs.

An available result contains every name in ``FEATURE_NAMES``. Vectorize explicitly
as ``[result["features"][name] for name in FEATURE_NAMES]`` **only after checking
``result["available"]``; persist this ordered schema with the model artifact.
Unavailable results contain only observed/derivable features, never zero-filled
missing sensors. A first record needs a predecessor before paired inference.
``quality`` contains independent heuristic reliability factors in [0, 1], not
safety probabilities. A factor of 1 means no detected penalty, not proven accuracy.

All dimensions are SI: metres, seconds, m/s, m/s^2 and rad/s; HDOP is dimensionless.
The wire's milliseconds and degrees/second are converted. ``distance_m`` is a
haversine endpoint displacement, not travelled route length. ``implied_speed_mps``
is displacement / capture interval; ``speed_delta_mps`` and ``gps_accel_mps2``
use the change in reported GPS speed, not a speed inferred from accelerometer data.
``gps_speed_residual_mps`` compares displacement speed with mean endpoint speed.

The wire does not specify accelerometer orientation or gravity compensation.
``gps_imu_accel_excess_mps2`` is therefore only a conservative *heuristic*: GPS
|delta speed / delta time| above max(endpoint |IMU acceleration|) + standard gravity.
It is not a physical bound on acceleration between samples or a calibrated error.
IMU endpoint changes are also exposed for a trained model. Zero acceleration (or
constant gravity) never implies zero velocity; constant-speed travel is compatible
with either. No stationary/moving classification is inferred from scalar IMU data.

Within a boot, monotonic uptime defines the capture interval; UTC timestamps, when
both supplied, must agree within max(2 s, 5% of the interval). Across boots UTC is
required. Reception time never defines velocity. Unsynced clocks can use same-boot
uptime and carry reduced clock/delivery confidence. Missing reception time means
delivery freshness is unknown, not current. Extraction is deterministic and does
not compare historical training records with the machine's current wall clock.

Policy constants below are explicit heuristics, not learned thresholds: GPS ages
over 10 s and predecessor gaps over 60 s block inference. Delivery over 30 s is
delayed (downweighted), over 300 s is stale (unavailable). A synchronized capture
more than 2 s after reception is invalid. Missing IMU, invalid numbers (including
booleans), wrong device history, duplicates and non-increasing capture chronology
also make inference unavailable. This module neither authenticates telemetry nor
promotes/trains a model; availability is feature availability, not ML availability.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
import math
from typing import Any


FEATURE_SCHEMA_VERSION = 1
EARTH_RADIUS_M = 6_371_008.8
STANDARD_GRAVITY_MPS2 = 9.80665
MAX_GPS_AGE_S = 10.0
MAX_PAIR_INTERVAL_S = 60.0
DELAYED_AFTER_S = 30.0
STALE_AFTER_S = 300.0
CLOCK_TOLERANCE_S = 2.0
MAX_SAFE_INTEGER = 9_007_199_254_740_991

FEATURE_NAMES = (
    "gps_speed_mps",
    "gps_hdop",
    "gps_age_s",
    "imu_accel_mps2",
    "imu_gyro_rad_s",
    "delta_s",
    "distance_m",
    "implied_speed_mps",
    "speed_delta_mps",
    "gps_accel_mps2",
    "gps_speed_residual_mps",
    "imu_accel_delta_mps2",
    "imu_gyro_delta_rad_s",
    "gps_imu_accel_excess_mps2",
)

QUALITY_NAMES = (
    "input_validity",
    "gps_fix",
    "gps_freshness",
    "gps_precision",
    "imu",
    "chronology",
    "clock",
    "delivery",
    "gps_imu_consistency",
)


@dataclass(frozen=True)
class _Sample:
    valid: bool
    device_id: str | None
    record_id: str | None
    boot_id: str | None
    sequence: float | None
    uptime_ms: float | None
    recorded_at: datetime | None
    received_at: datetime | None
    fix: bool
    lat: float | None
    lon: float | None
    speed: float | None
    hdop: float | None
    age_s: float | None
    accel: float | None
    gyro: float | None

    @property
    def gps_usable(self) -> bool:
        return (
            self.fix
            and all(value is not None for value in (self.lat, self.lon, self.speed, self.hdop, self.age_s))
            and self.age_s <= MAX_GPS_AGE_S
        )

    @property
    def imu_usable(self) -> bool:
        return self.accel is not None and self.gyro is not None


def _number(
    source: Mapping[str, Any],
    key: str,
    code: str,
    reasons: list[str],
    *,
    minimum: float | None = None,
    maximum: float | None = None,
    integer: bool = False,
    required: bool = True,
) -> float | None:
    value = source.get(key)
    if value is None:
        if required:
            reasons.append(code + "_missing")
        return None
    # bool subclasses int in Python; coercing strings/bools would hide bad input.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        reasons.append(code + "_invalid")
        return None
    try:
        value = float(value)
    except (ValueError, OverflowError):
        reasons.append(code + "_invalid")
        return None
    if (
        not math.isfinite(value)
        or (minimum is not None and value < minimum)
        or (maximum is not None and value > maximum)
        or (integer and not value.is_integer())
    ):
        reasons.append(code + "_invalid")
        return None
    return value


def _identifier(source: Mapping[str, Any], key: str, prefix: str, reasons: list[str]) -> str | None:
    value = source.get(key)
    if not isinstance(value, str) or not value.strip():
        reasons.append(prefix + key + ("_missing" if value is None else "_invalid"))
        return None
    return value


def _timestamp(value: Any, code: str, reasons: list[str]) -> datetime | None:
    if value is None:
        reasons.append(code + "_missing")
        return None
    if isinstance(value, str):
        try:
            stamp = datetime.fromisoformat(value[:-1] + "+00:00" if value.endswith("Z") else value)
            if stamp.tzinfo is not None and stamp.utcoffset() is not None:
                return stamp.astimezone(timezone.utc)
        except (ValueError, OverflowError):
            pass
    reasons.append(code + "_invalid")
    return None


def _parse(record: Any, prefix: str, reasons: list[str]) -> _Sample | None:
    if not isinstance(record, Mapping):
        reasons.append(prefix + "record_invalid")
        return None
    start = len(reasons)
    version = _number(record, "version", prefix + "version", reasons, integer=True)
    if version is not None and version != 1:
        reasons.append(prefix + "version_unsupported")
    device_id = _identifier(record, "device_id", prefix, reasons)
    record_id = _identifier(record, "record_id", prefix, reasons)
    boot_id = _identifier(record, "boot_id", prefix, reasons)
    sequence = _number(record, "sequence", prefix + "sequence", reasons, minimum=0, maximum=MAX_SAFE_INTEGER, integer=True)
    uptime_ms = _number(record, "uptime_ms", prefix + "uptime_ms", reasons, minimum=0, maximum=MAX_SAFE_INTEGER)
    recorded_at = _timestamp(record.get("recorded_at"), prefix + "recorded_at", reasons)
    received_at = _timestamp(record.get("received_at"), prefix + "received_at", reasons)

    gps = record.get("gps")
    if not isinstance(gps, Mapping):
        reasons.append(prefix + ("gps_missing" if gps is None else "gps_invalid"))
        gps = {}
    fix = gps.get("fix")
    if type(fix) is not bool:
        reasons.append(prefix + ("gps_fix_missing" if fix is None else "gps_fix_invalid"))
    elif not fix:
        reasons.append(prefix + "gps_no_fix")
    fix = fix is True
    lat = _number(gps, "lat", prefix + "gps_lat", reasons, minimum=-90, maximum=90, required=fix)
    lon = _number(gps, "lon", prefix + "gps_lon", reasons, minimum=-180, maximum=180, required=fix)
    speed = _number(gps, "speed_mps", prefix + "gps_speed_mps", reasons, minimum=0, required=fix)
    hdop = _number(gps, "hdop", prefix + "gps_hdop", reasons, minimum=0, required=fix)
    if hdop == 0:
        reasons.append(prefix + "gps_hdop_invalid")
        hdop = None
    age_ms = _number(gps, "age_ms", prefix + "gps_age_ms", reasons, minimum=0, required=fix)
    age_s = age_ms / 1000.0 if age_ms is not None else None
    if age_s is not None and age_s > MAX_GPS_AGE_S:
        reasons.append(prefix + "gps_stale")

    imu = record.get("imu")
    if not isinstance(imu, Mapping):
        reasons.append(prefix + ("imu_missing" if imu is None else "imu_invalid"))
        accel = gyro = None
    else:
        accel = _number(imu, "accel_mps2", prefix + "imu_accel_mps2", reasons)
        gyro_dps = _number(imu, "gyro_dps", prefix + "imu_gyro_dps", reasons)
        gyro = math.radians(gyro_dps) if gyro_dps is not None else None

    valid = (
        version == 1
        and all(value is not None for value in (device_id, record_id, boot_id, sequence, uptime_ms))
        and not any(reason.endswith(("_invalid", "_unsupported")) for reason in reasons[start:])
    )
    return _Sample(valid, device_id, record_id, boot_id, sequence, uptime_ms, recorded_at, received_at,
                   fix, lat, lon, speed, hdop, age_s, accel, gyro)


def _interval(current: _Sample, previous: _Sample, reasons: list[str]) -> float | None:
    if not current.valid or not previous.valid:
        return None
    if current.device_id != previous.device_id:
        reasons.append("previous_device_mismatch")
        return None
    if current.record_id == previous.record_id:
        reasons.append("duplicate_record")
        return None

    wall_delta = None
    if current.recorded_at is not None and previous.recorded_at is not None:
        wall_delta = (current.recorded_at - previous.recorded_at).total_seconds()
        if wall_delta <= 0:
            reasons.append("duplicate_recorded_at" if wall_delta == 0 else "out_of_order_recorded_at")
            return None

    if current.boot_id == previous.boot_id:
        if current.sequence <= previous.sequence:
            reasons.append("duplicate_sequence" if current.sequence == previous.sequence else "out_of_order_sequence")
            return None
        delta = (current.uptime_ms - previous.uptime_ms) / 1000.0
        if delta <= 0:
            reasons.append("duplicate_uptime" if delta == 0 else "out_of_order_uptime")
            return None
        if wall_delta is not None and abs(wall_delta - delta) > max(CLOCK_TOLERANCE_S, delta * 0.05):
            reasons.append("clock_discontinuity")
            return None
        if wall_delta is None:
            reasons.append("uptime_clock_used")
        if current.sequence - previous.sequence > 1:
            reasons.append("sequence_gap")
    else:
        reasons.append("boot_changed")
        if wall_delta is None:
            reasons.append("chronology_unavailable")
            return None
        delta = wall_delta

    if delta > MAX_PAIR_INTERVAL_S:
        reasons.append("previous_stale")
        return None
    return delta


def _distance_m(current: _Sample, previous: _Sample) -> float:
    lat1, lat2 = math.radians(previous.lat), math.radians(current.lat)
    dlat = lat2 - lat1
    dlon = math.radians(current.lon - previous.lon)
    haversine = math.sin(dlat / 2.0) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2.0) ** 2
    # Round-off near antipodes must not create sqrt(negative) or asin(>1).
    return 2.0 * EARTH_RADIUS_M * math.asin(math.sqrt(min(1.0, max(0.0, haversine))))


def _delivery(current: _Sample, reasons: list[str]) -> tuple[float, bool]:
    if current.recorded_at is None or current.received_at is None:
        return 0.5, True  # Explicit unknown confidence; no wall-clock freshness claim.
    delay = (current.received_at - current.recorded_at).total_seconds()
    if delay < -CLOCK_TOLERANCE_S:
        reasons.append("recorded_at_in_future")
        return 0.0, False
    if delay > STALE_AFTER_S:
        reasons.append("record_stale")
        return 0.0, False
    if delay > DELAYED_AFTER_S:
        reasons.append("delivery_delayed")
        return DELAYED_AFTER_S / delay, True
    return 1.0, True


def extract_features(record: Mapping[str, Any], previous: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """Return the documented feature/evidence contract without mutating inputs.

    Invalid/missing telemetry returns ``available=False`` and stable reason codes,
    not an exception or fabricated zero readings. A usable paired result has all
    ``FEATURE_NAMES``. See the module docstring for K6 vectorization and semantics.
    """
    features: dict[str, float] = {}
    reasons: list[str] = []
    quality = dict.fromkeys(QUALITY_NAMES, 0.0)
    result = {"features": features, "reasons": reasons, "quality": quality, "available": False}
    current = _parse(record, "", reasons)
    if current is None:
        return result

    def add(name: str, value: float | None) -> None:
        if value is not None:
            if math.isfinite(value):
                features[name] = float(value)
            else:
                reasons.append(name + "_overflow")

    if current.fix:
        add("gps_speed_mps", current.speed)
        add("gps_hdop", current.hdop)
        add("gps_age_s", current.age_s)
    add("imu_accel_mps2", current.accel)
    add("imu_gyro_rad_s", current.gyro)
    quality["input_validity"] = float(current.valid)
    quality["gps_fix"] = float(current.fix and current.lat is not None and current.lon is not None)
    quality["gps_freshness"] = 1.0 / (1.0 + current.age_s / MAX_GPS_AGE_S) if current.gps_usable else 0.0
    quality["gps_precision"] = min(1.0, 1.0 / current.hdop) if current.fix and current.hdop is not None else 0.0
    quality["imu"] = float(current.imu_usable)
    quality["clock"] = 1.0 if current.recorded_at is not None else 0.5
    quality["delivery"], delivery_usable = _delivery(current, reasons)

    if previous is None:
        reasons.append("previous_missing")
        return result
    prior = _parse(previous, "previous_", reasons)
    if prior is None:
        quality["input_validity"] = 0.0
        return result
    quality["input_validity"] = float(current.valid and prior.valid)
    quality["gps_fix"] *= float(prior.fix and prior.lat is not None and prior.lon is not None)
    quality["gps_freshness"] = min(quality["gps_freshness"], 1.0 / (1.0 + prior.age_s / MAX_GPS_AGE_S) if prior.gps_usable else 0.0)
    quality["gps_precision"] = min(quality["gps_precision"], min(1.0, 1.0 / prior.hdop) if prior.fix and prior.hdop is not None else 0.0)
    quality["imu"] *= float(prior.imu_usable)
    quality["clock"] = min(quality["clock"], 1.0 if prior.recorded_at is not None else 0.5)
    if current.received_at is not None and prior.received_at is not None and current.received_at < prior.received_at:
        reasons.append("delivery_reordered")
        quality["delivery"] = min(quality["delivery"], 0.5)

    delta = _interval(current, prior, reasons)
    if delta is None:
        return result
    quality["chronology"] = 0.5 if "sequence_gap" in reasons or "boot_changed" in reasons else 1.0
    add("delta_s", delta)
    if current.gps_usable and prior.gps_usable:
        distance = _distance_m(current, prior)
        implied_speed = distance / delta
        speed_delta = current.speed - prior.speed
        add("distance_m", distance)
        add("implied_speed_mps", implied_speed)
        add("speed_delta_mps", speed_delta)
        add("gps_accel_mps2", speed_delta / delta)
        add("gps_speed_residual_mps", abs(implied_speed - (current.speed / 2.0 + prior.speed / 2.0)))
    if current.imu_usable and prior.imu_usable:
        add("imu_accel_delta_mps2", current.accel - prior.accel)
        add("imu_gyro_delta_rad_s", current.gyro - prior.gyro)
        if "gps_accel_mps2" in features:
            excess = max(0.0, abs(features["gps_accel_mps2"]) - max(abs(current.accel), abs(prior.accel)) - STANDARD_GRAVITY_MPS2)
            add("gps_imu_accel_excess_mps2", excess)
            quality["gps_imu_consistency"] = 1.0 / (1.0 + excess / 5.0)
            if excess > 5.0:
                reasons.append("gps_imu_accel_disagreement")

    result["available"] = (
        current.valid and prior.valid and delivery_usable
        and current.gps_usable and prior.gps_usable
        and all(name in features for name in FEATURE_NAMES)
    )
    return result
