import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Tests use only synthetic observations and fake service credentials. No live
// environment, relay, GPS coordinates, or private connection file is read.
const require = createRequire(import.meta.url);
function load(relative, injected = {}) {
  const source = readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const loaded = { exports: {} };
  new Function("require", "exports", "module", "process", "fetch", javascript)(
    (name) => name === "@/lib/live/feed" ? feedModule : require(name),
    loaded.exports, loaded, { env: injected.env ?? {} },
    injected.fetch ?? (() => { throw new Error("Network access forbidden in this fixture"); }),
  );
  return loaded.exports;
}
const feedModule = load("lib/live/feed.ts");
const { isLiveFeed, isLiveSnapshot, ageLiveSnapshot } = feedModule;
const { TelemetryDecoder } = load("lib/live/telemetry.ts");
const epoch = Date.UTC(2026, 0, 1, 12);
const clone = (value) => structuredClone(value);

function nmea(body) {
  let checksum = 0;
  for (const character of body) checksum ^= character.charCodeAt(0);
  return `$${body}*${checksum.toString(16).padStart(2, "0")}\n`;
}
function fixture() {
  const decoder = new TelemetryDecoder();
  const live = decoder.push(nmea("GNRMC,120000.00,A,0000.0000,N,00000.0000,E,0,0,010126,,,A")
    + nmea("GNGGA,120000.00,0000.0000,N,00000.0000,E,1,12,1,0,M,0,M,,")
    + 'MPU_SAMPLE {"ms":1000,"seq":1,"ax":0,"ay":0,"az":8192,"gx":0,"gy":0,"gz":0,"temp":0}\n', epoch);
  return {
    version: 1, source: "esp32-serial", generatedAt: epoch, startedAt: epoch - 1000,
    receivedAt: epoch, serial: { port: "COM14", baudRate: 115200, connected: true, error: null },
    live, capturedSnapshot: clone(live),
    trajectory: [{ latitude: 0, longitude: 0, receivedAt: epoch, recordedAt: live.gps.recordedAt }],
  };
}

test("feed validator accepts actual decoder output, zero coordinates, and an explicitly empty waiting feed", () => {
  const data = fixture();
  assert.equal(isLiveSnapshot(data.live), true);
  assert.equal(isLiveFeed(data), true);
  assert.equal(isLiveFeed({ ...data, live: new TelemetryDecoder().snapshot(epoch), capturedSnapshot: null, trajectory: [] }), true);
  assert.equal(isLiveFeed({ ...data, source: "demo" }), false);
});

test("feed validator rejects nonfinite and out-of-range location, score, sensor and clock values", () => {
  const changes = [
    (data) => { data.live.gps.latitude = 90.01; },
    (data) => { data.live.gps.longitude = -180.01; },
    (data) => { data.live.gps.latitude = NaN; },
    (data) => { data.live.gps.longitude = Infinity; },
    (data) => { data.live.gps.speedMps = "0"; },
    (data) => { data.live.imu.raw.ax = Infinity; },
    (data) => { data.live.trust.score = NaN; },
    (data) => { data.live.trust.score = 101; },
    (data) => { data.live.trust.factors[0].value = Infinity; },
    (data) => { data.generatedAt = Infinity; },
    (data) => { data.startedAt = -1; },
    (data) => { data.trajectory[0].latitude = 91; },
    (data) => { data.trajectory[0].receivedAt = NaN; },
    (data) => { data.capturedSnapshot.gps.longitude = 181; },
  ];
  for (const change of changes) {
    const data = fixture();
    change(data);
    assert.equal(isLiveFeed(data), false, change.toString());
  }
});

test("a claimed GPS fix must contain both real coordinates, and quality fractions cannot exceed their scale", () => {
  for (const field of ["latitude", "longitude"]) {
    const data = fixture();
    data.live.gps[field] = null;
    assert.equal(isLiveFeed(data), false, `${field} missing despite fix:true`);
  }
  for (const value of [-0.01, 1.01]) {
    const data = fixture();
    data.live.trust.factors[0].value = value;
    assert.equal(isLiveFeed(data), false, "factor outside its declared 0–1 range");
  }
});

test("trajectory bounds are inclusive at 240 points and reject malformed entries", () => {
  const data = fixture();
  data.trajectory = Array.from({ length: 240 }, (_, index) => ({ ...data.trajectory[0], receivedAt: epoch + index }));
  assert.equal(isLiveFeed(data), true);
  data.trajectory.push({ ...data.trajectory[0] });
  assert.equal(isLiveFeed(data), false);
  data.trajectory = [null];
  assert.equal(isLiveFeed(data), false);
});

test("aging and disconnects clear live scores without modifying the historical capture", () => {
  const data = fixture();
  const before = clone(data);
  let aged = ageLiveSnapshot(data.live, epoch + 1000, false);
  assert.equal(aged.status, "stale");
  assert.equal(aged.gps.fix, false);
  assert.equal(aged.imu.available, false);
  assert.equal(aged.trust.score, null);
  assert.equal(aged.gps.latitude, 0, "last-known coordinates remain identified as noncurrent");
  aged = ageLiveSnapshot(data.live, epoch + 5001, true);
  assert.equal(aged.status, "stale");
  assert.equal(aged.trust.score, null);
  aged = ageLiveSnapshot(data.live, epoch + 10001, true);
  assert.equal(aged.gps.fix, false);
  assert.equal(aged.gps.speedMps, null);
  assert.equal(aged.trust.score, null);
  assert.deepEqual(data, before);
  assert.equal(data.capturedSnapshot.trust.score, 100);
});

