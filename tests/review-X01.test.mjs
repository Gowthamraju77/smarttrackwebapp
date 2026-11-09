import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Isolated review only: in-memory TSX loading and actual React server rendering.
// No Next build, writes, network, hosted authentication, or database execution.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const absolute = (relative) => path.join(root, relative);
const cache = new Map();
const observed = new Map();
const apiPaths = [
  "lib/server/security.ts",
  "lib/server/supabase.ts",
  "lib/server/operations.ts",
  "lib/server/ingest.ts",
  "app/api/devices/route.ts",
  "app/api/journeys/route.ts",
  "app/api/alerts/route.ts",
  "app/api/sos/[id]/route.ts",
  "app/api/ingest/route.ts",
  "app/api/sos/route.ts",
];

function inspect(relative) {
  const filename = absolute(relative);
  if (!existsSync(filename)) return null;
  const text = readFileSync(filename, "utf8");
  observed.set(relative, createHash("sha256").update(text).digest("hex"));
  return text;
}

function loadSource(relative) {
  const filename = absolute(relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const source = inspect(relative);
  assert.notEqual(source, null, `Missing rendered source: ${relative}`);
  const module = { exports: {} };
  cache.set(filename, module);
  const nodeRequire = createRequire(filename);
  const localRequire = (specifier) => {
    if (specifier.startsWith("@/") || specifier.startsWith(".")) {
      const base = specifier.startsWith("@/")
        ? absolute(specifier.slice(2))
        : path.resolve(path.dirname(filename), specifier);
      const dependency = [base, `${base}.tsx`, `${base}.ts`, `${base}.js`, path.join(base, "index.tsx"), path.join(base, "index.ts")]
        .find((candidate) => /\.(?:tsx?|jsx?)$/.test(candidate) && existsSync(candidate));
      assert.ok(dependency, `Unresolved isolated source dependency: ${specifier}`);
      assert.ok(!path.relative(root, dependency).startsWith(".."), "Fixture must remain in the workspace");
      return loadSource(path.relative(root, dependency).replaceAll(path.sep, "/"));
    }
    return nodeRequire(specifier);
  };
  const { outputText } = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const execute = vm.runInThisContext(
    `(function(require, module, exports) {\n${outputText}\n})`,
    { filename },
  );
  execute(localRequire, module, module.exports);
  return module.exports;
}

function visibleText(markup) {
  return markup
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");
}

test("X01: anonymous root renders as an executable UI fixture", () => {
  const { default: HomePage } = loadSource("app/page.tsx");
  const markup = renderToStaticMarkup(React.createElement(HomePage));
  assert.match(markup, /<main\b/, "Root should render an actual page rather than an empty fixture");
  assert.match(markup, /SmartTrack/, "Expected application identity");
});

test("X01: anonymous dashboard visibly identifies synthetic/demo content", () => {
  const { default: HomePage } = loadSource("app/page.tsx");
  const text = visibleText(renderToStaticMarkup(React.createElement(HomePage)));
  assert.ok(/\b(?:demo|synthetic)\b/i.test(text),
    "CONTRACT.md:4,26 require visible demo identification; an SVG/ARIA-only demo description does not label the anonymous dashboard");
});

test("X01: anonymous devices page identifies synthetic/demo content", async () => {
  const { default: SectionPage } = loadSource("app/[section]/page.tsx");
  const element = await SectionPage({ params: Promise.resolve({ section: "devices" }) });
  const text = visibleText(renderToStaticMarkup(element));
  assert.ok(/\bdevices\b/i.test(text), "The devices route must actually be rendered");
  assert.ok(/\b(?:demo|synthetic)\b/i.test(text), "Public preview should be labelled as synthetic");
});

test("X01: browser-to-API authentication and fail-closed route gate", (t) => {
  const missing = apiPaths.filter((relative) => inspect(relative) === null);
  if (missing.length) {
    t.skip(`BLOCKED: authorization chain implementation absent: ${missing.join(", ")}`);
    return;
  }
  t.skip("BLOCKED: implementation is now present; review its exact interfaces and add isolated request/role/origin fixtures before claiming this gate passed");
});

test("X01: API-to-database tenant and role enforcement gate", (t) => {
  if (inspect("database/schema.sql") === null) {
    t.skip("BLOCKED: database/schema.sql absent; no RLS, role/RPC grant, tenant-scope, or audit implementation available to review");
    return;
  }
  t.skip("BLOCKED: SQL availability is not database execution; require a disposable migrated Supabase/Postgres fixture with two tenants and four role identities");
});

test("X01: compare authorization conclusions with C/R reports", (t) => {
  const directory = absolute("docs/reviews");
  const reports = existsSync(directory)
    ? readdirSync(directory).filter((name) => /^[CR]\d.*\.md$/i.test(name)).sort()
    : [];
  for (const report of reports) inspect(`docs/reviews/${report}`);
  if (!reports.length) {
    t.skip("BLOCKED: no C/R reports in docs/reviews at this observation");
    return;
  }
  t.diagnostic(`Available reports (contents require independent cross-review): ${reports.join(", ")}`);
  t.skip("BLOCKED: report presence alone cannot establish agreement or executed authorization coverage");
});

test("X01: evidence receipt for this isolated process", (t) => {
  inspect("docs/CONTRACT.md");
  assert.ok(observed.size > 0);
  t.diagnostic(JSON.stringify({
    round: process.env.X01_REPEAT ?? "single",
    observedAt: new Date().toISOString(),
    node: process.version,
    scope: "isolated in-memory React SSR plus missing-dependency inventory; NOT browser/API/database end-to-end",
    sha256: Object.fromEntries(observed),
  }));
});
