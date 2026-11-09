import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

// This is an availability gate, not an artifact-security acceptance test.
// Behavioral review must be completed once the contract-owned modules exist;
// see docs/reviews/R33.md for the pending checks and the observed blocker.
const requiredModules = [
  "ml/smarttrack_ml/model.py",
  "ml/smarttrack_ml/scoring.py",
  "ml/smarttrack_ml/service.py",
];

test("R33 prerequisite: artifact loader and production-scoring modules exist", () => {
  const missing = requiredModules.filter(
    (relativePath) => !existsSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url))),
  );

  assert.deepEqual(
    missing,
    [],
    `BLOCKED: artifact trust/digest, pickle, and synthetic-production review cannot run; missing ${missing.join(", ")}. This check only verifies source availability.`,
  );
});
