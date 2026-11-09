import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Review-script replay only. Child commands are the explicitly inspected,
// read-only node:test scripts below. No build, server, install, DB, or hardware.
// A successful replay of a blocked gate is not a successful product check.
const root = fileURLToPath(new URL("../", import.meta.url));
const testsDirectory = path.join(root, "tests");
const ingestInputs = [
  "database/schema.sql",
  "lib/server/ingest.ts",
  "app/api/ingest/route.ts",
  "app/api/sos/route.ts",
];
const uiInputs = [
  "app/page.tsx",
  "app/[section]/page.tsx",
  "components/app-shell.tsx",
  "components/dashboard-view.tsx",
  "components/section-view.tsx",
];

function content(relative) {
  try {
    return readFileSync(path.join(root, relative));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function snapshot(paths) {
  return Object.fromEntries(paths.map((relative) => {
    const bytes = content(relative);
    return [relative, bytes === null ? null : createHash("sha256").update(bytes).digest("hex")];
  }));
}

function summary(output) {
  return Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((key) => {
    const match = output.match(new RegExp(`^# ${key} (\\d+)\\r?$`, "m"));
    assert.ok(match, `Child did not provide a complete TAP ${key} total`);
    return [key, Number(match[1])];
  }));
}

function replay(t, relative, inputs, pattern) {
  const watched = [
    "tests/review-R50.test.mjs", relative, "docs/CONTRACT.md", "package.json",
    "package-lock.json", "tsconfig.json", ...inputs,
  ];
  const before = snapshot(watched);
  assert.notEqual(before[relative], null, `BLOCKED: reviewed script missing: ${relative}`);
  const receipts = [];
  for (const cwd of [root, testsDirectory]) {
    const args = ["--test", "--test-reporter=tap"];
    if (pattern) args.push(`--test-name-pattern=${pattern}`);
    args.push(path.join(root, relative));
    const startedAt = new Date().toISOString();
    const result = spawnSync(process.execPath, args, {
      cwd, encoding: "utf8", timeout: 30_000, maxBuffer: 2 * 1024 * 1024,
      windowsHide: true, shell: false,
    });
    assert.ifError(result.error);
    assert.equal(result.signal, null, "Child was interrupted rather than completing");
    const receipt = {
      startedAt, endedAt: new Date().toISOString(), node: process.version,
      cwd, executable: process.execPath, args, exit: result.status,
      totals: summary(result.stdout),
      outcomes: result.stdout.split(/\r?\n/).filter((line) => /^(?:not )?ok \d+ - /.test(line)),
      stderr: result.stderr.trim(),
    };
    receipts.push(receipt);
    t.diagnostic(JSON.stringify({ scope: "isolated review-script replay; not end-to-end", ...receipt }));
  }
  t.diagnostic(JSON.stringify({ observedSha256: before }));
  assert.deepEqual(snapshot(watched), before, "Inputs changed during replay; discard reproducibility claim and rerun");
  assert.deepEqual(receipts[0].totals, receipts[1].totals, "Working directory changed the reported totals");
  assert.deepEqual(receipts[0].outcomes, receipts[1].outcomes, "Working directory changed test outcomes");
  assert.equal(receipts[0].exit, receipts[1].exit, "Working directory changed the process exit code");
  assert.equal(receipts[0].totals.cancelled, 0);
  return receipts[0];
}

test("R50 replay: R20 skipped checks remain blocked despite process exit zero", (t) => {
  const receipt = replay(t, "tests/review-R20.test.mjs", ingestInputs);
  assert.equal(receipt.exit, 0);
  assert.equal(receipt.totals.tests, 10);
  assert.equal(receipt.totals.pass, 0, "Blocked placeholders must not be counted as passed validation");
  assert.equal(receipt.totals.fail, 0);
  assert.equal(receipt.totals.skipped, 10);
  assert.ok(receipt.outcomes.every((line) => /# SKIP BLOCKED:/.test(line)));
});

test("R50 replay: R21 missing-input failure is reproducible and remains a prerequisite gate", (t) => {
  if (ingestInputs.every((relative) => content(relative)?.toString("utf8").trim())) {
    t.skip("BLOCKED: prerequisites arrived; rereview the actual transactional behavior rather than accepting a presence check");
    return;
  }
  const receipt = replay(t, "tests/review-R21.test.mjs", ingestInputs);
  assert.equal(receipt.exit, 1, "An unmet prerequisite must propagate a nonzero process exit");
  assert.equal(receipt.totals.tests, 1);
  assert.equal(receipt.totals.pass, 0);
  assert.equal(receipt.totals.fail, 1);
  assert.equal(receipt.totals.skipped, 0);
});

test("R50 replay: actual anonymous UI rendering visibly labels synthetic content", (t) => {
  const receipt = replay(t, "tests/review-X01.test.mjs", uiInputs, "^X01: anonymous");
  assert.equal(receipt.totals.tests, 3, "Run only the three inspected executable React SSR cases");
  assert.equal(receipt.totals.skipped, 0);
  assert.equal(receipt.totals.todo, 0);
  assert.equal(receipt.exit, 0,
    `Anonymous React rendering failed a required assertion: ${receipt.outcomes.filter((line) => line.startsWith("not ok")).join("; ")}`);
});
