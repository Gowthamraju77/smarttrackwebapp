import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// R44 blocked-review manifest. These are ten pending static checks, not ten
// successful tests. New source must receive a source-specific review; file
// presence alone must never silently turn this artifact into an approval.
const prerequisites = [
  'firmware/platformio.ini',
  'firmware/include/config.h',
  'firmware/src/main.cpp',
];
const missing = prerequisites.filter((relative) =>
  !existsSync(fileURLToPath(new URL(`../${relative}`, import.meta.url))),
);
const blockedReason = missing.length
  ? `BLOCKED: missing ${missing.join(', ')}; electrical behavior is unreviewed.`
  : false;

const checks = [
  'GPIO21 mapping and active-low P-FET truth table',
  'TPS22918 ON polarity and wiring are distinct from the P-FET gate',
  'boot/reset/default-off sequence and external control bias',
  'rail-off and rail-on callers use the selected switch polarity',
  'always-on MCU, switched peripherals, and modem power domains',
  'internal GPIO pulls versus retained deep-sleep bias and wake restoration',
  'unpowered peripheral back-power paths through live I/O and pull-ups',
  'modem-off default and unknown PWRKEY guarded from GPIO operations',
  'reserved modem UART, logic voltage, PWRKEY timing, and GPIO48 LED boundary',
  'regulator/load-switch limits distinguished from modem supply qualification',
];

for (const [index, name] of checks.entries()) {
  test(`R44 static check ${index + 1}: ${name}`, { skip: blockedReason }, () => {
    assert.fail(
      'BLOCKED: firmware has arrived since the absent-source review. ' +
      'Inspect the concrete K8/K10 source and selected hardware documents, ' +
      'then replace this manifest with source-specific static checks. ' +
      'This artifact supplies no hardware proof.',
    );
  });
}
