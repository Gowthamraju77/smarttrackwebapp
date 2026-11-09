import { existsSync } from 'node:fs';
import test from 'node:test';

// Dependency-only review receipt. No validation implementation was present at
// review time, so these cases are explicitly skipped rather than fabricated.
// Once the missing implementation lands, rerun R20 to replace this receipt
// with isolated behavior tests against the actual validator/route interface.
const requiredFiles = [
  'lib/server/ingest.ts',
  'app/api/ingest/route.ts',
  'app/api/sos/route.ts',
];
const missingFiles = requiredFiles.filter(
  (path) => !existsSync(new URL(`../${path}`, import.meta.url)),
);
const blockedReason = missingFiles.length
  ? `BLOCKED: missing implementation: ${missingFiles.join(', ')}`
  : 'BLOCKED: implementation arrived after review; R20 must inspect its interface and replace these skipped cases with executable behavior tests';

const cases = [
  'R20-01 rejects non-finite numeric fields, including JSON exponent overflow',
  'R20-02 accepts inclusive latitude/longitude bounds and rejects values outside them',
  'R20-03 rejects booleans where sequence, uptime, GPS, or IMU numbers are required',
  'R20-04 accepts explicit null recorded_at for unsynchronized telemetry and SOS',
  'R20-05 rejects missing, wrong-type, and malformed recorded_at values',
  'R20-06 rejects unknown or non-boolean GPS fix values instead of treating them as a fix',
  'R20-07 prevents false or absent GPS fixes from masquerading as current coordinates',
  'R20-08 rejects invalid payload shapes, versions, identifiers, and event schemas',
  'R20-09 rejects invalid JSON envelopes and malformed or mismatched CRCs',
  'R20-10 enforces the documented body/payload limits, including streamed UTF-8 input',
];

for (const name of cases) {
  test(name, { skip: blockedReason }, () => {});
}
