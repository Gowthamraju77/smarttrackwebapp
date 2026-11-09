import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// A readiness gate only. Passing this does not verify normalization or calibration.
// The contract names these modules but does not define their scoring API yet.
const root = new URL("../", import.meta.url);
const requiredModules = [
  "ml/smarttrack_ml/model.py",
  "ml/smarttrack_ml/scoring.py",
];

test("R31 prerequisite: model and scoring implementations are available", async () => {
  const unavailable = [];

  for (const path of requiredModules) {
    try {
      const source = await readFile(new URL(path, root), "utf8");
      if (!source.trim()) unavailable.push(`${path}: empty`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      unavailable.push(`${path}: missing`);
    }
  }

  assert.deepEqual(
    unavailable,
    [],
    `R31 BLOCKED: normalization/calibration cannot be reviewed without the implementation.\n${unavailable.join("\n")}`,
  );
});
