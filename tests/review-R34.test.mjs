import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

const servicePath = new URL("../ml/smarttrack_ml/service.py", import.meta.url);

test("R34 dependency gate: ML service source is available for behavioral review", () => {
  assert.ok(
    existsSync(servicePath),
    "BLOCKED: ml/smarttrack_ml/service.py is absent. Constant-time auth, request-size errors, and ML-unavailable behavior cannot be executed. This dependency gate is not an API behavior test.",
  );
});
