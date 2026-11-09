import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInThisContext } from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as jsxRuntime from "react/jsx-runtime";
import ts from "typescript";

// Isolated review checks: existing TSX is transpiled in memory and rendered with
// the installed React/Next libraries. No build, server, browser, or file output.
// Captured props establish control wiring only, not successful user interaction.
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
const sources = new Map();
const compiled = new Map();
const reviewedPaths = [
  "app/page.tsx",
  "app/[section]/page.tsx",
  "app/layout.tsx",
  "components/app-shell.tsx",
  "components/dashboard-view.tsx",
  "components/section-view.tsx",
];

for (const relativePath of reviewedPaths) {
  const filename = path.join(root, relativePath);
  assert.ok(existsSync(filename), `R03 BLOCKED: missing ${relativePath}`);
  const source = readFileSync(filename, "utf8");
  sources.set(filename, source);
  console.log(`R03 snapshot ${relativePath} sha256=${createHash("sha256").update(source).digest("hex")}`);
}

function readSnapshot(filename) {
  if (!sources.has(filename)) sources.set(filename, readFileSync(filename, "utf8"));
  return sources.get(filename);
}

function createHarness(instant = "2026-10-11T12:00:00.000Z") {
  const modules = new Map();
  const elements = [];
  const timestamp = Date.parse(instant);
  class ReviewDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [timestamp]));
    }
    static now() { return timestamp; }
  }

  const capture = (factory) => (type, props, ...rest) => {
    elements.push({ type, props: props ?? {} });
    return factory(type, props, ...rest);
  };
  const runtime = {
    ...jsxRuntime,
    jsx: capture(jsxRuntime.jsx),
    jsxs: capture(jsxRuntime.jsxs),
  };

  function load(filename) {
    if (modules.has(filename)) return modules.get(filename).exports;
    const module = { exports: {} };
    modules.set(filename, module);
    if (!compiled.has(filename)) {
      compiled.set(filename, ts.transpileModule(readSnapshot(filename), {
        fileName: filename,
        compilerOptions: {
          target: ts.ScriptTarget.ES2022,
          module: ts.ModuleKind.CommonJS,
          jsx: ts.JsxEmit.ReactJSX,
          esModuleInterop: true,
        },
      }).outputText);
    }
    function localRequire(specifier) {
      if (specifier === "react/jsx-runtime") return runtime;
      if (/\.css$/.test(specifier)) return {};
      if (specifier.startsWith("@/") || specifier.startsWith(".")) {
        const base = specifier.startsWith("@/")
          ? path.join(root, specifier.slice(2))
          : path.resolve(path.dirname(filename), specifier);
        const resolved = [base, `${base}.tsx`, `${base}.ts`, path.join(base, "index.tsx"), path.join(base, "index.ts")]
          .find((candidate) => /\.[cm]?[jt]sx?$/.test(candidate) && existsSync(candidate));
        assert.ok(resolved, `R03 BLOCKED: cannot resolve ${specifier} from ${filename}`);
        return load(resolved);
      }
      return require(specifier);
    }
    const wrapper = runInThisContext(
      `(function(exports, require, module, __filename, __dirname, Date) {\n${compiled.get(filename)}\n})`,
      { filename },
    );
    wrapper(module.exports, localRequire, module, filename, path.dirname(filename), ReviewDate);
    return module.exports;
  }

  const layout = load(path.join(root, "app/layout.tsx")).default;
  return {
    elements,
    home() {
      elements.length = 0;
      const page = load(path.join(root, "app/page.tsx")).default;
      return renderToStaticMarkup(React.createElement(layout, null, React.createElement(page)));
    },
    async section(section) {
      elements.length = 0;
      const page = load(path.join(root, "app/[section]/page.tsx")).default;
      const result = await page({ params: Promise.resolve({ section }) });
      return renderToStaticMarkup(React.createElement(layout, null, result));
    },
  };
}

