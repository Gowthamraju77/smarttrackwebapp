import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Synthetic observations only; no local collector, device or credentials are used.
const require = createRequire(import.meta.url);
const { createInfoEspState, pollInfoEspOnce } = require("../scripts/live-relay.cjs");
function load(name) {
  const module = { exports: {} };
  new Function("exports", "module", ts.transpileModule(readFileSync(new URL(`../lib/live/${name}.ts`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText)(module.exports, module);
  return module.exports;
}
const { infoEspObservation } = load("infoesp");
const { isLiveFeed, isLiveSnapshot } = load("feed");
const epoch = Date.UTC(2026, 0, 1, 12);
const stamp = (ms) => new Date(ms).toISOString();
function fixture(now = epoch, id = `sample-${now}`) {
  return { name: "infoesp", schema_version: 1, status: "live", generated_at: stamp(now), latest: {
    sample_id: id, received_at: stamp(now), sampled_at: stamp(now + 300), source_available: true,
    readings: { connected: true, receiving: true, last_line_age_seconds: 0, total_lines: 100,
      gps: { status: "fix", fix_quality: 1, latitude: 0, longitude: 0, altitude_m: 12, satellites_used: 12, hdop: 1, speed_kmh: 36, speed_age_seconds: 0, age_seconds: 0, utc: stamp(now), rx_pin: 39, baud: 9600, valid_sentences: 80, invalid_sentences: 2 },
      mpu: { status: "receiving", age_seconds: 0, raw: { ax: 0, ay: 0, az: 8192, gx: 1, gy: 2, gz: 3, temp: 0 }, device_ms: now - epoch + 1000, valid_samples: now - epoch + 1, hardware_errors: 0,
        acceleration_m_s2: { x: 0, y: 0, z: 9.81 }, gyro_deg_s: { x: 1, y: 2, z: 3 }, temperature_c: 25 },
      modem: { fresh: true, age_seconds: 2, state: "scanning", uart_connected: false, registered: false, sim_state: "UNKNOWN", last_error: "AT: timeout", baud: 38400, imsi: "private-sim", operator: "private-operator" },
      display: { fresh: true, age_seconds: 1, observed_at: stamp(now - 1000), data: { ready: true, app: "Home", calibrated: true, flushes: 9, psram_test: true } },
      rtos: { fresh: true, age_seconds: 1, data: { uptime_ms: 5000, mpu_task: true, mpu_ready: true } },
      network: { mode: "sta+ap", connected: true, rssi: -50, ip: "private-address", ssid: "private-network", password: "private-password" },
      firmware: { partition: "app0", version: "fixture" },
    },
  }, samples: [] };
}

test("infoesp maps zero coordinates, units, source timestamps and allowlisted component reports", () => {
  const input = fixture(), before = structuredClone(input);
  const { live } = infoEspObservation(input, epoch + 250);
  assert.equal(isLiveSnapshot(live), true);
  assert.equal(live.gps.fix, true);
  assert.equal(live.gps.latitude, 0);
  assert.equal(live.gps.speedMps, 10);
  assert.equal(live.gps.courseDeg, null, "A missing heading must not become zero degrees");
  assert.equal(live.gps.receivedAt, epoch);
  assert.equal(live.hardware.display.receivedAt, epoch - 1000);
  assert.equal(live.hardware.imu.values.acceleration_z_m_s2, 9.81);
  assert.equal(live.hardware.modem.values.last_error, "AT: timeout");
  assert.equal(live.diagnostics.checksumErrors, null, "The summary does not supply checksum-specific counts");
  assert.equal(live.trust.factors.find(x => x.id === "stream").value, null);
  assert.doesNotMatch(JSON.stringify(live), /private-/);
  assert.deepEqual(input, before);
});

test("missing, invalid, simulated, stale and future GPS observations cannot become a live fix", () => {
  const changes = [
    d => { d.latest.readings.gps.latitude = "0"; },
    d => { d.latest.readings.gps.longitude = 181; },
    d => { d.latest.readings.gps.latitude = NaN; },
    d => { d.latest.readings.gps.status = "no_fix"; },
    d => { d.latest.readings.gps.fix_quality = 8; },
    d => { d.latest.readings.gps.fix_quality = "1"; },
    d => { d.latest.readings.gps.age_seconds = 11; },
    d => { d.latest.readings.gps.age_seconds = null; },
    d => { d.latest.readings.gps.utc = null; },
    d => { d.latest.readings.gps.utc = stamp(epoch - 11000); },
    d => { d.latest.readings.gps.utc = stamp(epoch + 3000); },
    d => { d.latest.source_available = false; },
    d => { d.latest.readings.connected = false; },
    d => { d.latest.readings.receiving = false; },
    d => { d.status = "stale"; },
    d => { d.latest.readings.last_line_age_seconds = 6; },
  ];
  for (const change of changes) {
    const input = fixture(); change(input);
    const { live } = infoEspObservation(input, epoch);
    assert.equal(live.gps.fix, false, change.toString());
    assert.equal(live.trust.score, null, change.toString());
    assert.equal(isLiveSnapshot(live), true);
  }
});

test("stale speed, missing MPU and sensor errors stay unavailable independently of GPS", () => {
  const input = fixture();
  input.latest.readings.gps.speed_age_seconds = 11;
  Object.assign(input.latest.readings.mpu, { raw: null, status: "error", age_seconds: null, hardware_errors: 4, error: "no_mpu_response_at_0x68_or_0x69" });
  const { live } = infoEspObservation(input, epoch);
  assert.equal(live.gps.fix, true);
  assert.equal(live.gps.speedMps, null);
  assert.equal(live.imu.available, false);
  assert.equal(live.imu.raw, null);
  assert.equal(live.hardware.imu.values.error, input.latest.readings.mpu.error);
  assert.equal(live.hardware.imu.values.temperature_c, undefined);
  assert.equal(live.hardware.imu.values.errors, 4);
});

test("hardware report age and explicit stale flags survive normalization", () => {
  const input = fixture();
  input.latest.readings.display.fresh = false;
  input.latest.readings.modem.age_seconds = 40;
  const { live } = infoEspObservation(input, epoch);
  assert.ok(epoch - live.hardware.display.receivedAt > 15000);
  assert.equal(live.hardware.modem.receivedAt, epoch - 40000);
});

test("malformed collector envelopes fail without adopting data or renewing history", () => {
  let now = epoch;
  const state = createInfoEspState({ clock: () => now });
  assert.equal(isLiveFeed(state.snapshot()), true);
  state.ingest(fixture());
  for (const input of [null, {}, { ...fixture(), schema_version: 2 }, { ...fixture(), latest: {} }]) {
    assert.equal(state.ingest(input), false);
    assert.equal(state.snapshot().serial.connected, false);
    assert.equal(state.snapshot().live.gps.fix, false);
    assert.equal(state.snapshot().capturedSnapshot.gps.receivedAt, epoch);
  }
  now += 1000;
  assert.equal(state.ingest(fixture(now)), true);
  assert.equal(state.snapshot().live.gps.fix, true);
});

test("repeated samples, refreshed response timestamps and changing upload IDs cannot renew old GPS", () => {
  let now = epoch;
  const state = createInfoEspState({ clock: () => now });
  state.ingest(fixture());
  const original = state.snapshot().capturedSnapshot;
  now += 2000;
  const repeated = fixture(); repeated.generated_at = stamp(now);
  assert.equal(state.ingest(repeated), false);
  assert.equal(state.snapshot().live.gps.receivedAt, epoch);
  const next = fixture(now);
  next.latest.readings.gps.utc = stamp(epoch);
  next.latest.readings.mpu.device_ms = 1000;
  state.ingest(next);
  assert.equal(state.snapshot().live.gps.receivedAt, epoch);
  assert.equal(state.snapshot().live.imu.receivedAt, epoch);
  assert.equal(state.snapshot().trajectory.length, 1);
  now += 11000;
  state.ingest(repeated);
  const stale = state.snapshot();
  assert.equal(stale.live.gps.fix, false);
  assert.equal(stale.live.trust.score, null);
  assert.equal(stale.live.imu.available, false);
  assert.equal(stale.capturedSnapshot.gps.receivedAt, original.gps.receivedAt);
});

test("source disconnect immediately ends live status, retains historical evidence and recovers", () => {
  let now = epoch;
  const state = createInfoEspState({ clock: () => now });
  state.ingest(fixture());
  state.fail();
  const offline = state.snapshot();
  assert.equal(offline.live.status, "stale");
  assert.equal(offline.live.gps.fix, false);
  assert.equal(offline.live.trust.score, null);
  assert.equal(offline.capturedSnapshot.gps.fix, true);
  now += 1000;
  state.ingest(fixture(now));
  assert.equal(state.snapshot().serial.connected, true);
  assert.equal(state.snapshot().live.gps.fix, true);
});

test("older receipts and receiver times cannot move the current position backwards", () => {
  let now = epoch;
  const state = createInfoEspState({ clock: () => now });
  state.ingest(fixture());
  assert.equal(state.ingest(fixture(epoch - 1000)), false);
  now += 1000;
  const input = fixture(now); input.latest.readings.gps.utc = stamp(epoch - 1000);
  state.ingest(input);
  assert.equal(state.snapshot().live.gps.fix, false);
  assert.equal(state.snapshot().capturedSnapshot.gps.recordedAt, stamp(epoch));
});

test("history is bounded to 240 distinct observed GPS timestamps and returned copies are isolated", () => {
  let now = epoch;
  const state = createInfoEspState({ clock: () => now });
  for (let i = 0; i < 245; i++) { now = epoch + i * 1000; state.ingest(fixture(now)); }
  const feed = state.snapshot();
  assert.equal(isLiveFeed(feed), true);
  assert.equal(feed.source, "esp32-infoesp");
  assert.equal(feed.trajectory.length, 240);
  assert.equal(feed.trajectory[0].receivedAt, epoch + 5000);
  feed.trajectory[0].latitude = 88;
  feed.capturedSnapshot.gps.latitude = 88;
  assert.equal(state.snapshot().trajectory[0].latitude, 0);
  assert.equal(state.snapshot().capturedSnapshot.gps.latitude, 0);
});

test("HTTP polling requests only the configured source without forwarding relay credentials", async () => {
  const state = createInfoEspState({ clock: () => epoch });
  let calls = 0;
  assert.equal(await pollInfoEspOnce({ state, url: "http://127.0.0.1:4318/infoesp", fetcher: async (url, options) => {
    calls++;
    assert.equal(url.pathname, "/infoesp");
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.equal(options.headers.Authorization, undefined);
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json(fixture());
  } }), true);
  assert.equal(calls, 1);
  assert.equal(state.snapshot().live.gps.fix, true);
});

test("HTTP errors, redirects, oversized bodies, invalid JSON and transport failures clear live status", async () => {
  for (const fetcher of [
    async () => new Response("offline", { status: 503 }),
    async () => new Response("redirect", { status: 302 }),
    async () => new Response("<html>unavailable</html>", { headers: { "content-type": "text/html" } }),
    async () => new Response("{" + "x".repeat(1024 * 1024), { headers: { "content-type": "application/json" } }),
    async () => new Response("invalid", { headers: { "content-type": "application/json" } }),
    async () => { throw new Error("private upstream failure detail"); },
  ]) {
    const state = createInfoEspState({ clock: () => epoch }); state.ingest(fixture());
    assert.equal(await pollInfoEspOnce({ state, url: "http://127.0.0.1:4318/infoesp", fetcher }), false);
    assert.equal(state.snapshot().live.trust.score, null);
    assert.equal(state.snapshot().serial.connected, false);
    assert.doesNotMatch(JSON.stringify(state.snapshot()), /private upstream/);
  }
});

test("cancelled polling cannot replace the last accepted observation", async () => {
  const controller = new AbortController();
  const state = createInfoEspState({ clock: () => epoch });
  controller.abort();
  await pollInfoEspOnce({ state, url: "http://127.0.0.1:4318/infoesp", signal: controller.signal, fetcher: async () => Response.json(fixture()) });
  assert.equal(state.snapshot().capturedSnapshot, null);
});
