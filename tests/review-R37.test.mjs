import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';

// This is a review prerequisite, not a button/SOS acceptance test. Once the
// implementation arrives, R37 still needs the behavior checks in its report.
test('R37 prerequisite: firmware button/SOS implementation is available', () => {
  const required = [
    'firmware/src/main.cpp',
    'firmware/include/config.h',
    'firmware/platformio.ini',
  ];
  const missing = required.filter((path) => !existsSync(new URL(`../${path}`, import.meta.url)));

  assert.deepEqual(
    missing,
    [],
    `R37 BLOCKED: missing ${missing.join(', ')}. Button debounce/hold, millis rollover, and SOS loop responsiveness cannot be reviewed yet.`,
  );
});