test("fresh serial traffic cannot revive old GPS and previously stale snapshots are never promoted", () => {
  const data = fixture();
  data.live.receivedAt = epoch + 11000;
  data.live.imu.receivedAt = epoch + 11000;
  const aged = ageLiveSnapshot(data.live, epoch + 11000, true);
  assert.equal(aged.status, "live");
  assert.equal(aged.gps.fix, false);
  assert.equal(aged.trust.score, null);
  const historical = { ...fixture().live, status: "stale" };
  assert.equal(ageLiveSnapshot(historical, epoch, true).trust.score, null);
  const future = ageLiveSnapshot(fixture().live, epoch - 3000, true);
  assert.equal(future.status, "stale");
  assert.equal(future.trust.score, null);
});

const viewer = "synthetic_viewer_key_00000000000000000000";
const relay = "synthetic_relay_key_000000000000000000000";
const env = { SMARTTRACK_VIEWER_SECRET: viewer, SMARTTRACK_RELAY_SECRET: relay, SMARTTRACK_LIVE_RELAY_URL: "https://relay.example.invalid" };
const request = (token = viewer) => new Request("https://app.example.invalid/api/live", {
  headers: token === null ? {} : { Authorization: `Bearer ${token}` },
});

test("server feed fails closed before fetch without configuration or valid viewer access", async () => {
  let calls = 0;
  const neverFetch = async () => { calls++; throw new Error("unexpected request"); };
  const missing = load("app/api/live/route.ts", { fetch: neverFetch });
  assert.equal((await missing.GET(request())).status, 503);
  const route = load("app/api/live/route.ts", { env, fetch: neverFetch });
  for (const token of [null, "", "wrong", `${viewer}x`]) assert.equal((await route.GET(request(token))).status, 401);
  for (const configuredUrl of ["http://relay.example.invalid", "https://user:pass@relay.example.invalid", "https://relay.example.invalid/path", "https://relay.example.invalid?token=x"]) {
    const invalid = load("app/api/live/route.ts", { env: { ...env, SMARTTRACK_LIVE_RELAY_URL: configuredUrl }, fetch: neverFetch });
    assert.equal((await invalid.GET(request())).status, 503);
  }
  assert.equal(calls, 0);
});

test("server substitutes its relay credential and returns validated data without credential or header leakage", async () => {
  const data = fixture();
  let calls = 0;
  const route = load("app/api/live/route.ts", { env, fetch: async (url, options) => {
    calls++;
    assert.equal(String(url), "https://relay.example.invalid/snapshot");
    assert.equal(options.headers.Authorization, `Bearer ${relay}`);
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    assert.ok(options.signal);
    return Response.json(data, { headers: { "x-private-detail": relay, "set-cookie": viewer } });
  } });
  const response = await route.GET(request());
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  assert.equal(response.headers.get("vary"), "Authorization");
  assert.equal(response.headers.get("set-cookie"), null);
  assert.equal(response.headers.get("x-private-detail"), null);
  const text = await response.text();
  assert.ok(!text.includes(viewer) && !text.includes(relay));
  assert.deepEqual(JSON.parse(text), data);
  assert.equal(calls, 1);
});

test("explicit public mode serves current infoesp readings without a viewer token and keeps the relay key private", async () => {
  const data = fixture();
  data.source = "esp32-infoesp";
  data.live.gps.source = "INFOESP";
  data.live.diagnostics.checksumErrors = null;
  let calls = 0;
  const route = load("app/api/live/route.ts", { env: { ...env, SMARTTRACK_PUBLIC_LIVE: "1", SMARTTRACK_VIEWER_SECRET: undefined }, fetch: async (url, options) => {
    calls++;
    assert.equal(String(url), "https://relay.example.invalid/snapshot");
    assert.equal(options.headers.Authorization, `Bearer ${relay}`);
    return Response.json(data);
  } });
  for (const token of [null, "expired-viewer-token"]) {
    const response = await route.GET(request(token));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /no-store/);
    const body = await response.text();
    assert.equal(body.includes(relay), false);
    assert.equal(body.includes(viewer), false);
    assert.deepEqual(JSON.parse(body), data);
  }
  assert.equal(calls, 2);
});

test("public mode is opt-in and still requires the upstream connection configuration", async () => {
  const neverFetch = () => { throw new Error("No upstream request expected"); };
  for (const flag of [undefined, "0", "false", "true"]) {
    const route = load("app/api/live/route.ts", { env: { ...env, SMARTTRACK_PUBLIC_LIVE: flag }, fetch: neverFetch });
    assert.equal((await route.GET(request(null))).status, 401);
  }
  for (const missing of ["SMARTTRACK_RELAY_SECRET", "SMARTTRACK_LIVE_RELAY_URL"]) {
    const route = load("app/api/live/route.ts", { env: { ...env, SMARTTRACK_PUBLIC_LIVE: "1", [missing]: undefined }, fetch: neverFetch });
    assert.equal((await route.GET(request(null))).status, 503);
  }
});

test("server rejects invalid and oversized upstream feeds and redacts transport failures", async () => {
  const invalid = fixture();
  invalid.live.gps.latitude = 999;
  const cases = [
    [async () => Response.json(invalid), 502],
    [async () => new Response(" ".repeat(512 * 1024 + 1)), 502],
    [async () => Response.json({ private: relay }, { status: 403 }), 503],
    [async () => { throw new Error(`${viewer} ${relay}`); }, 503],
  ];
  for (const [fetch, expected] of cases) {
    const route = load("app/api/live/route.ts", { env, fetch });
    const response = await route.GET(request());
    assert.equal(response.status, expected);
    const text = await response.text();
    assert.ok(!text.includes(viewer) && !text.includes(relay));
    assert.equal("live" in JSON.parse(text), false);
  }
});
