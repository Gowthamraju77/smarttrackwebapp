import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

const workspace = new URL("../", import.meta.url);
const requiredSources = [
  "app/api/devices/route.ts",
  "app/api/journeys/route.ts",
  "app/api/alerts/route.ts",
  "lib/server/operations.ts",
  "lib/server/security.ts",
  "lib/server/supabase.ts",
  "database/schema.sql",
];

// This is an explicit dependency gate, not evidence of GET/RLS correctness.
// R28 must review the implemented handlers and add behavioral checks once all
// dependencies exist. A successful gate alone does not close that review.
test("R28 GET API security review prerequisites are available", async () => {
  const missing = [];
  for (const path of requiredSources) {
    try {
      await access(new URL(path, workspace));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      missing.push(path);
    }
  }

  assert.deepEqual(
    missing,
    [],
    `BLOCKED: GET API/RLS implementation is not yet reviewable. Missing: ${missing.join(", ")}`,
  );
});
