import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Isolated review: canonical feature imports in fresh Python processes, -B to
// prohibit bytecode writes, -I -S to exclude ambient package/site configuration.
// Missing model/service implementations remain BLOCKED, not passing checks.
const root = fileURLToPath(new URL("../", import.meta.url));
const required = [
  "ml/smarttrack_ml/features.py",
  "ml/smarttrack_ml/model.py",
  "ml/smarttrack_ml/scoring.py",
  "ml/smarttrack_ml/service.py",
];

const pythonPrelude = `
import copy
import importlib
import inspect
import json
import math
from pathlib import Path
import sys

root = Path(sys.argv[1]).resolve()
sys.path.insert(0, str(root / "ml"))
features = importlib.import_module("smarttrack_ml.features")
package = importlib.import_module("smarttrack_ml")
assert Path(features.__file__).resolve() == root / "ml/smarttrack_ml/features.py"
assert Path(package.__file__).resolve() == root / "ml/smarttrack_ml/__init__.py"

def record(n):
    return {
        "version": 1, "device_id": "C03-synthetic-device",
        "record_id": f"C03-synthetic-record-{n}", "boot_id": "C03-synthetic-boot",
        "sequence": n, "uptime_ms": n * 1000,
        "recorded_at": f"2026-01-01T00:00:0{n}Z",
        "received_at": f"2026-01-01T00:00:0{n + 1}Z",
        "gps": {"fix": True, "lat": 0.0, "lon": n * 0.00001,
                "speed_mps": 1.0, "hdop": 1.0, "age_ms": 0},
        "imu": {"accel_mps2": 0.0, "gyro_dps": 0.0},
    }

def validate(result):
    assert set(result) == {"features", "reasons", "quality", "available"}
    assert type(result["available"]) is bool
    assert isinstance(result["features"], dict)
    assert isinstance(result["reasons"], list)
    assert all(isinstance(reason, str) for reason in result["reasons"])
    assert set(result["features"]) <= set(features.FEATURE_NAMES)
    assert all(type(value) is float and math.isfinite(value)
               for value in result["features"].values())
    assert all(type(value) is float and 0 <= value <= 1
               for value in result["quality"].values())
    if result["available"]:
        assert set(result["features"]) == set(features.FEATURE_NAMES)
    json.dumps(result, allow_nan=False)
`;

