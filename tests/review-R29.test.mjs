import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

// This is a dependency gate, not a time/distance or anomaly behavior test.
// See docs/reviews/R29.md for the blocked behavioral review cases.
test("R29 feature review requires the contracted feature extractor", async () => {
  const target = new URL("../ml/smarttrack_ml/features.py", import.meta.url);
  try {
    await access(target);
  } catch (error) {
    assert.fail(
      `R29 BLOCKED: ml/smarttrack_ml/features.py is unavailable (${error.code}). ` +
        "Feature units, stale/missing-data behavior, and constant-speed behavior have not been verified.",
    );
  }
});
