import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Static boundary checks, isolated ingest behavior, and blocked input gates.
// Ingest runs in memory with synthetic configuration and mocked HTTP only.
// These are not deployed Vercel/DB/ML tests and produce no build artifacts.
const root = fileURLToPath(new URL("../", import.meta.url));
const exists = (relative) => existsSync(path.join(root, relative));
const read = (relative) => readFileSync(path.join(root, relative), "utf8");
function walk(relative) {
  if (!exists(relative)) return [];
  return readdirSync(path.join(root, relative), { withFileTypes: true }).flatMap((entry) => {
    const child = path.posix.join(relative, entry.name);
    return entry.isDirectory() ? walk(child) : entry.isFile() ? [child] : [];
  });
}

const webFiles = ["app", "components", "lib", "pages", "api", "src"].flatMap(walk);
const runtimeFiles = [...webFiles, ...[
  "next.config.ts", "next.config.js", "next.config.mjs", "middleware.ts", "instrumentation.ts",
].filter(exists)].filter((file) => /\.(?:[cm]?js|jsx|ts|tsx)$/.test(file) && !file.endsWith(".d.ts")).sort();
const modules = runtimeFiles.map((file) => {
  const source = read(file);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const imports = [];
  const calls = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      const expression = node.expression;
      calls.push(ts.isPropertyAccessExpression(expression) ? expression.name.text : expression.getText(ast));
      if (ts.isCallExpression(node) && (expression.kind === ts.SyntaxKind.ImportKeyword || expression.getText(ast) === "require")) {
        const target = node.arguments[0];
        if (target && ts.isStringLiteral(target)) imports.push(target.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const client = ast.statements.some((statement) => ts.isExpressionStatement(statement)
    && ts.isStringLiteral(statement.expression) && statement.expression.text === "use client");
  return { file, source, imports, calls, client };
});
const serverModules = modules.filter(({ file, client }) => !client && !file.startsWith("components/"));
const pkg = JSON.parse(read("package.json"));
const snapshot = createHash("sha256");
for (const file of ["package.json", ...runtimeFiles]) snapshot.update(`${file}\0${read(file)}\0`);
const fingerprint = snapshot.digest("hex");
const offenders = (items, predicate) => items.filter(predicate).map(({ file }) => file);

function inputGate(name, required, reason) {
  const missing = required.filter((file) => !exists(file));
  test(name, { skip: missing.length ? `BLOCKED: missing ${missing.join(", ")}; ${reason}` : false }, (t) => {
    for (const file of required) assert.ok(read(file).trim(), `${file} is empty`);
    t.diagnostic("Input availability only; the corresponding behavior still needs review and execution.");
  });
}

test("R45.1 static: the web package uses Next startup without a co-started daemon", (t) => {
  assert.ok(pkg.dependencies?.next, "Next dependency is missing");
  assert.match(pkg.scripts?.build ?? "", /\bnext\s+build\b/);
  assert.match(pkg.scripts?.start ?? "", /^next\s+start(?:\s|$)/);
  const startup = ["prestart", "start", "poststart"].map((name) => pkg.scripts?.[name] ?? "").join("\n");
  assert.doesNotMatch(startup, /\b(?:python3?|uvicorn|gunicorn|celery|pm2|concurrently)\b/i);
  t.diagnostic(`Reviewed runtime inventory: ${runtimeFiles.join(", ")}`);
  t.diagnostic(`Runtime/package SHA256: ${fingerprint}`);
});

test("R45.2 static: Next is not configured as a static-only export", () => {
  const config = modules.filter(({ file }) => file.startsWith("next.config."));
  assert.ok(config.length, "Next configuration is missing");
  for (const { source } of config) assert.doesNotMatch(source, /\boutput\s*:\s*["']export["']/);
});

test("R45.3 static: available web modules have no detected local persistence operations", () => {
  const localStores = /^(?:(?:node:)?sqlite|sqlite3|better-sqlite3|lowdb|nedb|node-persist|jsonfile|level)(?:\/|$)/;
  const writes = /^(?:writeFile(?:Sync)?|appendFile(?:Sync)?|createWriteStream)$/;
  assert.deepEqual(offenders(modules, ({ imports, calls }) => imports.some((name) => localStores.test(name))
    || calls.some((name) => writes.test(name))), []);
  const dependencies = Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies });
  assert.deepEqual(dependencies.filter((name) => localStores.test(name)), []);
});

test("R45.4 static: web modules do not import subprocess, thread or embedded-Python runtimes", () => {
  const forbidden = /^(?:(?:node:)?(?:child_process|worker_threads)|python-shell|pyodide)(?:\/|$)/;
  assert.deepEqual(offenders(modules, ({ imports }) => imports.some((name) => forbidden.test(name))), []);
});

test("R45.5 static: available server entry points contain no persistent timer or listener calls", () => {
  // Client UI timers are not server workers. This is a direct-call inventory,
  // not proof against aliases, computed calls, or indirect third-party workers.
  const persistent = /^(?:setInterval|createServer|listen|Worker|SharedWorker)$/;
  assert.deepEqual(offenders(serverModules, ({ calls }) => calls.some((name) => persistent.test(name))), []);
});

test("R45.6 static: Python is not mapped into the web function tree", () => {
  assert.deepEqual(webFiles.filter((file) => file.endsWith(".py")), []);
  if (exists("vercel.json")) {
    const config = JSON.parse(read("vercel.json"));
    const mappings = JSON.stringify({ builds: config.builds, functions: config.functions });
    assert.doesNotMatch(mappings, /@vercel\/python|\.py\b|["']ml\//i);
  }
});

inputGate("R45.7 prerequisite: durable Supabase implementation is available", [
  "database/schema.sql", "lib/server/supabase.ts",
], "cannot trace authoritative storage, cross-instance retries or transactions");

const ingestInputs = ["app/api/ingest/route.ts", "app/api/sos/route.ts", "lib/server/ingest.ts"];
const missingIngest = ingestInputs.filter((file) => !exists(file));
test("R45.8 isolated: ingestion waits for external storage and fails closed without its receipt", {
  skip: missingIngest.length ? `BLOCKED: missing ${missingIngest.join(", ")}` : false,
}, async () => {
  const source = read("lib/server/ingest.ts");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const require = createRequire(import.meta.url);
  function isolatedIngest() {
    const exports = {};
    runInNewContext(javascript, {
      exports,
      require: (name) => {
        assert.equal(name, "node:crypto", "Review new ingest imports before allowing them into the isolated test");
        return require(name);
      },
      Buffer, TextDecoder, Request, Response, AbortSignal, URL,
    }, { filename: "R45-isolated-ingest.js", timeout: 1000 });
    return exports;
  }
  const env = { SUPABASE_URL: "https://r45-db.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "r45-synthetic-service-key" };
  const payload = {
    version: 1, device_id: "r45-synthetic-device", record_id: "r45-synthetic-record", recorded_at: null,
    boot_id: "r45-synthetic-boot", sequence: 1, uptime_ms: 1,
    gps: { fix: false, lat: null, lon: null, speed_mps: null, hdop: null, age_ms: null }, imu: null,
  };
  const ingest = isolatedIngest();
  const makeRequest = () => {
    const text = JSON.stringify(payload);
    return new Request("https://r45-app.example.invalid/api/ingest", {
      method: "POST", headers: { Authorization: "Bearer r45-synthetic-device-secret", "Content-Type": "application/json" },
      body: JSON.stringify({ payload: text, crc32: ingest.crc32Utf8(text) }),
    });
  };
  let rpcCalls = 0;
  let reachedStorage;
  let completeStorage;
  const storageReached = new Promise((resolve) => { reachedStorage = resolve; });
  const storageReceipt = new Promise((resolve) => { completeStorage = resolve; });
  let requestFinished = false;
  const pending = ingest.handleDeviceIngest(makeRequest(), "telemetry", {
    env,
    fetch: (url, options) => {
      rpcCalls += 1;
      assert.equal(url, "https://r45-db.example.invalid/rest/v1/rpc/ingest_device_record");
      assert.equal(options.cache, "no-store");
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      reachedStorage();
      return storageReceipt;
    },
  }).then((response) => { requestFinished = true; return response; });
  await storageReached;
  assert.equal(requestFinished, false, "A request must not complete before the external storage receipt");
  completeStorage(Response.json({ accepted: true, record_id: payload.record_id, duplicate: false }));
  const accepted = await pending;
  assert.equal(accepted.status, 200);
  assert.equal(accepted.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await accepted.json(), { accepted: true, record_id: payload.record_id, duplicate: false });

  // A fresh module instance forwards the same identity to storage; the mock,
  // not a process-local cache, supplies duplicate=true. Real dedupe needs DB tests.
  const retry = await isolatedIngest().handleDeviceIngest(makeRequest(), "telemetry", {
    env,
    fetch: async (_url, options) => {
      rpcCalls += 1;
      assert.equal(JSON.parse(options.body).p_payload.record_id, payload.record_id);
      return Response.json({ accepted: true, record_id: payload.record_id, duplicate: true });
    },
  });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json()).duplicate, true);
  assert.equal(rpcCalls, 2, "Both instances must call external storage");

  let unconfiguredFetches = 0;
  const unconfigured = await ingest.handleDeviceIngest(makeRequest(), "telemetry", {
    env: {}, fetch: async () => { unconfiguredFetches += 1; throw new Error("Unexpected HTTP call"); },
  });
  assert.equal(unconfigured.status, 503);
  assert.equal(unconfiguredFetches, 0);
  assert.notEqual((await unconfigured.json()).accepted, true);

  const unavailable = await ingest.handleDeviceIngest(makeRequest(), "telemetry", {
    env, fetch: async () => { throw new Error("Synthetic storage outage"); },
  });
  assert.equal(unavailable.status, 503);
  assert.notEqual((await unavailable.json()).accepted, true);
  const unconfirmed = await ingest.handleDeviceIngest(makeRequest(), "telemetry", {
    env, fetch: async () => Response.json({ accepted: true, record_id: "wrong-record", duplicate: false }),
  });
  assert.equal(unconfirmed.status, 502);
  assert.notEqual((await unconfirmed.json()).accepted, true);
});

inputGate("R45.9 prerequisite: separate Python ML service is available", [
  "ml/smarttrack_ml/service.py",
], "cannot verify external deployment, authentication, request bounds or unavailable behavior");

const deploymentDocs = [...walk("docs"), ...["README.md"].filter(exists)]
  .filter((file) => /\.mdx?$/.test(file) && !file.startsWith("docs/reviews/") && file !== "docs/CONTRACT.md")
  .filter((file) => /vercel/i.test(read(file)));
test("R45.10 prerequisite: an actionable Vercel deployment runbook is available", {
  skip: deploymentDocs.length === 0 ? "BLOCKED: only the architecture contract is available; Vercel/Supabase/external-Python deployment instructions are missing" : false,
}, (t) => {
  const documentation = deploymentDocs.map(read).join("\n");
  assert.match(documentation, /Supabase|Postgres/i);
  assert.match(documentation, /Python|FastAPI/i);
  t.diagnostic(`Runbook input availability only: ${deploymentDocs.join(", ")}; credentials, deployment and delivery remain untested.`);
});
