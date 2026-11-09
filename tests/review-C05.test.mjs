import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

async function text(relativePath) {
  try {
    return await readFile(path.join(root, relativePath), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

async function requireFiles(relativePaths) {
  const missing = [];
  for (const relativePath of relativePaths) {
    if (!(await text(relativePath)).trim()) missing.push(relativePath);
  }
  assert.deepEqual(missing, [],
    `C05 BLOCKED: missing/empty review inputs: ${missing.join(", ")}. ` +
    "Availability is not deployment or variable-name verification.");
}

async function markdownFiles(relativeDirectory) {
  let entries;
  try {
    entries = await readdir(path.join(root, relativeDirectory), { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    // Review reports and the design contract are not operator deployment guides.
    if (entry.name === "reviews" || entry.name === "CONTRACT.md") continue;
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...await markdownFiles(relativePath));
    else if (/\.mdx?$/i.test(entry.name)) files.push(relativePath);
  }
  return files;
}

const documentationPaths = ["README.md", "ml/README.md", ...await markdownFiles("docs")];
const documentation = (await Promise.all(documentationPaths.map(text))).join("\n");

function requireGuide(label, topic, action) {
  assert.ok(topic.test(documentation) && action.test(documentation),
    `C05 BLOCKED: no ${label} operator-guide candidate found in README.md, ` +
    "ml/README.md, or docs (excluding contract and reviews). " +
    "A matching candidate still needs a manual exact-name/command review.");
}

// Ten distinct, read-only prerequisite checks. These deliberately fail when
// implementation/documents have not landed. Passing all ten only permits the
// substantive review in docs/reviews/C05.md; it never certifies a deployment.
test("C05-01 prerequisite: project README is available", async () => {
  await requireFiles(["README.md"]);
});

test("C05-02 prerequisite: environment example is available", async () => {
  // Read only the example, never an operator's real .env or .env.local.
  await requireFiles([".env.example"]);
});

test("C05-03 prerequisite: Vercel operator instructions are available", () => {
  requireGuide("Vercel", /\bVercel\b/i, /\b(deploy|deployment|build|configure)\b/i);
});

test("C05-04 prerequisite: contracted Supabase schema is available", async () => {
  await requireFiles(["database/schema.sql"]);
});

test("C05-05 prerequisite: Supabase setup instructions are available", () => {
  requireGuide("Supabase", /\bSupabase\b/i, /\b(schema|migration|migrate|SQL)\b/i);
});

test("C05-06 prerequisite: web environment and auth readers are available", async () => {
  await requireFiles(["lib/server/supabase.ts", "lib/server/security.ts"]);
});

test("C05-07 prerequisite: documented production API names can be inspected", async () => {
  await requireFiles([
    "lib/server/ingest.ts",
    "lib/server/operations.ts",
    "app/api/ingest/route.ts",
    "app/api/sos/route.ts",
    "app/api/devices/route.ts",
    "app/api/journeys/route.ts",
    "app/api/alerts/route.ts",
    "app/api/sos/[id]/route.ts",
  ]);
});

test("C05-08 prerequisite: separate ML dependency manifest is available", async () => {
  const candidates = ["ml/pyproject.toml", "ml/requirements.txt"];
  const manifests = await Promise.all(candidates.map(text));
  assert.ok(manifests.some((manifest) => manifest.trim()),
    `C05 BLOCKED: neither ${candidates.join(" nor ")} is available. ` +
    "Python install/package-name instructions cannot be compared with a manifest.");
});

test("C05-09 prerequisite: ML service and launch instructions are available", async () => {
  await requireFiles(["ml/smarttrack_ml/service.py"]);
  requireGuide("ML service", /\b(smarttrack_ml|FastAPI|ML service)\b/i,
    /\b(uvicorn|gunicorn|deploy|deployment)\b/i);
});

test("C05-10 prerequisite: ML training/artifact sources and guide are available", async () => {
  await requireFiles([
    "ml/smarttrack_ml/features.py",
    "ml/smarttrack_ml/model.py",
    "ml/smarttrack_ml/scoring.py",
  ]);
  requireGuide("ML artifact", /\b(artifact|calibration|calibrated)\b/i,
    /\b(train|training|promote|promoted|promotion)\b/i);
});
