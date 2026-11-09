import { existsSync } from "node:fs";
import test from "node:test";

const dependencies = [
  "database/schema.sql",
  "lib/server/security.ts",
  "lib/server/supabase.ts",
  "lib/server/operations.ts",
  "app/api/sos/[id]/route.ts",
];

// This receipt cannot turn file presence into a successful behavioral review.
test("R24 SOS monotonic transitions, audit, and role review readiness", (t) => {
  const missing = dependencies.filter(
    (path) => !existsSync(new URL(`../${path}`, import.meta.url)),
  );

  if (missing.length > 0) {
    t.skip(`BLOCKED: implementation dependencies absent: ${missing.join(", ")}`);
    return;
  }

  t.todo(
    "Implementation dependencies now exist; review their actual behavior and replace this receipt with transition/audit/role tests before claiming success.",
  );
});
