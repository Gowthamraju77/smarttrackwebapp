import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// C01 checks the UI module/caller boundary only. Compilation stays in memory;
// this does not invoke Next, emit files, exercise a browser, or contact services.
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const relative = (file) => path.relative(root, file).replaceAll("\\", "/");
function collect(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? collect(file) : /\.(tsx?|jsx?)$/.test(entry.name) ? [file] : [];
  });
}
const componentFiles = collect(path.join(root, "components")).sort();
const coreFiles = ["app-shell", "dashboard-view", "section-view"].map((name) => path.join(root, "components", `${name}.tsx`));
const entryFiles = ["app/page.tsx", "app/[section]/page.tsx", "app/layout.tsx"].map((file) => path.join(root, file));
const configPath = path.join(root, "tsconfig.json");
const config = ts.readConfigFile(configPath, ts.sys.readFile);
assert.equal(config.error, undefined, "tsconfig.json must be readable");
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram({
  rootNames: [...componentFiles, ...entryFiles, require.resolve("next/types/global.d.ts")],
  options: { ...parsed.options, incremental: false, noEmit: true, tsBuildInfoFile: undefined },
});
const checker = program.getTypeChecker();
const cache = new Map();

function loadUi(file) {
  file = path.resolve(file);
  if (cache.has(file)) return cache.get(file).exports;
  const source = readFileSync(file, "utf8");
  const output = ts.transpileModule(source, {
    fileName: file,
    compilerOptions: { ...parsed.options, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, isolatedModules: true },
  }).outputText;
  const loaded = { exports: {} };
  cache.set(file, loaded);
  const nativeRequire = createRequire(file);
  const localRequire = (specifier) => {
    // Styles do not participate in this interface-only server-render check.
    if (/\.css$/.test(specifier)) return new Proxy({}, { get: (_target, key) => key === "__esModule" ? false : String(key) });
    if (specifier.startsWith(".") || specifier.startsWith("@/")) {
      const base = specifier.startsWith("@/") ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(file), specifier);
      const resolved = [base, `${base}.tsx`, `${base}.ts`, `${base}.js`, path.join(base, "index.tsx"), path.join(base, "index.ts")].find((candidate) => existsSync(candidate) && /\.[cm]?[jt]sx?$/.test(candidate));
      assert.ok(resolved, `Unresolved UI dependency ${specifier} from ${relative(file)}`);
      assert.ok(!relative(resolved).startsWith("lib/server/") && !relative(resolved).startsWith("app/api/"), `Client module imported server implementation: ${relative(resolved)}`);
      return loadUi(resolved);
    }
    return nativeRequire(specifier);
  };
  new Function("require", "module", "exports", output)(localRequire, loaded, loaded.exports);
  return loaded.exports;
}

function sourceExports(file) {
  const source = program.getSourceFile(file);
  assert.ok(source, `Missing source ${relative(file)}`);
  const symbol = checker.getSymbolAtLocation(source);
  return symbol ? checker.getExportsOfModule(symbol) : [];
}
function publicViewKeys() {
  const view = sourceExports(coreFiles[0]).find((symbol) => symbol.name === "ViewKey");
  assert.ok(view, "AppShell must export the ViewKey type consumed by SectionView");
  const type = checker.getDeclaredTypeOfSymbol(view);
  assert.ok(type.isUnion(), "ViewKey must expose its finite navigation contract");
  return type.types.map((member) => {
    assert.ok(member.isStringLiteral(), "Each ViewKey must be a string literal");
    return member.value;
  });
}
function currentHref(markup) {
  const active = [...markup.matchAll(/<a\b[^>]*aria-current="page"[^>]*>/g)];
  assert.equal(active.length, 1, "A routed shell must select exactly one navigation destination");
  return /\bhref="([^"]+)"/.exec(active[0][0])?.[1];
}
const markup = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));

test("C01: available UI exports and consumers are TypeScript-compatible", (t) => {
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  const description = ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCanonicalFileName: (file) => file,
    getCurrentDirectory: () => root,
    getNewLine: () => "\n",
  });
  t.diagnostic(`UI roots: ${componentFiles.map(relative).join(", ")}`);
  t.diagnostic(`Source SHA256 prefixes: ${[...componentFiles, ...entryFiles].map((file) => `${relative(file)}=${createHash("sha256").update(readFileSync(file)).digest("hex").slice(0, 16)}`).join("; ")}`);
  assert.equal(diagnostics.length, 0, description);
});

test("C01: existing named exports resolve for their actual callers", () => {
  for (const [file, name] of [[coreFiles[0], "AppShell"], [coreFiles[1], "DashboardView"], [coreFiles[2], "SectionView"]]) {
    assert.equal(typeof loadUi(file)[name], "function", `${relative(file)} must export ${name}`);
  }
  assert.equal(typeof loadUi(entryFiles[0]).default, "function");
  assert.equal(typeof loadUi(entryFiles[1]).default, "function");
});

test("C01: every public ViewKey renders and selects its own navigation route", () => {
  const { AppShell, navGroups } = loadUi(coreFiles[0]);
  const views = publicViewKeys();
  const destinations = [...navGroups.flatMap((group) => group.items), { view: "settings", href: "/settings" }];
  assert.deepEqual(destinations.map((item) => item.view).sort(), [...views].sort());
  assert.equal(new Set(destinations.map((item) => item.href)).size, destinations.length);
  for (const destination of destinations) {
    assert.equal(currentHref(markup(AppShell, { activeView: destination.view })), destination.href, destination.view);
  }
});

test("C01: optional shell props and unknown section input retain a valid fallback", () => {
  const { AppShell } = loadUi(coreFiles[0]);
  for (const props of [undefined, {}, { activeView: "" }, { activeView: "unregistered-review-route" }]) {
    assert.equal(currentHref(markup(AppShell, props)), "/");
  }
});

test("C01: Next page adapters preserve dashboard and promised section params", async () => {
  const HomePage = loadUi(entryFiles[0]).default;
  const SectionPage = loadUi(entryFiles[1]).default;
  assert.equal(currentHref(renderToStaticMarkup(HomePage())), "/");
  for (const section of publicViewKeys()) {
    const tree = await SectionPage({ params: Promise.resolve({ section }) });
    assert.ok(React.isValidElement(tree), `SectionPage must return a React element for ${section}`);
    assert.equal(currentHref(renderToStaticMarkup(tree)), section === "dashboard" ? "/" : `/${section}`);
  }
});

test("C01: separately delivered UI workstream components can be imported", (t) => {
  const workstreamFiles = componentFiles.filter((file) => !coreFiles.includes(file));
  if (!workstreamFiles.length) {
    t.skip("BLOCKED: only the three existing shell/dashboard/section modules are available; no separately delivered UI workstream modules to verify.");
    return;
  }
  for (const file of workstreamFiles) {
    const exports = sourceExports(file);
    const components = exports.filter((symbol) => symbol.name === "default" || /^[A-Z]/.test(symbol.name)).filter((symbol) => checker.getTypeOfSymbolAtLocation(symbol, program.getSourceFile(file)).getCallSignatures().length);
    // Co-located type/helper files need not export a React component.
    if (!file.endsWith(".tsx")) continue;
    assert.ok(components.length, `${relative(file)} has no callable public component export`);
    const loaded = loadUi(file);
    for (const component of components) {
      assert.equal(typeof loaded[component.name], "function", `Missing runtime export ${relative(file)}#${component.name}`);
    }
    t.diagnostic(`${relative(file)}: ${components.map((component) => component.name).join(", ")}`);
  }
});
