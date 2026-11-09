"""Isolated synthetic feature tests: python -B -m unittest discover -s ml/tests -p test_features.py -v."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
import math
from pathlib import Path
import sys
import unittest


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from smarttrack_ml import FEATURE_NAMES, FEATURE_SCHEMA_VERSION, extract_features
from smarttrack_ml.features import EARTH_RADIUS_M, QUALITY_NAMES, STANDARD_GRAVITY_MPS2


def sample(sequence=1, *, seconds=None, lat=0.0, lon=0.0, speed=10.0, accel=0.0, gyro=0.0):
    """Entirely artificial equatorial samples; never user location history."""
    seconds = sequence if seconds is None else seconds
    captured = datetime(2026, 1, 1, tzinfo=timezone.utc) + timedelta(seconds=seconds)
    return {
        "version": 1,
        "device_id": "synthetic-device",
        "record_id": f"synthetic-record-{sequence}",
        "boot_id": "synthetic-boot",
        "sequence": sequence,
        "uptime_ms": seconds * 1000,
        "recorded_at": captured.isoformat(),
        "received_at": (captured + timedelta(seconds=1)).isoformat(),
        "gps": {"fix": True, "lat": lat, "lon": lon, "speed_mps": speed, "hdop": 1.0, "age_ms": 0},
        "imu": {"accel_mps2": accel, "gyro_dps": gyro},
    }


class FeatureTests(unittest.TestCase):
    def assert_contract(self, result):
        self.assertEqual(set(result), {"features", "reasons", "quality", "available"})
        self.assertIs(type(result["available"]), bool)
        self.assertIsInstance(result["features"], dict)
        self.assertIsInstance(result["reasons"], list)
        self.assertTrue(all(isinstance(reason, str) for reason in result["reasons"]))
        self.assertEqual(set(result["quality"]), set(QUALITY_NAMES))
        for value in result["features"].values():
            self.assertIs(type(value), float)
            self.assertTrue(math.isfinite(value))
        for value in result["quality"].values():
            self.assertIs(type(value), float)
            self.assertTrue(0 <= value <= 1)
        self.assertTrue(set(result["features"]).issubset(FEATURE_NAMES))
        if result["available"]:
            self.assertEqual(set(result["features"]), set(FEATURE_NAMES))
        json.dumps(result, allow_nan=False)

    def test_pair_uses_haversine_si_units_and_ordered_schema(self):
        previous = sample(1, gyro=90.0)
        current = sample(2, lon=math.degrees(10.0 / EARTH_RADIUS_M), gyro=180.0)
        result = extract_features(current, previous)
        self.assert_contract(result)
        self.assertTrue(result["available"])
        self.assertEqual(FEATURE_SCHEMA_VERSION, 1)
        features = result["features"]
        self.assertAlmostEqual(features["distance_m"], 10.0, places=7)
        self.assertAlmostEqual(features["implied_speed_mps"], 10.0, places=7)
        self.assertAlmostEqual(features["gps_speed_residual_mps"], 0.0, places=7)
        self.assertEqual(features["delta_s"], 1.0)
        self.assertAlmostEqual(features["imu_gyro_rad_s"], math.pi)
        self.assertAlmostEqual(features["imu_gyro_delta_rad_s"], math.pi / 2.0)
        self.assertEqual(len([features[name] for name in FEATURE_NAMES]), len(FEATURE_NAMES))

    def test_constant_speed_is_compatible_with_zero_acceleration_or_gravity(self):
        for accel in (0.0, STANDARD_GRAVITY_MPS2):
            with self.subTest(accel=accel):
                previous = sample(1, speed=25.0, accel=accel)
                current = sample(2, lon=math.degrees(25.0 / EARTH_RADIUS_M), speed=25.0, accel=accel)
                result = extract_features(current, previous)
                self.assertTrue(result["available"])
                self.assertAlmostEqual(result["features"]["implied_speed_mps"], 25.0)
                self.assertEqual(result["features"]["gps_accel_mps2"], 0.0)
                self.assertEqual(result["features"]["gps_imu_accel_excess_mps2"], 0.0)
                self.assertNotIn("gps_imu_accel_disagreement", result["reasons"])
                self.assertEqual(result["quality"]["gps_imu_consistency"], 1.0)

    def test_speed_change_not_absolute_speed_drives_imu_consistency(self):
        previous = sample(1, speed=1.0)
        current = sample(2, speed=50.0)
        result = extract_features(current, previous)
        self.assertTrue(result["available"])
        self.assertEqual(result["features"]["speed_delta_mps"], 49.0)
        self.assertEqual(result["features"]["gps_accel_mps2"], 49.0)
        self.assertAlmostEqual(result["features"]["gps_imu_accel_excess_mps2"], 49.0 - STANDARD_GRAVITY_MPS2)
        self.assertIn("gps_imu_accel_disagreement", result["reasons"])
        self.assertLess(result["quality"]["gps_imu_consistency"], 1.0)
        braking = extract_features(sample(2, speed=1.0), sample(1, speed=50.0))
        self.assertEqual(braking["features"]["gps_accel_mps2"], -49.0)
        self.assertEqual(braking["features"]["gps_imu_accel_excess_mps2"], result["features"]["gps_imu_accel_excess_mps2"])

    def test_antimeridian_poles_and_antipodes_remain_finite(self):
        cases = (
            (0.0, 179.999, 0.0, -179.999, math.radians(0.002) * EARTH_RADIUS_M),
            (0.0, 0.0, 0.0, 180.0, math.pi * EARTH_RADIUS_M),
            (90.0, 0.0, 90.0, 180.0, 0.0),
        )
        for lat1, lon1, lat2, lon2, expected in cases:
            with self.subTest(case=(lat1, lon1, lat2, lon2)):
                result = extract_features(sample(2, lat=lat2, lon=lon2), sample(1, lat=lat1, lon=lon1))
                self.assert_contract(result)
                self.assertTrue(result["available"])
                self.assertAlmostEqual(result["features"]["distance_m"], expected, places=5)

    def test_single_sample_is_partial_not_zero_filled(self):
        result = extract_features(sample())
        self.assert_contract(result)
        self.assertFalse(result["available"])
        self.assertIn("previous_missing", result["reasons"])
        self.assertNotIn("distance_m", result["features"])
        self.assertNotIn("gps_accel_mps2", result["features"])

    def test_bad_numeric_types_are_not_coerced(self):
        paths = (
            ("version",), ("sequence",), ("uptime_ms",),
            ("gps", "lat"), ("gps", "lon"), ("gps", "speed_mps"),
            ("gps", "hdop"), ("gps", "age_ms"),
            ("imu", "accel_mps2"), ("imu", "gyro_dps"),
        )
        for path in paths:
            for bad in (True, False, "1", float("nan"), float("inf"), -float("inf"), 10**400, [], {}):
                with self.subTest(path=path, bad=repr(bad)):
                    current = sample(2)
                    target = current if len(path) == 1 else current[path[0]]
                    target[path[-1]] = bad
                    result = extract_features(current, sample(1))
                    self.assert_contract(result)
                    self.assertFalse(result["available"])
                    self.assertEqual(result["quality"]["input_validity"], 0.0)
                    self.assertTrue(any(reason.endswith("_invalid") for reason in result["reasons"]))

    def test_invalid_ranges_are_rejected(self):
        cases = (
            ("gps", "lat", 90.01), ("gps", "lat", -90.01),
            ("gps", "lon", 180.01), ("gps", "lon", -180.01),
            ("gps", "speed_mps", -0.01), ("gps", "hdop", 0),
            ("gps", "hdop", -1), ("gps", "age_ms", -1),
            (None, "sequence", -1), (None, "sequence", 1.1),
            (None, "uptime_ms", -1), (None, "version", 2),
        )
        for section, name, bad in cases:
            with self.subTest(field=name, bad=bad):
                current = sample(2)
                (current[section] if section else current)[name] = bad
                result = extract_features(current, sample(1))
                self.assert_contract(result)
                self.assertFalse(result["available"])

    def test_no_fix_or_non_boolean_fix_never_supplies_gps_motion(self):
        for fix in (False, None, 0, 1, "true"):
            with self.subTest(fix=fix):
                current = sample(2)
                current["gps"]["fix"] = fix
                result = extract_features(current, sample(1))
                self.assert_contract(result)
                self.assertFalse(result["available"])
                self.assertNotIn("gps_speed_mps", result["features"])
                self.assertNotIn("implied_speed_mps", result["features"])
                self.assertEqual(result["quality"]["gps_fix"], 0.0)

    def test_missing_sensor_fields_and_malformed_containers(self):
        for section, keys in (("gps", ("lat", "lon", "speed_mps", "hdop", "age_ms")), ("imu", ("accel_mps2", "gyro_dps"))):
            for key in keys:
                current = sample(2)
                current[section][key] = None
                with self.subTest(section=section, key=key):
                    result = extract_features(current, sample(1))
                    self.assert_contract(result)
                    self.assertFalse(result["available"])
                    self.assertIn(f"{section}_{key}_missing", result["reasons"])
        for section in ("gps", "imu"):
            for bad in (None, [], "invalid", False):
                current = sample(2)
                current[section] = bad
                with self.subTest(section=section, bad=bad):
                    result = extract_features(current, sample(1))
                    self.assert_contract(result)
                    self.assertFalse(result["available"])
        for bad in (None, False, [], "invalid", {}):
            self.assertFalse(extract_features(bad)["available"])
            result = extract_features(sample(2), bad) if bad is not None else extract_features(sample(2))
            self.assert_contract(result)
            self.assertFalse(result["available"])

    def test_missing_previous_imu_does_not_synthesize_consistency(self):
        previous = sample(1)
        previous["imu"] = None
        result = extract_features(sample(2), previous)
        self.assertFalse(result["available"])
        self.assertIn("previous_imu_missing", result["reasons"])
        self.assertNotIn("imu_accel_delta_mps2", result["features"])
        self.assertNotIn("gps_imu_accel_excess_mps2", result["features"])
        self.assertEqual(result["quality"]["imu"], 0.0)

    def test_stale_gps_current_or_previous_blocks_motion(self):
        for stale_previous in (False, True):
            previous, current = sample(1), sample(2)
            (previous if stale_previous else current)["gps"]["age_ms"] = 10_001
            result = extract_features(current, previous)
            self.assert_contract(result)
            self.assertFalse(result["available"])
            self.assertIn("previous_gps_stale" if stale_previous else "gps_stale", result["reasons"])
            self.assertNotIn("distance_m", result["features"])
            self.assertEqual(result["quality"]["gps_freshness"], 0.0)
        current = sample(2)
        current["gps"]["age_ms"] = 1000
        result = extract_features(current, sample(1))
        self.assertEqual(result["features"]["gps_age_s"], 1.0)
        self.assertGreater(result["quality"]["gps_freshness"], 0.0)
        self.assertLess(result["quality"]["gps_freshness"], 1.0)

    def test_duplicate_and_out_of_order_history_blocks_derivatives(self):
        cases = (
            ({"record_id": "synthetic-record-1"}, "duplicate_record"),
            ({"sequence": 1}, "duplicate_sequence"),
            ({"sequence": 0}, "out_of_order_sequence"),
            ({"uptime_ms": 1000}, "duplicate_uptime"),
            ({"uptime_ms": 999}, "out_of_order_uptime"),
            ({"recorded_at": sample(1)["recorded_at"]}, "duplicate_recorded_at"),
            ({"recorded_at": sample(0)["recorded_at"]}, "out_of_order_recorded_at"),
            ({"device_id": "another-synthetic-device"}, "previous_device_mismatch"),
        )
        for changes, reason in cases:
            with self.subTest(reason=reason):
                current = sample(2)
                current.update(changes)
                result = extract_features(current, sample(1))
                self.assert_contract(result)
                self.assertFalse(result["available"])
                self.assertIn(reason, result["reasons"])
                self.assertNotIn("implied_speed_mps", result["features"])
                self.assertEqual(result["quality"]["chronology"], 0.0)

    def test_unsynced_same_boot_uses_uptime_not_receipt_time(self):
        previous, current = sample(1), sample(2)
        previous["recorded_at"] = current["recorded_at"] = None
        current["received_at"] = "2026-01-02T12:00:00+00:00"
        result = extract_features(current, previous)
        self.assert_contract(result)
        self.assertTrue(result["available"])
        self.assertEqual(result["features"]["delta_s"], 1.0)
        self.assertIn("uptime_clock_used", result["reasons"])
        self.assertEqual(result["quality"]["delivery"], 0.5)
        self.assertEqual(result["quality"]["clock"], 0.5)

    def test_boot_change_requires_utc_and_does_not_compare_sequence_counters(self):
        previous, current = sample(20, seconds=1), sample(1, seconds=2)
        current["boot_id"] = "synthetic-new-boot"
        current["uptime_ms"] = 1
        result = extract_features(current, previous)
        self.assert_contract(result)
        self.assertTrue(result["available"])
        self.assertEqual(result["features"]["delta_s"], 1.0)
        self.assertIn("boot_changed", result["reasons"])
        current["recorded_at"] = None
        result = extract_features(current, previous)
        self.assertFalse(result["available"])
        self.assertIn("chronology_unavailable", result["reasons"])

    def test_timezone_normalization_and_malformed_timestamps(self):
        current = sample(2)
        current["recorded_at"] = "2026-01-01T01:00:02+01:00"
        result = extract_features(current, sample(1))
        self.assertTrue(result["available"])
        self.assertEqual(result["features"]["delta_s"], 1.0)
        current["recorded_at"] = "2026-01-01T00:00:02Z"
        self.assertTrue(extract_features(current, sample(1))["available"])
        for field in ("recorded_at", "received_at"):
            for bad in ("2026-01-01T00:00:02", "not-a-date", True, 123, "0001-01-01T00:00:00+01:00"):
                current = sample(2)
                current[field] = bad
                result = extract_features(current, sample(1))
                self.assert_contract(result)
                self.assertFalse(result["available"])
                self.assertIn(field + "_invalid", result["reasons"])

    def test_clock_discontinuity_and_old_history_are_unavailable(self):
        current = sample(2, seconds=20)
        current["uptime_ms"] = 2000
        result = extract_features(current, sample(1))
        self.assertFalse(result["available"])
        self.assertIn("clock_discontinuity", result["reasons"])
        result = extract_features(sample(2, seconds=62), sample(1))
        self.assertFalse(result["available"])
        self.assertIn("previous_stale", result["reasons"])

    def test_delayed_and_stale_delivery_never_change_capture_speed(self):
        previous, current = sample(1), sample(2, lon=math.degrees(10.0 / EARTH_RADIUS_M))
        captured = datetime.fromisoformat(current["recorded_at"])
        current["received_at"] = (captured + timedelta(seconds=120)).isoformat()
        result = extract_features(current, previous)
        self.assert_contract(result)
        self.assertTrue(result["available"])
        self.assertIn("delivery_delayed", result["reasons"])
        self.assertEqual(result["quality"]["delivery"], 0.25)
        self.assertAlmostEqual(result["features"]["implied_speed_mps"], 10.0)
        current["received_at"] = (captured + timedelta(seconds=301)).isoformat()
        result = extract_features(current, previous)
        self.assertFalse(result["available"])
        self.assertIn("record_stale", result["reasons"])
        current["received_at"] = (captured - timedelta(seconds=3)).isoformat()
        result = extract_features(current, previous)
        self.assertFalse(result["available"])
        self.assertIn("recorded_at_in_future", result["reasons"])

    def test_missing_receipt_and_reordered_delivery_are_explicit(self):
        current = sample(2)
        del current["received_at"]
        result = extract_features(current, sample(1))
        self.assertTrue(result["available"])
        self.assertIn("received_at_missing", result["reasons"])
        self.assertEqual(result["quality"]["delivery"], 0.5)
        previous = sample(1)
        previous["received_at"] = "2026-01-01T00:00:20Z"
        result = extract_features(sample(2), previous)
        self.assertTrue(result["available"])
        self.assertIn("delivery_reordered", result["reasons"])
        self.assertEqual(result["features"]["delta_s"], 1.0)

    def test_sequence_gap_and_hdop_reduce_reliability(self):
        current = sample(4, seconds=2)
        current["gps"]["hdop"] = 4.0
        result = extract_features(current, sample(1))
        self.assertTrue(result["available"])
        self.assertIn("sequence_gap", result["reasons"])
        self.assertEqual(result["quality"]["chronology"], 0.5)
        self.assertEqual(result["quality"]["gps_precision"], 0.25)

    def test_derived_overflow_is_not_returned_or_available(self):
        previous = sample(1, seconds=0, accel=-1e308)
        current = sample(2, seconds=1, accel=1e308)
        result = extract_features(current, previous)
        self.assert_contract(result)
        self.assertFalse(result["available"])
        self.assertIn("imu_accel_delta_mps2_overflow", result["reasons"])
        self.assertNotIn("imu_accel_delta_mps2", result["features"])
        previous = sample(1, seconds=0, speed=0)
        current = sample(2, seconds=1, speed=1e308)
        previous["recorded_at"] = current["recorded_at"] = None
        current["uptime_ms"] = 1
        result = extract_features(current, previous)
        self.assert_contract(result)
        self.assertFalse(result["available"])
        self.assertIn("gps_accel_mps2_overflow", result["reasons"])

    def test_no_raw_location_identity_or_input_mutation(self):
        previous, current = sample(1), sample(2, lon=0.0001)
        current["untrusted_extra"] = {"lat": 123, "secret": "not-a-real-secret"}
        original = deepcopy((previous, current))
        result = extract_features(current, previous)
        self.assertEqual((previous, current), original)
        self.assertEqual(result, extract_features(current, previous))
        encoded = json.dumps(result)
        for forbidden in ("synthetic-device", "synthetic-record", "synthetic-boot", "untrusted_extra", "not-a-real-secret"):
            self.assertNotIn(forbidden, encoded)
        for forbidden in ("lat", "lon", "latitude", "longitude", "recorded_at", "received_at", "device_id", "record_id"):
            self.assertNotIn(forbidden, result["features"])


if __name__ == "__main__":
    unittest.main()
