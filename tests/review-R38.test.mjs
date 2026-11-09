import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const firmwareRoot = fileURLToPath(new URL("../firmware/", import.meta.url));

async function sourceFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const nested = await Promise.all(entries.map(async (entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filename);
    if (!entry.isFile() || !/\.(?:h|hpp|c|cc|cpp|cxx)$/i.test(entry.name)) return [];
    return (await readFile(filename, "utf8")).trim() ? [filename] : [];
  }));
  return nested.flat();
}

// Availability gate only: even a passing result requires a fresh review and
// implementation-specific fault-injection checks. This does not test SD media,
// partial writes, reboot recovery, queue removal, or durable identity.
test("R38 prerequisite: queue, wire, and firmware caller sources are available", async () => {
  const files = await sourceFiles(firmwareRoot);
  const relativeFiles = files.map((filename) => path.relative(firmwareRoot, filename)).sort();
  const missing = ["queue", "wire"].filter((name) => !files.some((filename) => {
    return path.basename(filename).toLowerCase().includes(name);
  }));
  if (!files.some((filename) => path.basename(filename).toLowerCase() === "main.cpp")) {
    missing.push("main.cpp (enqueue/retry and ID-generation callers)");
  }

  assert.deepEqual(missing, [],
    `R38 BLOCKED: missing ${missing.join(", ")}. ` +
    `Available firmware sources: ${relativeFiles.join(", ") || "none"}. ` +
    "The ten power-loss/unsent-record behavior cases cannot run against absent source.");
});
