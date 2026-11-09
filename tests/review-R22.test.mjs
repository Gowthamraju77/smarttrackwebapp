import { existsSync } from "node:fs";
import test from "node:test";

const requiredPaths = [
  "database/schema.sql",
  "lib/server/ingest.ts",
  "lib/server/security.ts",
  "lib/server/supabase.ts",
  "app/api/ingest/route.ts",
  "app/api/sos/route.ts",
];

test("R22 prerequisites for durable rate-limit and SOS-priority review", (t) => {
  const missing = requiredPaths.filter(
    (path) => !existsSync(new URL(`../${path}`, import.meta.url)),
  );

  if (missing.length > 0) {
    t.skip(`BLOCKED: implementations not present: ${missing.join(", ")}`);
    return;
  }

  t.todo(
    "Implementation is now present: review the RPC and request path, then add isolated behavioral tests before treating R22 as verified.",
  );
});
