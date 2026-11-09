import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(`../lib/live/${name}.ts`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  new Function("exports", "module", "require", code)(module.exports, module, dependency => load(dependency.replace("./", "")));
  modules.set(name, module.exports);
  return module.exports;
}
const { advanceMapFilter: advance, emptyMapFilter: empty, commonGpsPoint, mapMotionEvidence } = load("stationary-map");
const epoch = Date.UTC(2026, 0, 1);
const point = (metres = 0, tick = 0) => ({ latitude: 0, longitude: metres / 6_371_008.8 * 180 / Math.PI,
  receivedAt: epoch + tick * 1000, recordedAt: new Date(epoch + tick * 1000).toISOString() });
const motion = (tick, overrides = {}) => ({ available: true, receivedAt: epoch + tick * 1000,
  sequence: tick * 1000 + 1, uptimeMs: tick * 1000 + 10000,
  raw: { ax: 200, ay: -100, az: 8192, gx: -1000, gy: 1400, gz: 40, temp: 1500 },
  acceleration: [0.3, -0.1, 9.8], rotation: [-8, 11.5, 0.4], ...overrides });
const input = (tick, metres = 0, overrides = {}) => ({ sourceKey: "relay:1", restarted: false,
  now: epoch + tick * 1000, connected: true, currentFix: true, gps: point(metres, tick), points: [], motion: motion(tick), ...overrides });
function settled(raw = false) {
  let state = empty();
  [18, 1, -1, 0, 2, 0, -2].forEach((metres, tick) => {
    state = advance(state, input(tick, metres, raw ? { motion: motion(tick, { acceleration: null, rotation: null }) } : {}));
  });
  assert.equal(state.held, true);
  return state;
}

test("consensus chooses an observed recurring position instead of the first outlier", () => {
  const points = [80, 2, -1, 0, 1, 60].map((m, i) => point(m, i));
  const common = commonGpsPoint(points);
  assert.ok(points.some(p => p.longitude === common.longitude));
  assert.ok(Math.abs(common.longitude) < point(3).longitude);
  assert.equal(commonGpsPoint([point(0), point(50), point(100)]), null);
});

for (const raw of [false, true]) {
  test(`${raw ? "unscaled raw" : "physical units with gyro bias"}: still MPU holds regional drift and trims the display trail`, () => {
    const state = settled(raw), anchor = structuredClone(state.gpsPoint);
    assert.ok(Math.abs(anchor.longitude) <= point(2).longitude);
    const next = advance(state, input(7, 25, raw ? { motion: motion(7, { acceleration: null, rotation: null }) } : {}));
    assert.deepEqual(next.gpsPoint, anchor);
    assert.equal(next.points.length, 1);
    assert.equal(next.gpsPoint.receivedAt, anchor.receivedAt);
    assert.equal(next.lastGpsAt, epoch + 7000);
  });
}

for (const field of ["acceleration", "rotation"]) {
  test(`${field} change immediately passes even sub-metre GPS movement`, () => {
    const state = settled();
    const next = advance(state, input(7, 0.5, { motion: motion(7, { [field]: field === "acceleration" ? [1.2, -0.1, 9.8] : [-3, 11.5, 0.4] }) }));
    assert.equal(next.mode, "moving");
    assert.equal(next.held, false);
    assert.deepEqual(next.gpsPoint, point(0.5, 7));
  });
}

test("moving MPU passes repeated small changes without applying a GPS deadband", () => {
  let state = settled();
  for (let tick = 7; tick < 20; tick++) {
    state = advance(state, input(tick, tick / 10, { motion: motion(tick, { acceleration: [tick % 2, -0.1, 9.8] }) }));
    assert.equal(state.held, false);
    assert.deepEqual(state.gpsPoint, point(tick / 10, tick));
  }
});

test("absent, stale, saturated and zero MPU samples cannot hold GPS", () => {
  for (const sample of [null, motion(0), motion(7, { available: false }), motion(7, { raw: null }),
    motion(7, { raw: { ax: 32767, ay: 0, az: 0, gx: 0, gy: 0, gz: 0 } }),
    motion(7, { acceleration: null, rotation: null, raw: { ax: 0, ay: 0, az: 0, gx: 0, gy: 0, gz: 0 } })]) {
    const state = advance(settled(), input(7, 8, { motion: sample }));
    assert.equal(state.mode, "unknown");
    assert.equal(state.held, false);
    assert.deepEqual(state.gpsPoint, point(8, 7));
  }
});

