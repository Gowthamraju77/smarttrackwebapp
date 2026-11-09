import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// This is a dependency gate, not an implementation of the score algorithm.
// The contract supplies module paths but not a callable aggregation interface.
// Replace the TODOs with tests of the real interface when K5/K6/K7 are available.
const dependencies = [
  "ml/smarttrack_ml/features.py",
  "ml/smarttrack_ml/model.py",
  "ml/smarttrack_ml/scoring.py",
  "ml/smarttrack_ml/service.py",
];

test("R32 prerequisite: score review implementations are present and nonempty", async () => {
  const unavailable = [];
  for (const path of dependencies) {
    try {
      const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
      if (!source.trim()) unavailable.push(`${path}: empty`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      unavailable.push(`${path}: missing`);
    }
  }
  assert.equal(
    unavailable.length,
    0,
    `BLOCKED: real score reweighting, GPS availability, and model promotion cannot be reviewed.\n${unavailable.join("\n")}`,
  );
});

// Pending acceptance cases. These have no callbacks and cannot be counted as
// executed score checks even if the prerequisite eventually passes.
test.todo("R32-01: weights 30/30/20/15/5 give 73 for scores 100/80/60/40/20");
test.todo("R32-02: null or omitted five-percent factor reweights to 7200/95");
test.todo("R32-03: removing each factor preserves the ratios of the remaining weights");
test.todo("R32-04: a legitimate zero remains available and contributes its denominator weight");
test.todo("R32-05: one available factor retains its own score with effective weight one");
test.todo("R32-06: all missing factors return unavailable rather than zero, one hundred, or NaN");
test.todo("R32-07: invalid numeric factors cannot enter a successful finite weighted result");
test.todo("R32-08: no-fix null GPS yields no fabricated GPS factor or origin coordinates");
test.todo("R32-09: unevaluated and unpromoted artifacts contribute no production model score");
test.todo("R32-10: synthetic artifacts remain ineligible even when promotion flags are set");
