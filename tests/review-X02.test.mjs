import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Isolated review checks. TypeScript/TSX is transpiled in memory using the
// existing dependency; there is no build, emitted file, install or network.
// Server rendering covers initial visible copy, not browser interactions.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const loaded = new Map();
const fingerprints = new Map();

function source(relative) {
  const text = readFileSync(path.join(root, relative), "utf8");
  fingerprints.set(relative.replaceAll("\\", "/"), createHash("sha256").update(text).digest("hex"));
  return text;
}

function load(relative) {
  const absolute = path.resolve(root, relative);
  if (loaded.has(absolute)) return loaded.get(absolute).exports;
  const module = { exports: {} };
  loaded.set(absolute, module);
  const output = ts.transpileModule(source(path.relative(root, absolute)), {
    fileName: absolute,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const localRequire = (specifier) => {
    if (specifier.endsWith(".css")) {
      // Class names cannot affect the semantic text assertions below.
      return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    }
    if (specifier.startsWith("@/") || specifier.startsWith(".")) {
      const base = specifier.startsWith("@/")
        ? path.resolve(root, specifier.slice(2))
        : path.resolve(path.dirname(absolute), specifier);
      const match = [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, path.join(base, "index.ts"), path.join(base, "index.tsx")]
        .find((candidate) => /\.(ts|tsx|js)$/.test(candidate) && existsSync(candidate));
      assert.ok(match, `Review loader cannot resolve ${specifier} from ${relative}`);
      return load(path.relative(root, match));
    }
    return createRequire(absolute)(specifier);
  };
  new Function("require", "module", "exports", output)(localRequire, module, module.exports);
  return module.exports;
}

function visibleText(Component, props) {
  return renderToStaticMarkup(React.createElement(Component, props))
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

function requireFiles(t, files) {
  const missing = files.filter((file) => !existsSync(path.join(root, file)));
  if (!missing.length) return true;
  t.skip(`BLOCKED: implementation dependencies absent: ${missing.join(", ")}`);
  return false;
}

async function withBrowser(t, token, request, action) {
  t.mock.method(globalThis, "fetch", request);
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      location: { origin: "https://smarttrack.invalid" },
      sessionStorage: { getItem: () => token },
    },
  });
  try {
    return await action();
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
    t.mock.restoreAll();
  }
}

test("X02-01 dashboard synthetic trust and live operations have a visible demo disclosure", (t) => {
  if (!requireFiles(t, ["components/app-shell.tsx"])) return;
  const { AppShell } = load("components/app-shell.tsx");
  const text = visibleText(AppShell, { activeView: "dashboard" });
  assert.ok(/\b(?:demo|synthetic|simulation)\b/i.test(text),
    "Dashboard shows operational data without a visible demo/synthetic disclosure. An aria-label alone does not disclose to sighted users.");
});

test("X02-02 trust screen distinguishes reliability indices from safety probabilities", (t) => {
  if (!requireFiles(t, ["components/app-shell.tsx"])) return;
  const { AppShell } = load("components/app-shell.tsx");
  const text = visibleText(AppShell, { activeView: "insights" });
  assert.ok(/reliability/i.test(text) && /not.{0,80}(?:safety|probability)|(?:safety|probability).{0,80}not/i.test(text),
    "Trust & safety screen needs the reliability-index / not-a-safety-probability qualification required by the ML contract.");
});

test("X02-03 client preserves service-unavailable as an error instead of empty/demo operational data", async (t) => {
  if (!requireFiles(t, ["lib/client/api.ts"])) return;
  const { apiGet } = load("lib/client/api.ts");
  let calls = 0;
  await withBrowser(t, "synthetic-review-token", async () => {
    calls++;
    return new Response('{"error":"unavailable"}', { status: 503 });
  }, async () => {
    await assert.rejects(apiGet("/api/alerts"), (error) => error.code === "UNCONFIGURED" && error.status === 503);
  });
  assert.equal(calls, 1, "Unavailable operations must not cause hidden retries or demo retrieval.");
});

test("X02-04 failed SOS transition is not reported as a successful acknowledgement", async (t) => {
  if (!requireFiles(t, ["lib/client/api.ts"])) return;
  const { apiPatch } = load("lib/client/api.ts");
  let calls = 0;
  await withBrowser(t, "synthetic-review-token", async () => {
    calls++;
    return new Response('{"error":"forbidden"}', { status: 403 });
  }, async () => {
    await assert.rejects(apiPatch("/api/sos/synthetic-review-event", { action: "acknowledge" }),
      (error) => error.code === "FORBIDDEN" && error.status === 403);
  });
  assert.equal(calls, 1);
});

test("X02-05 no browser authentication cannot become a submitted SOS transition", async (t) => {
  if (!requireFiles(t, ["lib/client/api.ts"])) return;
  const { apiPatch } = load("lib/client/api.ts");
  let calls = 0;
  await withBrowser(t, null, async () => { calls++; return new Response("{}"); }, async () => {
    await assert.rejects(apiPatch("/api/sos/synthetic-review-event", { action: "resolve" }),
      (error) => error.code === "AUTH_REQUIRED" && error.status === 401);
  });
  assert.equal(calls, 0, "Unauthenticated transitions must stop before transport.");
});