function featureCheck(name, body, prerequisites = []) {
  test(`C03: ${name}`, (t) => {
    const missing = ["ml/smarttrack_ml/features.py", "ml/smarttrack_ml/__init__.py", ...prerequisites]
      .filter((relative) => !existsSync(path.join(root, relative)));
    if (missing.length) {
      t.skip(`BLOCKED: missing ${missing.join(", ")}`);
      return;
    }
    const execution = spawnSync("python", ["-B", "-I", "-S", "-", root], {
      cwd: root,
      input: `${pythonPrelude}\n${body}\n`,
      encoding: "utf8",
      timeout: 20000,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
    if (execution.error?.code === "ENOENT") {
      t.skip("BLOCKED: Python interpreter unavailable");
      return;
    }
    assert.ifError(execution.error);
    assert.equal(execution.status, 0, `${execution.stdout}\n${execution.stderr}`);
    if (execution.stdout.trim()) t.diagnostic(execution.stdout.trim());
  });
}

featureCheck("canonical feature/package imports agree without optional ML dependencies", `
assert package.extract_features is features.extract_features
assert package.FEATURE_NAMES is features.FEATURE_NAMES
assert package.FEATURE_SCHEMA_VERSION == features.FEATURE_SCHEMA_VERSION
assert not any(name.split(".")[0] in {"sklearn", "numpy", "fastapi", "joblib"} for name in sys.modules)
`);

featureCheck("extract_features accepts record and optional previous=None", `
signature = inspect.signature(features.extract_features)
assert list(signature.parameters) == ["record", "previous"]
assert signature.parameters["previous"].default is None
current = record(2)
assert features.extract_features(current) == features.extract_features(current, previous=None)
validate(features.extract_features(current))
`);

featureCheck("usable pair returns finite ordered feature/evidence contract", `
result = features.extract_features(record(2), previous=record(1))
validate(result)
assert result["available"] is True
names = features.FEATURE_NAMES
assert len(names) == len(set(names)) and len(names) > 0
assert len([result["features"][name] for name in names]) == len(names)
assert not {"lat", "lon", "device_id", "record_id", "recorded_at"} & set(names)
assert not {"score", "safety_probability", "reliability_index"} & set(result)
`);

featureCheck("missing predecessor stays unavailable with partial evidence", `
result = features.extract_features(record(2))
validate(result)
assert result["available"] is False
assert "previous_missing" in result["reasons"]
assert "distance_m" not in result["features"]
assert "gps_accel_mps2" not in result["features"]
`);

featureCheck("missing GPS or IMU never creates an available feature vector", `
for section in ("gps", "imu"):
    for previous_missing in (False, True):
        current, previous = record(2), record(1)
        target = previous if previous_missing else current
        target[section] = None
        result = features.extract_features(current, previous)
        validate(result)
        assert result["available"] is False
        assert result["reasons"]
current = record(2)
current["gps"]["fix"] = False
result = features.extract_features(current, record(1))
validate(result)
assert result["available"] is False
assert "implied_speed_mps" not in result["features"]
`);

featureCheck("invalid numbers and history stay unavailable instead of coercing", `
for value in (True, "1", float("nan"), float("inf")):
    current = record(2)
    current["gps"]["speed_mps"] = value
    result = features.extract_features(current, record(1))
    validate(result)
    assert result["available"] is False
for change in ({"device_id": "other-synthetic-device"}, {"record_id": "C03-synthetic-record-2"}, {"sequence": 2}):
    previous = record(1)
    previous.update(change)
    result = features.extract_features(record(2), previous)
    validate(result)
    assert result["available"] is False
`);

featureCheck("input dictionaries remain unchanged and derived output excludes identity", `
current, previous = record(2), record(1)
original = copy.deepcopy((current, previous))
result = features.extract_features(current, previous)
assert (current, previous) == original
assert result == features.extract_features(current, previous)
assert "C03-synthetic" not in json.dumps(result)
validate(result)
`);

featureCheck("feature tests import the production module and their suite passes", `
import importlib.util
import unittest
filename = root / "ml/tests/test_features.py"
spec = importlib.util.spec_from_file_location("c03_reviewed_feature_tests", filename)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
assert module.extract_features is features.extract_features
assert module.FEATURE_NAMES is features.FEATURE_NAMES
suite = unittest.defaultTestLoader.loadTestsFromModule(module)
assert suite.countTestCases() > 0
result = unittest.TextTestRunner(verbosity=1).run(suite)
assert result.wasSuccessful()
print(json.dumps({"productionFeatureTests": result.testsRun, "successful": result.wasSuccessful()}))
`, ["ml/tests/test_features.py"]);

function pythonTests(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return /^(?:\.venv|venv|__pycache__|\.pytest_cache)$/.test(entry.name)
        ? [] : pythonTests(filename);
    }
    return /^(?:test_.*|.*_test)\.py$/.test(entry.name) ? [filename] : [];
  });
}

test("C03: model/scoring/service interface, imports and unavailability review gate", (t) => {
  const missing = required.filter((relative) => !existsSync(path.join(root, relative)));
  const tests = pythonTests(path.join(root, "ml"));
  const present = [...required.filter((relative) => !missing.includes(relative)),
    ...tests.map((filename) => path.relative(root, filename).replaceAll(path.sep, "/"))];
  const sha256 = Object.fromEntries(present.map((relative) => [relative,
    createHash("sha256").update(readFileSync(path.join(root, relative))).digest("hex")]));
  t.diagnostic(JSON.stringify({
    round: process.env.C03_ROUND ?? "single",
    observedAt: new Date().toISOString(),
    node: process.version,
    scope: "feature fixtures execute; this model/service gate is a read-only availability snapshot, not end-to-end verification",
    missing,
    pythonTestFiles: tests.length,
    sha256,
  }));
  const blockers = [...missing, ...(tests.length ? [] : ["ML implementation tests under ml/"])];
  if (blockers.length) {
    t.skip(`BLOCKED: missing ${blockers.join(", ")}; cross-module interfaces, imports and service fail-closed behavior cannot be assessed.`);
    return;
  }
  t.skip("BLOCKED: implementation is now present; inspect its exact interfaces and replace this readiness gate with isolated feature/model/service and unavailable-response fixtures before approval.");
});
