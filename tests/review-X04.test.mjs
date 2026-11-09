import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

// In-memory TSX evaluation only: no Next build, server, browser, or output files.
// These checks exercise initial server rendering and inspect source/CSS; they are
// deliberately not presented as keyboard/screen-reader or end-to-end tests.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const sources = new Map();
const modules = new Map();
const evaluatedModules = new Set();
let renderedElements = [];

function source(relative) {
  const absolute = path.resolve(root, relative);
  if (!sources.has(absolute)) sources.set(absolute, readFileSync(absolute, "utf8"));
  return sources.get(absolute);
}

function localImport(specifier, owner) {
  const base = specifier.startsWith("@/")
    ? path.join(root, specifier.slice(2))
    : specifier.startsWith(".") ? path.resolve(path.dirname(owner), specifier) : null;
  if (!base) return null;
  return [base, `${base}.tsx`, `${base}.ts`, `${base}.jsx`, `${base}.js`,
    path.join(base, "index.tsx"), path.join(base, "index.ts")]
    .find((candidate) => existsSync(candidate) && /\.(?:[cm]?[jt]sx?|css)$/.test(candidate)) ?? null;
}

function load(relative) {
  const filename = path.resolve(root, relative);
  if (modules.has(filename)) return modules.get(filename).exports;
  const module = { exports: {} };
  modules.set(filename, module);
  evaluatedModules.add(path.relative(root, filename).replaceAll("\\", "/"));
  const output = ts.transpileModule(source(filename), {
    fileName: filename,
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  }).outputText;
  const localRequire = (specifier) => {
    if (specifier === "react/jsx-runtime") {
      const runtime = require(specifier);
      return Object.fromEntries(Object.entries(runtime).map(([key, value]) => [key,
        key === "jsx" || key === "jsxs" ? (type, props, ...rest) => {
          if (typeof type === "string") renderedElements.push({ type, props, filename });
          return value(type, props, ...rest);
        } : value]));
    }
    if (specifier.endsWith(".css")) return new Proxy({}, { get: (_, key) => String(key) });
    const resolved = localImport(specifier, filename);
    return resolved ? load(resolved) : require(specifier);
  };
  const evaluate = vm.runInThisContext(
    `(function(require,module,exports,__filename,__dirname){${output}\n})`, { filename },
  );
  evaluate(localRequire, module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

function decode(text) {
  return text.replaceAll("&amp;", "&").replaceAll("&#x27;", "'")
    .replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">")
    .replaceAll("&nbsp;", " ");
}

function visibleText(html) {
  return decode(html.replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/g, " ")
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function attribute(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return decode(attributes.match(new RegExp(`(?:^|\\s)${escaped}="([^"]*)"`))?.[1] ?? "");
}

function elements(html, tag) {
  return [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}>`, "g"))]
    .map((match) => ({ attributes: match[1], inner: match[2], text: visibleText(match[2]) }));
}

function elementName(element) {
  return element.props["aria-label"] || element.props.title || visibleText(renderToStaticMarkup(
    React.createElement(React.Fragment, null, element.props.children),
  ));
}

const advertisedRoutes = ["/", "/map", "/journeys", "/insights", "/analytics", "/alerts", "/devices", "/settings"];
const cache = new Map();
async function route(url) {
  if (cache.has(url)) return cache.get(url);
  renderedElements = [];
  const page = url === "/"
    ? await load("app/page.tsx").default({})
    : await load("app/[section]/page.tsx").default({ params: Promise.resolve({ section: url.slice(1) }) });
  const html = renderToStaticMarkup(page);
  const result = { html, text: visibleText(html), elements: [...renderedElements] };
  cache.set(url, result);
  return result;
}

function componentFiles(directory = path.join(root, "components")) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? componentFiles(file)
      : /\.[jt]sx?$/.test(entry.name) ? [path.relative(root, file).replaceAll("\\", "/")] : [];
  });
}

test("X04-01: every advertised route renders a heading and correctly identifies its current navigation link", async (t) => {
  for (const url of advertisedRoutes) {
    const rendered = await route(url);
    const current = elements(rendered.html, "a").filter((link) => attribute(link.attributes, "aria-current") === "page");
    assert.ok(elements(rendered.html, "h1").some((heading) => heading.text), `${url}: no main heading`);
    assert.ok(current.some((link) => attribute(link.attributes, "href") === url), `${url}: wrong current link`);
    t.diagnostic(`${url}: ${elements(rendered.html, "h1").map((heading) => heading.text).join("; ")}`);
  }
  t.diagnostic(`Evaluated local modules: ${[...evaluatedModules].sort().join(", ")}`);
  t.diagnostic(`Component files not evaluated by these routes (integration unverified): ${componentFiles().filter((file) => !evaluatedModules.has(file)).join(", ") || "none present"}`);
  t.diagnostic(`Source fingerprints: ${[...sources].map(([name, text]) => `${path.relative(root, name).replaceAll("\\", "/")}=${createHash("sha256").update(text).digest("hex").slice(0, 12)}`).join(", ")}`);
});

test("X04-02: an unsupported section is rejected as not found rather than displaying the dashboard", async () => {
  await assert.rejects(() => route("/x04-definitely-unsupported"), (error) =>
    typeof error?.digest === "string" && /(?:404|NOT_FOUND)/.test(error.digest),
  );
});

test("X04-03: synthetic default data has a visible demo/synthetic disclosure on every advertised route", async () => {
  const undisclosed = [];
  for (const url of advertisedRoutes) {
    if (!/\b(?:demo|synthetic)\b/i.test((await route(url)).text)) undisclosed.push(url);
  }
  assert.deepEqual(undisclosed, [], `No visible demo disclosure on: ${undisclosed.join(", ")}`);
});

test("X04-04: enabled action buttons on reachable screens have an action binding or associated form action", async () => {
  const inert = new Set();
  for (const url of advertisedRoutes) {
    const rendered = await route(url);
    const forms = rendered.elements.filter((element) => element.type === "form");
    for (const element of rendered.elements.filter((item) => item.type === "button")) {
      const props = element.props;
      if (props.disabled || props["aria-disabled"] === true || props["aria-disabled"] === "true") continue;
      const bound = [props.onClick, props.onPointerDown, props.onKeyDown, props.formAction].some((value) => typeof value === "function");
      const submits = props.type === "submit" && forms.some((form) =>
        (!props.form || form.props.id === props.form) && (typeof form.props.onSubmit === "function" || form.props.action),
      );
      if (!bound && !submits) inert.add(`${path.relative(root, element.filename).replaceAll("\\", "/")}: ${elementName(element)}`);
    }
  }
  assert.deepEqual([...inert], [], `Enabled inert actions: ${[...inert].join(" | ")}`);
});

test("X04-05: rendered buttons and navigation links have nonempty accessible text or explicit names", async () => {
  const unnamed = [];
  for (const url of advertisedRoutes) {
    const { html } = await route(url);
    for (const tag of ["button", "a"]) {
      for (const element of elements(html, tag)) {
        if (/\s(?:hidden|aria-hidden="true")\b/.test(element.attributes)) continue;
        const name = attribute(element.attributes, "aria-label") || attribute(element.attributes, "title") || element.text;
        if (!name.trim()) unnamed.push(`${url}: ${tag} ${element.attributes}`);
      }
    }
  }
  assert.deepEqual(unnamed, []);
});

test("X04-06: the initial document declares English and each route has one main landmark and named primary navigation", async () => {
  const layout = load("app/layout.tsx").default;
  const document = renderToStaticMarkup(React.createElement(layout, null, "X04 fixture"));
  assert.match(document, /<html\b[^>]*\blang="en"/);
  for (const url of advertisedRoutes) {
    const { html } = await route(url);
    assert.equal(elements(html, "main").length, 1, `${url}: main landmark count`);
    assert.ok(elements(html, "nav").some((nav) => /primary/i.test(attribute(nav.attributes, "aria-label"))), `${url}: unnamed primary navigation`);
  }
});

test("X04-07: the closed mobile drawer removes its links from keyboard and accessibility navigation", async () => {
  const rendered = await route("/");
  const drawer = rendered.elements.find((element) => String(element.props.className ?? "").split(/\s+/).includes("sidebar-drawer"));
  assert.ok(drawer, "No sidebar drawer found; update this targeted check if the navigation architecture changes");
  const css = source("app/globals.css");
  const mobileCss = css.slice(css.indexOf("@media (max-width: 860px)"));
  const offCanvasOnly = /\.sidebar-drawer\s*\{[^}]*translateX\(-100%\)/.test(mobileCss);
  const hiddenByCss = /\.sidebar-drawer\s*\{[^}]*(?:visibility\s*:\s*hidden|display\s*:\s*none)/.test(mobileCss);
  const hiddenByMarkup = drawer.props.hidden === true || drawer.props.inert === true || drawer.props.inert === "";
  assert.ok(!offCanvasOnly || hiddenByCss || hiddenByMarkup,
    "Closed mobile drawer is only translated off screen; its anchors and close button remain keyboard reachable");
});

test("X04-08: mobile navigation exposes disclosure state and an Escape dismissal path", async () => {
  const rendered = await route("/");
  const open = rendered.elements.find((element) => element.type === "button" && /open navigation/i.test(element.props["aria-label"] ?? ""));
  assert.ok(open, "Open navigation control missing");
  const problems = [];
  if (open.props["aria-expanded"] !== false) problems.push("closed state is not exposed as aria-expanded=false");
  if (!open.props["aria-controls"]) problems.push("aria-controls does not identify the drawer");
  else if (!rendered.elements.some((element) => element.props.id === open.props["aria-controls"])) problems.push("aria-controls target is missing");
  const shell = source("components/app-shell.tsx");
  if (!/\bEscape\b/.test(shell)) problems.push("shell has no Escape dismissal path");
  assert.deepEqual(problems, []);
});

test("X04-09: the default reliability screen explicitly reports missing ML as unavailable", async () => {
  const rendered = await route("/insights");
  assert.match(rendered.text, /(?:ML|model|machine learning|reliability|trust|scor(?:e|ing))[\s\S]{0,100}(?:unavailable|not configured|not connected|not evaluated)|(?:unavailable|not configured|not connected|not evaluated)[\s\S]{0,100}(?:ML|model|reliability|trust|scor(?:e|ing))/i,
    "Default reliability screen claims a numeric/excellent score without a visible ML-unavailable state");
});

function declarations(css, selector) {
  const values = {};
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!match[1].split(",").some((part) => part.trim() === selector)) continue;
    for (const declaration of match[2].split(";")) {
      const colon = declaration.indexOf(":");
      if (colon !== -1) values[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
    }
  }
  return values;
}

function color(value, variables) {
  if (value === "white") return [255, 255, 255];
  if (value?.startsWith("var(")) return color(variables[value.slice(4, -1)], variables);
  assert.match(value ?? "", /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i, `Unsupported static color ${value}`);
  const hex = value.length === 4 ? [...value.slice(1)].map((digit) => digit.repeat(2)).join("") : value.slice(1);
  return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16));
}

function luminance(rgb) {
  const [r, g, b] = rgb.map((channel) => channel / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

test("X04-10: critical small text colors meet the WCAG AA 4.5:1 contrast threshold", (t) => {
  // Base desktop declarations only; no approximation of gradients or alpha colors.
  const css = source("app/globals.css").split("@media")[0];
  const variables = declarations(css, ":root");
  const samples = [
    [".primary-button", declarations(css, ".primary-button").background],
    [".page-subtitle", "var(--canvas)"],
    [".metric-card-top", "var(--panel)"],
  ];
  const failures = [];
  for (const [selector, background] of samples) {
    const foreground = declarations(css, selector).color;
    const values = [luminance(color(foreground, variables)), luminance(color(background, variables))].sort((a, b) => b - a);
    const ratio = (values[0] + 0.05) / (values[1] + 0.05);
    t.diagnostic(`${selector}: ${foreground} on ${background} = ${ratio.toFixed(3)}:1`);
    if (ratio < 4.5) failures.push(`${selector} ${ratio.toFixed(3)}:1`);
  }
  assert.deepEqual(failures, [], `Insufficient contrast: ${failures.join(", ")}`);
});