test("X02-06 transport loss during SOS transition is an error without automatic retry", async (t) => {
  if (!requireFiles(t, ["lib/client/api.ts"])) return;
  const { apiPatch } = load("lib/client/api.ts");
  let calls = 0;
  await withBrowser(t, "synthetic-review-token", async () => { calls++; throw new TypeError("synthetic link loss"); }, async () => {
    await assert.rejects(apiPatch("/api/sos/synthetic-review-event", { action: "acknowledge" }),
      (error) => error.code === "NETWORK_ERROR");
  });
  assert.equal(calls, 1);
});

test("X02-07 client preserves absent ML and stale GPS evidence instead of inventing values", async (t) => {
  if (!requireFiles(t, ["lib/client/api.ts"])) return;
  const { getDevices } = load("lib/client/api.ts");
  const devices = [{
    id: "synthetic-review-device",
    trust_score: null,
    gps: { fix: true, lat: 0, lon: 0, age_ms: 60000 },
    recorded_at: null,
    received_at: "2026-10-11T00:00:00.000Z",
  }];
  await withBrowser(t, "synthetic-review-token", async () => Response.json({ devices }), async () => {
    assert.deepEqual(await getDevices(), devices);
  });
});

test("X02-08 firmware SOS page separates acknowledgement, resolution and delivery [source check]", (t) => {
  if (!requireFiles(t, ["firmware/include/ui/page_sos.h"])) return;
  const text = source("firmware/include/ui/page_sos.h");
  assert.match(text, /ACKNOWLEDGED - NOT RESOLVED/);
  assert.match(text, /Link status is not delivery confirmation/);
  assert.match(text, /Local SOS needs no network or GPS/);
  assert.doesNotMatch(text, /state\.(?:sosActive|sosAcknowledged)\s*=(?!=)/,
    "Rendering must not clear or acknowledge a local incident.");
});

test("X02-09 firmware responder page does not equate acknowledgement with assistance [source check]", (t) => {
  if (!requireFiles(t, ["firmware/include/ui/page_responder.h"])) return;
  const text = source("firmware/include/ui/page_responder.h");
  assert.match(text, /Acknowledgment does not confirm/);
  assert.match(text, /assistance or resolution/);
});

test("X02-10 firmware GPS display has an explicit stale path; map uses last-known position [source check]", (t) => {
  if (!requireFiles(t, ["firmware/include/ui/page_gps.h", "firmware/include/ui/page_map.h"])) return;
  const gps = source("firmware/include/ui/page_gps.h");
  const map = source("firmware/include/ui/page_map.h");
  assert.match(gps, /STALE GPS FIX/);
  assert.match(gps, /Position hidden until a fresh fix/);
  assert.match(map, /LAST-KNOWN POSITION/);
  assert.match(map, /Fix age:/);
});

for (const [name, dependencies, reason] of [
  ["X02-11 firmware SOS without GPS/ML persists identity until exact server receipt",
    ["firmware/src/main.cpp"], "Needs firmware creation/queue/transport trace and replay test; display-copy checks do not prove the data path."],
  ["X02-12 API accepts null-time no-fix SOS without ML, with idempotent retries",
    ["app/api/sos/route.ts", "lib/server/ingest.ts", "database/schema.sql"], "Needs production validator and transactional RPC checks; a browser client cannot prove server acceptance."],
  ["X02-13 server acknowledgement and resolution remain separate audited transitions",
    ["app/api/sos/[id]/route.ts", "lib/server/operations.ts", "database/schema.sql"], "Needs tenant/role checks and transition audit evidence, including retries and resolve-before-ack behavior."],
  ["X02-14 ML rejects unavailable/unpromoted/synthetic artifacts without numeric production scores",
    ["ml/smarttrack_ml/service.py", "ml/smarttrack_ml/model.py", "ml/smarttrack_ml/scoring.py"], "Needs actual ML unavailable, provenance and promoted-artifact branch tests."],
  ["X02-15 stale timestamps/unknown age remain consistent from firmware through ML, API and UI",
    ["firmware/src/main.cpp", "ml/smarttrack_ml/features.py", "lib/server/operations.ts"], "Needs shared freshness/age policy and an integrated clock fixture, including offline replay, null clock, receive-vs-record time and future time."],
]) {
  test(name, (t) => {
    if (!requireFiles(t, dependencies)) return;
    t.skip(`BLOCKED pending source-specific integration verification: ${reason}`);
  });
}

test("X02 review snapshot receipt", (t) => {
  for (const [file, hash] of [...fingerprints].sort(([left], [right]) => left.localeCompare(right))) {
    t.diagnostic(`sha256 ${hash} ${file}`);
  }
  t.diagnostic("Source-copy checks are not executed C++ or end-to-end checks. Main integration owns ten final executable verification rounds.");
});
