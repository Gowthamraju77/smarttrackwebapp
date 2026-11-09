import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// This is a review prerequisite gate, not an executable PostgreSQL test.
// Add implementation-specific retry/receipt checks only after these sources exist.
const requiredSources = [
  "database/schema.sql",
  "lib/server/ingest.ts",
  "app/api/ingest/route.ts",
  "app/api/sos/route.ts",
];

test("R21: transaction/retry/receipt review implementation is available", (t) => {
  const unavailable = [];
  for (const path of requiredSources) {
    try {
      if (!readFileSync(new URL(`../${path}`, import.meta.url), "utf8").trim()) {
        unavailable.push(`${path} (empty)`);
      }
    } catch (error) {
      unavailable.push(`${path} (${error.code ?? error.message})`);
    }
  }

  t.diagnostic("Source availability only; no database connection or SQL execution.");
  assert.deepEqual(
    unavailable,
    [],
    `R21 BLOCKED: review dependencies are unavailable:\n${unavailable.join("\n")}`,
  );
});
