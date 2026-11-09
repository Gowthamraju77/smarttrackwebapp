import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

// Isolated source-based audit: no DOM, build, server, or external service.
// These are hand-mapped foreground/surface pairs from the current markup, not
// a full CSS cascade, layout, anti-aliasing, or browser accessibility audit.
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function parseRules(source, contexts = []) {
  const rules = [];
  let start = 0;
  while (start < source.length) {
    const open = source.indexOf("{", start);
    if (open < 0) break;
    let end = open + 1;
    let depth = 1;
    while (end < source.length && depth) {
      if (source[end] === "{") depth += 1;
      if (source[end] === "}") depth -= 1;
      end += 1;
    }
    assert.equal(depth, 0, "CSS audit requires balanced blocks");
    const selector = source.slice(start, open).trim();
    const body = source.slice(open + 1, end - 1);
    if (selector.startsWith("@")) {
      rules.push(...parseRules(body, [...contexts, selector]));
    } else {
      const properties = new Map();
      for (const declaration of body.split(";")) {
        const colon = declaration.indexOf(":");
        if (colon >= 0) properties.set(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
      }
      rules.push({ selectors: selector.split(",").map((value) => value.trim()), properties, contexts });
    }
    start = end;
  }
  return rules;
}

const rules = parseRules(css.replace(/\/\*[\s\S]*?\*\//g, ""));

function property(selector, name) {
  const matches = rules.filter((rule) => rule.contexts.length === 0 && rule.selectors.includes(selector) && rule.properties.has(name));
  assert.ok(matches.length, `Audit pair requires base ${selector} { ${name}: ... }`);
  return matches.at(-1).properties.get(name);
}

function resolve(value) {
  return value.replace(/var\((--[\w-]+)\)/g, (_, variable) => resolve(property(":root", variable)));
}

function rgba(value) {
  const resolved = resolve(value).toLowerCase();
  if (resolved === "white") return [255, 255, 255, 1];
  if (resolved === "black") return [0, 0, 0, 1];
  if (/^#[\da-f]{3}$/i.test(resolved)) return [...resolved.slice(1)].map((digit) => parseInt(digit + digit, 16)).concat(1);
  if (/^#[\da-f]{6}$/i.test(resolved)) return resolved.slice(1).match(/../g).map((channel) => parseInt(channel, 16)).concat(1);
  const numeric = resolved.match(/^rgba?\(([^)]+)\)$/);
  if (numeric) {
    const channels = numeric[1].split(",").map(Number);
    assert.ok(channels.length === 3 || channels.length === 4, `Unsupported CSS color: ${resolved}`);
    return channels.length === 3 ? [...channels, 1] : channels;
  }
  throw new Error(`Audit requires an explicit supported color; got ${resolved}`);
}

function composite(foreground, background) {
  assert.equal(background[3], 1, "Composite background must be opaque");
  return foreground.slice(0, 3).map((channel, index) => channel * foreground[3] + background[index] * (1 - foreground[3])).concat(1);
}

function luminance(color) {
  const channels = color.slice(0, 3).map((channel) => channel / 255).map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)];
  return (Math.max(...values) + 0.05) / (Math.min(...values) + 0.05);
}

const surface = (selector) => rgba(property(selector, "background"));
const canvas = surface("body");
const panel = surface(".panel");
const sidebar = surface(".sidebar");
const workspace = composite(surface(".workspace-switcher"), sidebar);
const on = (label, selector, background, minimum = 4.5) => ({ label, selector, background, minimum });

const pairs = [
  on("Body on canvas", "body", canvas),
  on("Sidebar primary", ".sidebar", sidebar),
  on("Sidebar navigation", ".nav-item", sidebar),
  on("Navigation group label (9px)", ".nav-group-label", sidebar),
  on("Workspace label (10px, alpha-composited surface)", ".workspace-label", workspace),
  on("Primary button (12px)", ".primary-button", surface(".primary-button")),
  on("Primary button hover (12px)", ".primary-button", surface(".primary-button:hover")),
  on("Secondary button (12px)", ".secondary-button", surface(".secondary-button")),
  on("Eyebrow (10px)", ".eyebrow", canvas),
  on("Panel kicker (10px)", ".panel-kicker", panel),
  on("Page subtitle (13px)", ".page-subtitle", canvas),
  on("Breadcrumb (12px)", ".breadcrumb", surface(".topbar")),
  on("Metric label (11px)", ".metric-card-top", panel),
  on("Metric comparison (10px)", ".metric-change-positive", panel),
  on("Metric comparison suffix (10px)", ".metric-change em", panel),
  on("Period button (10px)", ".select-button", surface(".select-button")),
  on("Score pill (10px)", ".score-pill", surface(".score-pill")),
  on("Y-axis labels (9px)", ".chart-y-axis", panel),
  on("X-axis labels (9px)", ".chart-x-axis", panel),
  on("Tooltip secondary (8px)", ".chart-tooltip span", surface(".chart-tooltip")),
  on("Active count pill (10px)", ".live-pill", surface(".live-pill")),
  on("Text button (10px)", ".text-button", panel),
  on("Activity detail (10px)", ".activity-copy span", panel),
  on("Activity timestamp (9px)", ".activity-item time", panel),
  on("Section status label (12px)", ".section-status-card > span", panel),
  on("Section status helper (10px)", ".section-status-card small", panel),
  on("Section explanation (12px)", ".section-empty-card p", panel),
  on("Demo chip (8px)", ".demo-chip", panel),
  on("Notification icon (non-text)", ".icon-button", surface(".topbar"), 3),
];

test("R17 contrast formula reference values and source snapshot", (context) => {
  assert.equal(contrast(rgba("#000"), rgba("#fff")), 21);
  assert.equal(contrast(rgba("#fff"), rgba("#fff")), 1);
  assert.ok(Math.abs(contrast(rgba("#777777"), rgba("#ffffff")) - 4.478089453577214) < 1e-12);
  assert.deepEqual(composite(rgba("rgba(255,255,255,.04)"), rgba("#172336")), [32.28, 43.8, 62.04, 1]);
  context.diagnostic(`globals.css sha256=${createHash("sha256").update(css).digest("hex")}`);
  context.diagnostic("Static declared-color checks only; thresholds are WCAG AA 4.5:1 for normal text and 3:1 for the named essential icon.");
});

for (const pair of pairs) {
  const foreground = rgba(property(pair.selector, "color"));
  const ratio = contrast(composite(foreground, pair.background), pair.background);
  test(`R17 ${pair.label}: ${ratio.toFixed(4)}:1 >= ${pair.minimum}:1`, () => {
    assert.ok(ratio >= pair.minimum, `${pair.selector}: foreground=${resolve(property(pair.selector, "color"))}; background=rgb(${pair.background.slice(0, 3).join(", ")}); actual=${ratio.toFixed(6)}:1; required=${pair.minimum}:1`);
  });
}

test("R17 reduced-motion preference removes the mobile drawer transition", () => {
  const drawerRules = rules.filter((rule) => rule.selectors.includes(".sidebar-drawer"));
  const motion = drawerRules.some((rule) => /transform/.test(rule.properties.get("transition") ?? ""));
  if (!motion) return;
  const reduction = rules.some((rule) => rule.contexts.some((context) => /prefers-reduced-motion\s*:\s*reduce\b/.test(context)) && rule.selectors.some((selector) => selector === "*" || selector === ".sidebar-drawer") && (
    /^(?:none|0(?:s|ms))\b/.test(rule.properties.get("transition") ?? "") ||
    /^(?:0|0\.0*1)(?:s|ms)\b/.test(rule.properties.get("transition-duration") ?? "")
  ));
  assert.ok(reduction, "The 220ms off-canvas drawer transform has no prefers-reduced-motion: reduce transition override.");
});

test("R17 focus audit preserves native outlines when no authored focus style exists", (context) => {
  const focusRules = rules.filter((rule) => rule.selectors.some((selector) => /:focus(?:-visible|-within)?\b/.test(selector)));
  const outlineRemovals = rules.filter((rule) => /^(?:none|0(?:px)?)(?:\s|$)/.test(rule.properties.get("outline") ?? "") || /^(?:none|0(?:px)?)(?:\s|$)/.test(rule.properties.get("outline-width") ?? ""));
  context.diagnostic(`Authored focus rules: ${focusRules.length}; outline-removal rules: ${outlineRemovals.length}. Native-ring contrast, clipping, and real keyboard navigation require browser verification.`);
  assert.ok(focusRules.length > 0 || outlineRemovals.length === 0, "Native outlines are removed without any authored focus replacement.");
});
