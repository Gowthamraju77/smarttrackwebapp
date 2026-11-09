import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// These are review prerequisites, not authorization or invite acceptance tests.
// A passing prerequisite only means its implementation is available to review.
const root = fileURLToPath(new URL("../", import.meta.url));

function sourceFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory()
      ? sourceFiles(filename)
      : /\.[jt]sx?$/.test(entry.name)
        ? [filename]
        : [];
  });
}

for (const filename of [
  "lib/server/security.ts",
  "lib/server/operations.ts",
  "database/schema.sql",
]) {
  test(`R12 prerequisite only: ${filename} is available`, () => {
    assert.ok(
      existsSync(path.join(root, filename)),
      `R12 BLOCKED: ${filename} is missing; client/server authority cannot be reviewed.`,
    );
  });
}

test("R12 prerequisite only: team role/invite implementation is available", () => {
  const candidates = ["components", "app"].flatMap((directory) =>
    sourceFiles(path.join(root, directory)),
  );
  const teamSources = candidates.filter((filename) => {
    const source = readFileSync(filename, "utf8");
    return /\b(owner|admin|responder|viewer)\b/i.test(source) && /invit/i.test(source);
  });
  assert.ok(
    teamSources.length > 0,
    "R12 BLOCKED: no team role/invite implementation is available under components/ or app/. " +
      "This discovery gate is not a UI interaction test; review a differently structured implementation manually.",
  );
});
