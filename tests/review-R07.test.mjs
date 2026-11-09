import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// Isolated SSR availability gate. Transpilation is in memory; no build artifacts,
// dependency installation, network calls, or application source edits are needed.
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const modules = new Map();

function loadComponent(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const source = readFileSync(filename, "utf8");
  const { outputText } = ts.transpileModule(source, {
    fileName: filename,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  const module = { exports: {} };
  modules.set(filename, module);
  const localRequire = (specifier) => {
    if (!specifier.startsWith("@/") && !specifier.startsWith(".")) {
      return require(specifier);
    }
    const base = specifier.startsWith("@/")
      ? path.join(root, specifier.slice(2))
      : path.resolve(path.dirname(filename), specifier);
    const resolved = [base, `${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx")]
      .find((candidate) => /\.(tsx?|css)$/.test(candidate) && existsSync(candidate));
    assert.ok(resolved, `Unresolved local component dependency: ${specifier}`);
    if (resolved.endsWith(".css")) {
      return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    }
    return loadComponent(resolved);
  };
  new Function("require", "module", "exports", outputText)(localRequire, module, module.exports);
  return module.exports;
}

test("R07 availability: analytics renders a reviewable workspace instead of its generic placeholder", (t) => {
  for (const relative of ["components/app-shell.tsx", "components/section-view.tsx"]) {
    const hash = createHash("sha256").update(readFileSync(path.join(root, relative))).digest("hex");
    t.diagnostic(`${relative} sha256=${hash}`);
  }
  const { AppShell } = loadComponent(path.join(root, "components/app-shell.tsx"));
  const html = renderToStaticMarkup(React.createElement(AppShell, { activeView: "analytics" }));
  assert.match(html, /<h1\b[^>]*>Analytics<\/h1>/i, "The analytics view must resolve to its own page.");
  assert.ok(
    !/Your analytics workspace is ready/i.test(html),
    "BLOCKED: /analytics renders the generic SectionView placeholder; analytics filters, charts and accessible alternatives are not integrated.",
  );
});
