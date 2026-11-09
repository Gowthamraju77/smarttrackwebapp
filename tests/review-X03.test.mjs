/**
 * X03 review INPUT-AVAILABILITY probe, not an end-to-end behavior test.
 *
 * Missing implementation is reported as SKIP/BLOCKED. If inputs arrive, the
 * check becomes TODO rather than passing on file existence. Main integration
 * must replace that TODO with a source-specific executable test and re-review.
 * No application, firmware, database or hosted service is started or modified.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

function filesBelow(relative) {
  const absolute = path.join(root, relative);
  if (!existsSync(absolute)) return [];
  return readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const name = `${relative}/${entry.name}`;
    return entry.isDirectory() ? filesBelow(name) : [name];
  });
}

const firmware = filesBelow('firmware').filter((name) => /\.(?:cpp|cc|c|hpp|h)$/.test(name));
const expected = (file) => ({ label: file, present: existsSync(path.join(root, file)) });
const firmwareRole = (label, pattern) => ({
  label,
  present: firmware.some((name) => !name.includes('/ui/') && pattern.test(name)),
});

const dependencies = {
  main: expected('firmware/src/main.cpp'),
  wire: firmwareRole('firmware wire/CRC implementation (K9)', /(?:wire|crc)/i),
  queue: firmwareRole('firmware persistent queue implementation (K9)', /queue/i),
  sensors: firmwareRole('firmware sensor implementation (K8)', /sensor/i),
  ingest: expected('lib/server/ingest.ts'),
  ingestRoute: expected('app/api/ingest/route.ts'),
  sosRoute: expected('app/api/sos/route.ts'),
  sql: expected('database/schema.sql'),
  features: expected('ml/smarttrack_ml/features.py'),
  scoring: expected('ml/smarttrack_ml/scoring.py'),
  service: expected('ml/smarttrack_ml/service.py'),
};

const checks = [
  ['01 exact UTF-8 payload-byte CRC, including whitespace and Unicode',
    ['wire', 'ingest', 'ingestRoute']],
  ['02 envelope decoding preserves record/device identity',
    ['main', 'wire', 'ingest', 'sql']],
  ['03 durable retry/reboot identity and device-scoped SQL uniqueness',
    ['main', 'queue', 'wire', 'ingest', 'sql']],
  ['04 unsynchronized recorded_at:null and distinct received_at',
    ['main', 'wire', 'ingest', 'sql', 'features']],
  ['05 boot/sequence/uptime ordering, reset and integer bounds',
    ['main', 'queue', 'wire', 'ingest', 'sql', 'features']],
  ['06 speed_mps, accel_mps2, gyro_dps and millisecond units',
    ['sensors', 'main', 'wire', 'ingest', 'sql', 'features']],
  ['07 no/stale/invalid fix retains honest feature availability',
    ['sensors', 'wire', 'ingest', 'sql', 'features']],
  ['08 ML current/previous record identity and time provenance',
    ['sql', 'features', 'scoring', 'service']],
  ['09 only exact accepted+record_id+duplicate receipt dequeues',
    ['queue', 'wire', 'ingest', 'ingestRoute', 'sosRoute', 'sql']],
  ['10 transactional duplicate and SOS retry receipts without GPS/ML',
    ['main', 'queue', 'wire', 'ingest', 'ingestRoute', 'sosRoute', 'sql']],
];

for (const [name, required] of checks) {
  test(`X03-${name} [input availability only]`, (t) => {
    const missing = required
      .map((key) => dependencies[key])
      .filter((dependency) => !dependency.present)
      .map((dependency) => dependency.label);
    if (missing.length) {
      t.skip(`BLOCKED: missing ${missing.join('; ')}`);
      return;
    }
    t.todo('Inputs detected; inspect actual interfaces and add executable assertions. File presence is not a behavioral pass.');
  });
}
