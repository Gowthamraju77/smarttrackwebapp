import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// This is a review-input gate, not evidence of SQL/TypeScript compatibility.
// Keep real RPC checks tied to the implementation once these sources arrive.
const requiredSources = [
  'database/schema.sql',
  'lib/server/security.ts',
  'lib/server/supabase.ts',
  'lib/server/ingest.ts',
  'lib/server/operations.ts',
  'app/api/ingest/route.ts',
  'app/api/sos/route.ts',
  'app/api/devices/route.ts',
  'app/api/journeys/route.ts',
  'app/api/alerts/route.ts',
  'app/api/sos/[id]/route.ts',
];

test('C02 review prerequisite: SQL schema and TypeScript callers are available', (t) => {
  const missing = requiredSources.filter((relativePath) =>
    !existsSync(fileURLToPath(new URL(`../${relativePath}`, import.meta.url))),
  );

  t.diagnostic('Availability only; this does not execute SQL, auth, or an RPC.');
  assert.deepEqual(
    missing,
    [],
    `C02 BLOCKED: missing review dependencies: ${missing.join(', ')}. ` +
      'Complete the ten integration checks in docs/reviews/C02.md after they arrive.',
  );
});
