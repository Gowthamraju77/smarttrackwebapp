import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const module = { exports: {} };
  const text = readFileSync(new URL(`../lib/live/${name}.ts`, import.meta.url), "utf8");
  const code = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("exports", "module", "require", code)(module.exports, module, spec => load(spec.replace("./", "")));
  modules.set(name, module.exports); return module.exports;
}
const { currentHeading, compassLabel } = load("heading");
const now = Date.UTC(2026, 10, 5, 12);
const sample = () => ({ status: "live", receivedAt: now, gps: { fix: true, latitude: 0, longitude: 0, ageMs: 0, recordedAt: new Date(now).toISOString(), receivedAt: now, courseDeg: 90, speedMps: 2 } });
test("a moving fresh GPS fix provides its measured course, including north at zero", () => {
  const s = sample(); assert.equal(currentHeading(s, true, now), 90); s.gps.courseDeg = 0; assert.equal(currentHeading(s, true, now), 0);
});
test("stationary and slow fixes do not invent device orientation", () => {
  for (const speed of [0, 0.49, null, -1, NaN]) { const s = sample(); s.gps.speedMps = speed; assert.equal(currentHeading(s, true, now), null); }
});
test("disconnect, stale GPS, lost fix and historical timestamps remove the arrow heading", () => {
  const s = sample(); assert.equal(currentHeading(s, false, now), null); assert.equal(currentHeading(s, true, now + 11_000), null);
  s.gps.fix = false; assert.equal(currentHeading(s, true, now), null); s.gps.fix = true; s.gps.recordedAt = new Date(now - 60_000).toISOString(); assert.equal(currentHeading(s, true, now), null);
});
test("invalid courses are rejected and cardinal labels wrap around north", () => {
  for (const angle of [null, undefined, NaN, Infinity, -1, 361, "90"]) { const s = sample(); s.gps.courseDeg = angle; assert.equal(currentHeading(s, true, now), null); }
  assert.equal(compassLabel(359), "N"); assert.equal(compassLabel(0), "N"); assert.equal(compassLabel(90), "E"); assert.equal(compassLabel(225), "SW");
});
test("displaying direction leaves the raw GPS observation unchanged", () => { const s = sample(), before = structuredClone(s); currentHeading(s, true, now); assert.deepEqual(s, before); });
