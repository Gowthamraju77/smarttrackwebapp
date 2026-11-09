import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as runtime from "react/jsx-runtime";
import ts from "typescript";

// Isolated, in-memory component checks: no Next build/server, DOM, network, or files written.
// Missing implementation is reported as BLOCKED, never as a passing behavior check.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nativeRequire = createRequire(import.meta.url);
const notFoundSignal = new Error("R15_NEXT_NOT_FOUND");

function locate(stem) {
  return [stem, ...[".tsx", ".ts", ".jsx", ".js"].map((ext) => stem + ext)]
    .find((candidate) => existsSync(candidate) && /\.[cm]?[jt]sx?$/.test(candidate));
}

function fixture(stem, t) {
  const filename = locate(path.join(root, stem));
  if (!filename) {
    t.skip(`BLOCKED: ${stem}.{tsx,ts,jsx,js} is not implemented`);
    return;
  }
  const source = readFileSync(filename, "utf8");
  t.diagnostic(`${path.relative(root, filename)} sha256=${createHash("sha256").update(source).digest("hex")}`);
  const elements = [];
  const capture = (factory) => (type, props, key) => {
    if (typeof type === "string") elements.push({ type, props });
    return factory(type, props, key);
  };
  const jsxRuntime = { ...runtime, jsx: capture(runtime.jsx), jsxs: capture(runtime.jsxs) };
  const cache = new Map();
  const counters = { resets: 0, reloads: 0 };
  const windowStub = { location: { reload: () => { counters.reloads += 1; } } };

  function load(file) {
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const output = ts.transpileModule(readFileSync(file, "utf8"), {
      fileName: file,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText;
    const requireModule = (id) => {
      if (id === "react/jsx-runtime") return jsxRuntime;
      if (id === "next/link") return {
        __esModule: true,
        default: (props) => jsxRuntime.jsx("a", props),
      };
      if (id === "next/navigation") return { notFound: () => { throw notFoundSignal; } };
      // Route checks isolate route validation; AppShell itself is reviewed statically.
      if (id === "@/components/app-shell") return {
        AppShell: ({ activeView }) => jsxRuntime.jsx("div", { "data-review-view": activeView }),
      };
      if (id.endsWith(".css")) return {};
      if (id.startsWith("@/") || id.startsWith(".")) {
        const local = id.startsWith("@/") ? path.join(root, id.slice(2)) : path.resolve(path.dirname(file), id);
        const resolved = locate(local) ?? locate(path.join(local, "index"));
        assert.ok(resolved, `Unresolved local dependency: ${id}`);
        return load(resolved);
      }
      return nativeRequire(id);
    };
    vm.runInThisContext(`(function(require,module,exports,window){${output}\n})`, { filename: file })(
      requireModule, mod, mod.exports, windowStub,
    );
    return mod.exports;
  }

  const Component = load(filename).default;
  assert.equal(typeof Component, "function", "Next special file needs a default component");
  return {
    source,
    Component,
    elements,
    counters,
    render(props = {}) { return renderToStaticMarkup(React.createElement(Component, props)); },
    reset() { counters.resets += 1; },
  };
}

function boundary(name, stem, check) {
  test(name, async (t) => {
    const loaded = fixture(stem, t);
    if (loaded) await check(loaded);
  });
}

function clientBoundary(source) {
  const ast = ts.createSourceFile("boundary.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const directives = [];
  for (const statement of ast.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) break;
    directives.push(statement.expression.text);
  }
  assert.ok(directives.includes("use client"), "Next error boundaries require a use client directive");
}

function visibleText(html) {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function accessibleHeading(html) {
  assert.match(html, /<h[1-6]\b[^>]*>[^]*?<\/h[1-6]>/, "A failure page needs a discoverable heading");
  assert.ok(visibleText(html).length > 12, "Provide meaningful explanatory text");
}

function syntheticError() {
  const error = new Error("R15_PRIVATE_MESSAGE_SENTINEL");
  error.stack = "R15_PRIVATE_STACK_SENTINEL";
  error.cause = "R15_PRIVATE_CAUSE_SENTINEL";
  error.digest = "r15-public-opaque-reference";
  return error;
}

function noPrivateDetails(html) {
  assert.doesNotMatch(html, /R15_PRIVATE_(?:MESSAGE|STACK|CAUSE)_SENTINEL/,
    "Error message, stack, and cause must not be rendered into user-facing HTML");
}

function recovery(f, allowReload = false) {
  f.render({ error: syntheticError(), reset: f.reset });
  const button = f.elements.find(({ type, props }) => type === "button" && !props.disabled
    && typeof props.onClick === "function"
    && /retry|try again|reload|reset|refresh/i.test(String(props["aria-label"] ?? "")
      + visibleText(renderToStaticMarkup(props.children))));
  assert.ok(button, "Provide a named, enabled native recovery button");
  button.props.onClick({ preventDefault() {}, stopPropagation() {} });
  assert.equal(f.counters.resets + (allowReload ? f.counters.reloads : 0), 1,
    "The recovery action must invoke reset (or a full reload for the global boundary) once");
}

boundary("R15.01 loading gives accessible, nonempty progress feedback", "app/loading", (f) => {
  const html = f.render();
  assert.match(html, /role="status"|aria-live="(?:polite|assertive)"/);
  assert.match(visibleText(html), /load|prepar|please wait|opening/i);
});

boundary("R15.02 route error is a client boundary with a meaningful heading", "app/error", (f) => {
  clientBoundary(f.source);
  accessibleHeading(f.render({ error: syntheticError(), reset: f.reset }));
});

boundary("R15.03 route error has a functional native reset button", "app/error", (f) => recovery(f));

boundary("R15.04 route error does not serialize private diagnostic details", "app/error", (f) => {
  noPrivateDetails(f.render({ error: syntheticError(), reset: f.reset }));
});

boundary("R15.05 global error supplies its own accessible document", "app/global-error", (f) => {
  clientBoundary(f.source);
  const html = f.render({ error: syntheticError(), reset: f.reset });
  assert.match(html, /<html\b[^>]*\blang="[^"]+"/);
  assert.match(html, /<body\b/);
  accessibleHeading(html);
});

boundary("R15.06 global error has a functional native recovery button", "app/global-error", (f) => recovery(f, true));

boundary("R15.07 global error does not serialize private diagnostic details", "app/global-error", (f) => {
  noPrivateDetails(f.render({ error: syntheticError(), reset: f.reset }));
});

boundary("R15.08 not-found explains failure and provides a named home link", "app/not-found", (f) => {
  const html = f.render();
  accessibleHeading(html);
  assert.match(visibleText(html), /404|not found|does not exist|couldn.t find|can.t find/i);
  const home = f.elements.find(({ type, props }) => type === "a" && props.href === "/"
    && (props["aria-label"] || visibleText(renderToStaticMarkup(props.children))));
  assert.ok(home, "Provide an accessible link back to the known home route");
});

boundary("R15.09 unknown section invokes Next notFound rather than returning the dashboard", "app/[section]/page", async (f) => {
  await assert.rejects(async () => f.Component({ params: Promise.resolve({ section: "r15-unknown-section" }) }),
    (error) => error === notFoundSignal, "Unknown sections must reach Next's 404 boundary");
});

boundary("R15.10 registered sections remain renderable", "app/[section]/page", async (f) => {
  for (const section of ["map", "journeys", "insights", "analytics", "alerts", "devices", "settings"]) {
    const element = await f.Component({ params: Promise.resolve({ section }) });
    assert.ok(React.isValidElement(element), `${section} must return a route element`);
  }
});
