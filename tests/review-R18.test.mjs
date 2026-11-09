import assert from 'node:assert/strict';
import { stat } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const prerequisites = [
  'database/schema.sql',
  'lib/server/security.ts',
  'lib/server/supabase.ts',
  'lib/server/ingest.ts',
  'lib/server/operations.ts',
  'app/api/devices/route.ts',
  'app/api/ingest/route.ts',
  'app/api/sos/route.ts',
];

test('R18 device-auth review prerequisites exist (availability gate only)', async () => {
  const unavailable = [];

  for (const path of prerequisites) {
    try {
      const entry = await stat(new URL(path, root));
      if (!entry.isFile() || entry.size === 0) unavailable.push(path);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      unavailable.push(path);
    }
  }

  assert.equal(
    unavailable.length,
    0,
    `BLOCKED R18: missing or empty review prerequisites: ${unavailable.join(', ')}. ` +
      'Availability alone does not verify hashing, authorization, or revocation; ' +
      'the behavioral cases in docs/reviews/R18.md still require implementation-specific checks.',
  );
});
