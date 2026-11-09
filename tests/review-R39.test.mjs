import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const firmwareRoot = fileURLToPath(new URL("../firmware/", import.meta.url));

async function sourceFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filename);
    return /\.(?:h|hpp|c|cc|cpp)$/i.test(entry.name) ? [filename] : [];
  }));
  return nested.flat();
}

// This is a dependency gate only. It cannot establish acknowledgment behavior.
// When K9 lands, review the actual API and add executable behavior coverage.
test("R39 prerequisite: queue and wire implementation sources are available", async () => {
  const files = await sourceFiles(firmwareRoot);
  const relativeFiles = files.map((filename) => path.relative(firmwareRoot, filename));
  const missing = ["queue", "wire"].filter((name) => !relativeFiles.some((filename) => {
    return path.basename(filename).toLowerCase().includes(name);
  }));

  assert.deepEqual(missing, [],
    `R39 BLOCKED: missing ${missing.join(" and ")} firmware implementation. ` +
    `Available firmware sources: ${relativeFiles.join(", ") || "none"}. ` +
    "This check does not test queue removal, receipt parsing, or hardware.");
});
