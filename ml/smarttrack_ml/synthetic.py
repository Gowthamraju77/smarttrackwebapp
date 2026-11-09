"""Deterministic, clearly labelled synthetic telemetry for local demos/tests."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
import random
from typing import Any


MAX_SYNTHETIC_RECORDS = 10_000


def _count(value: Any, name: str, *, maximum: int = MAX_SYNTHETIC_RECORDS) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0 or value > maximum:
        raise ValueError(f"{name} must be an integer in [0, {maximum}]")
    return value


def generate_records(count: int = 20, *, seed: int = 0, journeys: int = 2, scenario: str = "normal") -> list[dict[str, Any]]:
    """Generate finite wire-v1 records without reading external data.

    Coordinates are a fixed equatorial synthetic fixture and are not a route or
    a real person's location.  The timestamp is fixed so equal seeds reproduce
    byte-for-byte JSON after normal serialization.  ``scenario`` can be
    ``normal``, ``no_fix``, ``stale_gps``, ``missing_imu`` or ``unsynced``.
    """
    _count(count, "count")
    _count(journeys, "journeys", maximum=100)
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise ValueError("seed must be an integer")
    if scenario not in {"normal", "no_fix", "stale_gps", "missing_imu", "unsynced"}:
        raise ValueError("unsupported synthetic scenario")
    if count == 0:
        return []
    if journeys < 1:
        raise ValueError("journeys must be at least one when count is nonzero")
    rng = random.Random(seed)
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    records: list[dict[str, Any]] = []
    for index in range(count):
        journey = index % journeys
        sequence = index // journeys + 1
        # Fixed synthetic offsets, with tiny seeded variation in speed only.
        speed = 8.0 + rng.random() * 4.0
        captured = start + timedelta(seconds=sequence)
        gps: dict[str, Any] = {
            "fix": True,
            "lat": 0.0,
            "lon": 0.00005 * sequence,
            "speed_mps": speed,
            "hdop": 1.0,
            "age_ms": 0,
        }
        imu: dict[str, Any] | None = {"accel_mps2": 0.0, "gyro_dps": 0.0}
        recorded_at: str | None = captured.isoformat()
        if scenario == "no_fix":
            gps.update({"fix": False, "lat": None, "lon": None, "speed_mps": None, "hdop": None, "age_ms": None})
        elif scenario == "stale_gps":
            gps["age_ms"] = 10_001
        elif scenario == "missing_imu":
            imu = None
        elif scenario == "unsynced":
            recorded_at = None
        records.append({
            "version": 1,
            "device_id": "synthetic-device",
            "record_id": f"synthetic-record-{index + 1}",
            "boot_id": f"synthetic-boot-{journey + 1}",
            "sequence": sequence,
            "uptime_ms": sequence * 1000,
            "recorded_at": recorded_at,
            "received_at": (captured + timedelta(seconds=1)).isoformat(),
            "gps": gps,
            "imu": imu,
        })
    return records


def generate_training_examples(count: int = 20, *, seed: int = 0, journeys: int = 2, scenario: str = "normal") -> list[dict[str, Any]]:
    """Return explicitly grouped current/previous pairs for local training."""
    records = generate_records(count, seed=seed, journeys=journeys, scenario=scenario)
    previous_by_journey: dict[str, dict[str, Any]] = {}
    examples: list[dict[str, Any]] = []
    for record in records:
        group_id = record["boot_id"]
        previous = previous_by_journey.get(group_id)
        previous_by_journey[group_id] = record
        if previous is not None:
            examples.append({"record": record, "previous": previous, "group_id": group_id})
    return examples


def generate_dataset(count: int = 20, *, seed: int = 0, journeys: int = 2, scenario: str = "normal") -> dict[str, Any]:
    """Return records plus provenance metadata; never implies production data."""
    return {
        "synthetic": True,
        "provenance": "synthetic",
        "seed": seed,
        "records": generate_records(count, seed=seed, journeys=journeys, scenario=scenario),
        "examples": generate_training_examples(count, seed=seed, journeys=journeys, scenario=scenario),
    }


__all__ = ["generate_dataset", "generate_records", "generate_training_examples"]