test("HTTP receipt changes with frozen device counters cannot sustain a hold", () => {
  let state = settled();
  for (let tick = 7; tick <= 11; tick++) {
    state = advance(state, input(tick, 15, { motion: motion(tick, { sequence: 6001, uptimeMs: 16000 }) }));
  }
  assert.equal(state.mode, "unknown");
  assert.deepEqual(state.gpsPoint, point(15, 11));
});

test("fast USB samples retain a four-second quiet window", () => {
  let state = empty();
  for (let i = 0; i <= 600; i++) state = advance(state, input(i / 100, i % 3));
  assert.equal(state.mode, "still");
  assert.equal(state.held, true);
  assert.ok(state.samples.length <= 16);
});

test("two-second feed cadence can accumulate enough independent quiet samples", () => {
  let state = empty();
  for (let tick = 0; tick <= 12; tick += 2) state = advance(state, input(tick, tick % 3));
  assert.equal(state.held, true);
});

test("one distant GPS spike is held but sustained departure releases smooth travel", () => {
  const start = settled();
  let state = advance(start, input(7, 150));
  assert.equal(state.held, true);
  state = advance(state, input(8, 1));
  assert.equal(state.held, true);
  for (let tick = 9; tick <= 11; tick++) state = advance(state, input(tick, 50 + (tick - 9) * 20));
  assert.equal(state.held, false);
  assert.deepEqual(state.gpsPoint, point(90, 11));
});

test("three consistent fixes in a new region cannot leave the marker stuck forever", () => {
  let state = settled();
  for (let tick = 7; tick <= 9; tick++) state = advance(state, input(tick, 100));
  assert.equal(state.held, false);
  assert.deepEqual(state.gpsPoint, point(100, 9));
});

test("GPS loss retains the displayed last-known point without adding trail or timestamps", () => {
  const start = settled();
  for (const overrides of [{ currentFix: false }, { connected: false }, { gps: point(30, -20) }]) {
    const state = advance(start, input(7, 30, overrides));
    assert.deepEqual(state.gpsPoint, start.gpsPoint);
    assert.deepEqual(state.points, start.points);
  }
});

test("GPS return after a long gap and source changes establish new positions", () => {
  const start = settled();
  for (const data of [input(25, 20), input(7, 20, { sourceKey: "usb:2" }), input(7, 20, { restarted: true })]) {
    const state = advance(start, data);
    assert.equal(state.held, false);
    assert.deepEqual(state.gpsPoint, data.gps);
  }
});

test("counter restart clears the anchor; normal uint32 rollover retains it", () => {
  const start = settled();
  const reset = advance(start, input(7, 15, { motion: motion(7, { sequence: 0, uptimeMs: 100 }) }));
  assert.equal(reset.held, false);
  const wrapped = advance({ ...start, sequence: 0xffffffff, uptimeMs: 0xfffffff0 }, input(7, 15, { motion: motion(7, { sequence: 0, uptimeMs: 100 }) }));
  assert.equal(wrapped.held, true);
});

test("invalid, repeated and out-of-order GPS fixes cannot inflate evidence", () => {
  const start = settled();
  for (const gps of [null, { ...point(30, 7), latitude: NaN }, point(30, 2), { ...point(30, 7), recordedAt: start.lastGpsUtc }]) {
    const state = advance(start, input(7, 30, { gps }));
    assert.deepEqual(state.gpsPoint, start.gpsPoint);
    assert.deepEqual(state.quietGps, start.quietGps);
  }
});

test("raw inputs and previous state stay immutable and output history stays bounded", () => {
  const data = input(0), before = structuredClone(data), previous = empty();
  Object.freeze(data.gps); Object.freeze(data.motion.raw); Object.freeze(data.motion); Object.freeze(data);
  let state = advance(previous, data);
  for (let tick = 1; tick < 280; tick++) state = advance(state, input(tick, tick * 5, { motion: null }));
  assert.deepEqual(data, before);
  assert.deepEqual(previous, empty());
  assert.equal(state.points.length, 240);
});

test("physical evidence uses only complete fresh hardware vectors and never captured fallback", () => {
  assert.equal(mapMotionEvidence(null, epoch), null);
  const snapshot = { imu: motion(0), hardware: { imu: { receivedAt: epoch, values: {
    acceleration_x_m_s2: 0, acceleration_y_m_s2: 0, acceleration_z_m_s2: 9.8,
    rotation_x_deg_s: -8, rotation_y_deg_s: 11, rotation_z_deg_s: 0,
  } } } };
  assert.deepEqual(mapMotionEvidence(snapshot, epoch).rotation, [-8, 11, 0]);
  assert.equal(mapMotionEvidence(snapshot, epoch + 5000).rotation, null);
  delete snapshot.hardware.imu.values.rotation_z_deg_s;
  assert.equal(mapMotionEvidence(snapshot, epoch).rotation, null);
});
