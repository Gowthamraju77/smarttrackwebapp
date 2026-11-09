import { access } from "node:fs/promises";
import test from "node:test";

const requiredSources = [
  "lib/server/security.ts",
  "lib/server/supabase.ts",
];

// This receipt checks review readiness only. It must never report authentication
// behavior as passing merely because implementation files appeared later.
test("R25 verified Supabase user-context review prerequisites", async (t) => {
  const missing = [];
  for (const path of requiredSources) {
    try {
      await access(new URL(`../${path}`, import.meta.url));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      missing.push(path);
    }
  }

  if (missing.length > 0) {
    t.skip(
      `BLOCKED: missing ${missing.join(", ")}; verified user identity and JWT claim trust cannot be reviewed.`,
    );
    return;
  }

  t.todo(
    "BLOCKED: implementation is now available; inspect its actual exports and replace this receipt with the ten behavioral checks in docs/reviews/R25.md.",
  );
});