function plainText(html) {
  return html.replace(/<svg\b[\s\S]*?<\/svg>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ").trim();
}

function childText(child) {
  if (child === null || child === undefined || typeof child === "boolean") return "";
  if (Array.isArray(child)) return child.map(childText).join(" ");
  if (typeof child === "string" || typeof child === "number") return String(child);
  return childText(child.props?.children);
}

function nameOf(element) {
  return (element.props["aria-label"] ?? childText(element.props.children)).replace(/\s+/g, " ").trim();
}

function isControl(element) {
  return element.type === "button" || element.type === "a" || element.props.href !== undefined;
}

function dashboard() {
  const harness = createHarness();
  const html = harness.home();
  return { ...harness, html, text: plainText(html) };
}

test("R03.01 default dashboard visibly identifies its synthetic demo data", () => {
  const { text } = dashboard();
  assert.match(text, /\bdemo(?:nstration)?\b/i,
    "The default dashboard has no visible demo notice; an aria-label on its map is insufficient.");
  assert.match(text, /\b(?:synthetic|sample|simulated)\b/i,
    "The default dashboard must visibly identify its data as synthetic/sample/simulated.");
});

test("R03.02 default service status does not assert unqualified live health", () => {
  const { elements } = dashboard();
  const statuses = elements.filter(({ props }) => String(props.className ?? "").split(/\s+/).includes("system-status"));
  for (const status of statuses) {
    const text = nameOf(status);
    assert.ok(!/all systems nominal/i.test(text) || /\b(?:demo|synthetic|simulated|sample)\b/i.test(text),
      `Unconfigured shell reports "${text}" without synthetic qualification.`);
  }
});

test("R03.03 the dashboard date advances with the clock or is explicitly a snapshot", () => {
  function datesAt(instant) {
    const harness = createHarness(instant);
    harness.home();
    return harness.elements.filter(({ type, props }) =>
      ["p", "time", "span"].includes(type) &&
      (String(props.className ?? "").split(/\s+/).includes("eyebrow") || props.dateTime),
    ).map(nameOf).filter((text) =>
      /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December)\b|\d{4}-\d{2}-\d{2}/i.test(text),
    );
  }
  const first = datesAt("2026-10-11T12:00:00.000Z");
  const next = datesAt("2026-10-12T12:00:00.000Z");
  const fixed = first.filter((date) => next.includes(date) && !/\b(?:snapshot|as of|sample date|demo date)\b/i.test(date));
  assert.deepEqual(fixed, [], `Date remains stale after a clock change: ${fixed.join("; ")}`);
});

const dashboardActions = [
  ["R03.04", "Start a journey", "/journeys"],
  ["R03.05", "Open live map", "/map"],
  ["R03.06", "View all", "/journeys"],
  ["R03.07", "Open journey pulse", "/journeys"],
  ["R03.08", "Explore insights", "/insights"],
];

for (const [id, label, destination] of dashboardActions) {
  test(`${id} ${label} has a destination or an action handler`, () => {
    const { elements } = dashboard();
    const controls = elements.filter((element) => isControl(element) && nameOf(element) === label);
    assert.ok(controls.length, `Dashboard control "${label}" could not be located; reassess its replacement.`);
    for (const { props } of controls) {
      const href = typeof props.href === "string" ? props.href : props.href?.pathname;
      const hasDestination = typeof href === "string" && href.split(/[?#]/)[0] === destination;
      assert.ok(hasDestination || typeof props.onClick === "function",
        `"${label}" is an inert enabled control: no ${destination} destination and no onClick handler.`);
    }
  });
}

test("R03.09 Last 7 days is a real selector or noninteractive range text", () => {
  const { elements, text } = dashboard();
  assert.match(text, /Last 7 days/i, "Reassess the replacement date-range UI.");
  const controls = elements.filter((element) => isControl(element) && nameOf(element) === "Last 7 days");
  for (const { props } of controls) {
    assert.ok(typeof props.onClick === "function" || typeof props.onChange === "function",
      "Last 7 days is presented as an enabled selector but has no selection handler.");
  }
});

test("R03.10 sidebar anchors reach distinct route content with active navigation", async () => {
  const home = dashboard();
  const destinations = [
    ["/map", "Live map"],
    ["/journeys", "Journey log"],
    ["/insights", "Trust & safety"],
    ["/analytics", "Analytics"],
    ["/alerts", "Alerts"],
    ["/devices", "Devices"],
    ["/settings", "Settings"],
  ];
  const anchors = [...home.html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
  assert.ok(anchors.some(([, attrs]) => /\bhref="\/"/.test(attrs)), "Home anchor is missing.");
  for (const [href, heading] of destinations) {
    assert.ok(anchors.some(([, attrs]) => attrs.includes(`href="${href}"`)), `Missing concrete sidebar href ${href}`);
    const harness = createHarness();
    const html = await harness.section(href.slice(1));
    const title = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(html);
    assert.equal(title && plainText(title[1]), heading, `${href} did not render its section heading.`);
    const active = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)]
      .filter(([, attrs]) => /\baria-current="page"/.test(attrs));
    assert.equal(active.length, 1, `${href} should mark one active navigation link.`);
    assert.ok(active[0][1].includes(`href="${href}"`), `${href} marks the wrong active link.`);
  }
});
