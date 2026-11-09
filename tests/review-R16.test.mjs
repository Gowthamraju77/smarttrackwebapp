import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Availability gate only. This does not execute a DOM, focus, keyboard events,
// accessible-name computation, or modal isolation. Passing discovery is not
// approval: bind behavioral tests to the actual shared dialog API after delivery.
const root = fileURLToPath(new URL("../", import.meta.url));

function sourceFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(filename);
    return /\.[jt]sx?$/.test(entry.name) ? [filename] : [];
  });
}

test("R16 availability only: dialog implementation exists for scoped review", (t) => {
  const sources = ["components", "app", "lib", "src"].flatMap((directory) =>
    sourceFiles(path.join(root, directory)),
  );
  const candidates = [];
  for (const filename of sources) {
    const source = readFileSync(filename, "utf8");
    const relative = path.relative(root, filename).replaceAll("\\", "/");
    const digest = createHash("sha256").update(source).digest("hex");
    t.diagnostic(`${relative} sha256=${digest}`);
    if (
      /(?:dialog|modal)/i.test(path.basename(filename)) ||
      /<dialog\b|\brole\s*=\s*(?:\{\s*)?["'](?:alert)?dialog["']|\bshowModal\s*\(/.test(source) ||
      /<(?:[A-Za-z_$][\w$]*\.)?(?:Dialog|Modal)(?:[.\s/>])/.test(source)
    ) {
      candidates.push(relative);
    }
  }

  t.diagnostic(`Dialog discovery candidates: ${candidates.join(", ") || "none"}`);
  assert.ok(
    candidates.length > 0,
    "BLOCKED R16: no dialog implementation was discovered under components/, app/, lib/, or src/. " +
      "Focus restoration, Escape dismissal, labels, and modal semantics cannot be behavior-tested. " +
      "This heuristic only checks availability; manually inspect differently structured implementations.",
  );
});
