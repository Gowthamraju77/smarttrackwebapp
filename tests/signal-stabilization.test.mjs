import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const loaded = { exports: {} };
new Function("exports", "module", ts.transpileModule(readFileSync(new URL("../lib/live/stabilization.ts", import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText)(loaded.exports, loaded);
const { emptyStability, advanceStability, gpsDistanceM } = loaded.exports;
const epoch = Date.UTC(2026, 0, 1);
const point = (metres = 0, tick = 0) => ({ latitude: 0, longitude: metres / 6_371_008.8 * 180 / Math.PI, receivedAt: epoch + tick * 1000, recordedAt: new Date(epoch + tick * 1000).toISOString() });
const raw = (change = 0) => ({ ax: change, ay: 0, az: 8192, gx: 0, gy: 0, gz: 0, temp: 1500 });
const motion = (change = 0, tick = 0) => ({ raw: raw(change), receivedAt: epoch + tick * 1000, sequence: tick + 1, uptimeMs: 1000 + tick * 1000 });
const input = (overrides = {}) => ({ sourceKey: "relay:1", points: [], gps: null, motion: null, restarted: false, receivedAt: epoch, ...overrides });

test("tiny GPS variations hold the original accepted sample without rewriting its timestamp", () => {
  const initial = point();
  let state = advanceStability(emptyStability(), input({ gps: initial }));
  const candidate = point(2, 1);
  state = advanceStability(state, input({ gps: candidate }));
  assert.deepEqual(state.gpsPoint, initial);
  assert.equal(state.gpsPoint.receivedAt, epoch);
  assert.equal(state.lastGpsAt, candidate.receivedAt);
  assert.equal(state.gpsHeld, true);
  assert.equal(state.points.length, 1);
});

test("slow cumulative movement crosses the anchored threshold and is not held indefinitely", () => {
  let state = emptyStability();
  for (let tick = 0; tick <= 4; tick++) state = advanceStability(state, input({ gps: point(tick * 0.8, tick) }));
  assert.equal(state.gpsHeld, false);
  assert.deepEqual(state.gpsPoint, point(3.2, 4));
  assert.equal(state.points.length, 2);
  assert.equal(state.suppressedGps, 3);
});

test("rolling and repeated input histories do not move the anchor or inflate suppression counts", () => {
  let state = advanceStability(emptyStability(), input({ points: [point(), point(1, 1), point(2, 2)] }));
  state = advanceStability(state, input({ points: [point(1, 1), point(2, 2)], gps: point(2.4, 3) }));
  assert.deepEqual(state.gpsPoint, point());
  const same = advanceStability(state, input({ points: [point(2, 2), point(2.4, 3)], gps: point(2.4, 3) }));
  assert.equal(same, state);
  assert.equal(state.suppressedGps, 3);
});

test("identical reported coordinates can have a new genuine receipt without extra trail vertices", () => {
  let state = advanceStability(emptyStability(), input({ gps: point() }));
  state = advanceStability(state, input({ gps: point(0, 1) }));
  assert.equal(state.gpsHeld, false);
  assert.equal(state.gpsPoint.receivedAt, epoch + 1000);
  assert.equal(state.points[0].receivedAt, epoch);
  assert.equal(state.points.length, 1);
});

test("GPS gaps and source changes establish a fresh baseline", () => {
  let state = advanceStability(emptyStability(), input({ gps: point() }));
  state = advanceStability(state, input({ gps: point(1, 11) }));
  assert.deepEqual(state.gpsPoint, point(1, 11));
  state = advanceStability(state, input({ sourceKey: "usb:2", gps: point(1.5, 12) }));
  assert.deepEqual(state.gpsPoint, point(1.5, 12));
  assert.equal(state.points.length, 1);
  assert.equal(state.suppressedGps, 0);
});

test("GPS distance uses the short arc across the international date line", () => {
  const a = { ...point(), longitude: 179.999995 };
  const b = { ...point(0, 1), longitude: -179.999995 };
  assert.ok(gpsDistanceM(a, b) > 1 && gpsDistanceM(a, b) < 1.2);
  const state = advanceStability(advanceStability(emptyStability(), input({ gps: a })), input({ gps: b }));
  assert.deepEqual(state.gpsPoint, a);
  assert.equal(state.gpsHeld, true);
});

test("invalid points and backwards receipts never move the displayed position", () => {
  const state = advanceStability(emptyStability(), input({ gps: point(0, 1) }));
  for (const candidate of [{ ...point(50, 2), latitude: NaN }, { ...point(50, 2), latitude: 91 }, { ...point(50, 2), receivedAt: -1 }, point(50, 0)]) {
    assert.equal(advanceStability(state, input({ gps: candidate })), state);
  }
});

test("motion deadbands hold minor changes but pass a large gyro or acceleration change immediately", () => {
  let state = advanceStability(emptyStability(), input({ motion: motion() }));
  const minor = motion(40, 1); minor.raw.gx = 8; minor.raw.temp = 1501;
  state = advanceStability(state, input({ motion: minor }));
  assert.equal(state.motionValues.ax, 0);
  assert.equal(state.motionValues.gx, 0);
  assert.equal(state.motionValues.temp, 1501);
  assert.deepEqual(state.heldMotionAxes, ["ax", "gx"]);
  const major = motion(100, 2); major.raw.gx = 20;
  state = advanceStability(state, input({ motion: major }));
  assert.equal(state.motionValues.ax, 100);
  assert.equal(state.motionValues.gx, 20);
  assert.equal(state.heldMotionAxes.length, 0);
});

test("motion thresholds accumulate against accepted values instead of each noisy predecessor", () => {
  let state = emptyStability();
  for (let tick = 0; tick <= 4; tick++) state = advanceStability(state, input({ motion: motion(tick * 20, tick) }));
  assert.equal(state.motionValues.ax, 80);
  assert.equal(state.heldMotionAxes.length, 0);
});

test("a stale motion gap resets its baseline and duplicate receipts cannot invent motion", () => {
  let state = advanceStability(emptyStability(), input({ motion: motion() }));
  state = advanceStability(state, input({ motion: motion(12, 6) }));
  assert.equal(state.motionValues.ax, 12);
  assert.equal(advanceStability(state, input({ motion: motion(1000, 6) })), state);
});

test("device restart resets both sensors while a persistent restart flag resets only once", () => {
  let state = advanceStability(emptyStability(), input({ gps: point(), motion: motion() }));
  const sample = motion(20, 1); sample.sequence = 0; sample.uptimeMs = 5;
  state = advanceStability(state, input({ restarted: true, receivedAt: epoch + 1000, points: [point()], gps: point(1, 1), motion: sample }));
  assert.equal(state.points.length, 1);
  assert.deepEqual(state.gpsPoint, point(1, 1));
  assert.equal(state.motionValues.ax, 20);
  const next = motion(25, 2); next.sequence = 1; next.uptimeMs = 1005;
  state = advanceStability(state, input({ restarted: true, receivedAt: epoch + 2000, gps: point(2, 2), motion: next }));
  assert.equal(state.motionValues.ax, 20);
  assert.equal(state.gpsHeld, true);
});

test("normal uint32 counter rollover is not mistaken for a reboot", () => {
  const first = motion(); first.sequence = 0xffffffff; first.uptimeMs = 0xfffffff0;
  let state = advanceStability(emptyStability(), input({ motion: first }));
  const next = motion(10, 1); next.sequence = 0; next.uptimeMs = 100;
  state = advanceStability(state, input({ motion: next }));
  assert.equal(state.motionValues.ax, 0);
  assert.deepEqual(state.heldMotionAxes, ["ax"]);
});

test("BOOT with no receipt excludes old captures and GPS can return before fresh IMU", () => {
  let state = advanceStability(emptyStability(), input({ gps: point(), motion: motion() }));
  state = advanceStability(state, input({ restarted: true, receivedAt: null, points: [point()], gps: point(), motion: motion() }));
  assert.equal(state.gpsPoint, null);
  assert.equal(state.motionValues, null);
  state = advanceStability(state, input({ restarted: true, receivedAt: epoch + 1000, points: [point(), point(1, 1)], gps: point(1, 1), motion: motion() }));
  assert.deepEqual(state.gpsPoint, point(1, 1));
  assert.equal(state.gpsHeld, false);
  assert.equal(state.motionValues, null);
  const fresh = motion(20, 2); fresh.sequence = 0; fresh.uptimeMs = 10;
  state = advanceStability(state, input({ restarted: true, receivedAt: epoch + 2000, gps: point(1, 1), motion: fresh }));
  assert.equal(state.motionValues.ax, 20);
});

test("new relay epochs do not reuse pre-reconnect history as the active baseline", () => {
  let state = advanceStability(emptyStability(), input({ gps: point(), motion: motion() }));
  const next = input({ sourceKey: "relay:2", receivedAt: epoch + 1000, points: [point(), point(1, 1)], gps: point(1, 1), motion: motion(20, 1) });
  state = advanceStability(state, next);
  assert.deepEqual(state.gpsPoint, point(1, 1));
  assert.equal(state.motionValues.ax, 20);
  assert.equal(state.points.length, 1);
});

test("initial waiting-to-capture hydration preserves GPS history older than the latest IMU", () => {
  const waiting = advanceStability(emptyStability(), input({ sourceKey: "none:0", receivedAt: null }));
  const history = [point(), point(5, 0.5)];
  const state = advanceStability(waiting, input({ receivedAt: epoch + 1000, points: history, gps: history[1], motion: motion(0, 1) }));
  assert.deepEqual(state.points, history);
  assert.deepEqual(state.gpsPoint, history[1]);
  assert.equal(state.motionReceivedAt, epoch + 1000);
});

test("source inputs remain unchanged and output history stays bounded", () => {
  const data = input({ gps: point(), motion: motion() });
  const original = structuredClone(data);
  Object.freeze(data.gps); Object.freeze(data.motion.raw); Object.freeze(data.motion); Object.freeze(data);
  let state = advanceStability(emptyStability(), data);
  for (let tick = 1; tick < 280; tick++) state = advanceStability(state, input({ gps: point(tick * 5, tick) }));
  assert.equal(state.points.length, 240);
  assert.deepEqual(data, original);
  assert.notEqual(state.motionValues, data.motion.raw);
});
