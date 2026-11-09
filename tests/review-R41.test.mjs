import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// This is a review-readiness gate, not a sensor, calibration, or hardware test.
// Keep a missing implementation visible as a failure rather than a green skip.
// If this gate later passes, R41's ten behavior checks still need review.
test('R41 review prerequisite: the firmware acquisition entry point is available', () => {
  const main = fileURLToPath(new URL('../firmware/src/main.cpp', import.meta.url));
  assert.ok(
    existsSync(main),
    'BLOCKED: firmware/src/main.cpp is absent; GPS/MPU acquisition, calibration failures, and missing-value serialization cannot be reviewed.',
  );
  assert.ok(readFileSync(main, 'utf8').trim().length > 0, 'BLOCKED: firmware/src/main.cpp is empty.');
});
