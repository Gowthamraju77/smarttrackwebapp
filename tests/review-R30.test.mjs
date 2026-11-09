import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import test from 'node:test';

// This is a dependency gate, not a behavioral ML test. A successful gate means
// the R30 behavioral review can begin; it does not certify leakage prevention.
test('R30 dependency gate: ML sources exist for the split/scaling review', async () => {
  const required = [
    'ml/smarttrack_ml/features.py',
    'ml/smarttrack_ml/model.py',
    'ml/smarttrack_ml/scoring.py',
  ];
  const missing = [];

  for (const path of required) {
    try {
      const info = await stat(new URL(`../${path}`, import.meta.url));
      if (!info.isFile() || info.size === 0) missing.push(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      missing.push(path);
    }
  }

  assert.deepEqual(
    missing,
    [],
    `R30 BLOCKED: missing/empty ML source files: ${missing.join(', ')}. ` +
      'The ten split/scaling/coordinate checks have not run; rerun the behavioral review when implemented.',
  );
});
