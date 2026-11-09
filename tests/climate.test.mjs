import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const module = { exports: {} };
  const source = readFileSync(new URL(`../lib/live/${name}.ts`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } });
  new Function("exports", "module", "require", outputText)(module.exports, module, specifier => load(specifier.replace(/^\.\//, "")));
  modules.set(name, module.exports);
  return module.exports;
}
const {
  CLIMATE_REFRESH_MS, CLIMATE_COALESCE_MS, CLIMATE_RETRY_MS, ClimateController,
  currentClimatePoint, climateDistanceM, shouldRefreshClimate, climateIsCurrent, climateUrl, parseClimate, climateCondition,
} = load("climate");
const epoch = Date.UTC(2026, 10, 5, 12);
// Synthetic points near the equator; these are not anyone's personal location.
const point = (metres = 0) => ({ latitude: 0, longitude: metres / 6_371_008.8 * 180 / Math.PI });
const snapshot = (at = epoch, location = point()) => ({
  version: 1, status: "live", receivedAt: at,
  gps: { fix: true, ...location, receivedAt: at, recordedAt: new Date(at).toISOString(), ageMs: 0, speedMps: null, courseDeg: null, altitudeM: null, satellites: 9, hdop: 1, source: "RMC" },
  imu: { available: false, receivedAt: null, sequence: null, uptimeMs: null, raw: null },
  trust: { score: null, kind: "sensor_quality_heuristic", factors: [], reasons: [] },
  diagnostics: { lines: 1, checksumErrors: 0, invalidLines: 0 },
});
const response = (at = epoch, location = point()) => ({
  ...location, utc_offset_seconds: 0,
  current_units: { time: "unixtime", interval: "seconds", temperature_2m: "\u00b0C", apparent_temperature: "\u00b0C", relative_humidity_2m: "%", wind_speed_10m: "km/h", weather_code: "wmo code", is_day: "" },
  current: { time: Math.floor(at / 900_000) * 900, interval: 900, temperature_2m: 12.4, apparent_temperature: 11, relative_humidity_2m: 45, wind_speed_10m: 4.8, weather_code: 2, is_day: 1 },
});
const reading = (at = epoch, location = point()) => parseClimate(response(at, location), location, at);

function harness(t) {
  let now = epoch;
  let state = { reading: null, sourceKey: null, loading: false, error: false };
  const requests = [];
  const notifications = [];
  const controller = new ClimateController(next => { state = next; notifications.push(next); }, {
    now: () => now,
    fetcher: (url, options) => new Promise((resolve, reject) => {
      requests.push({ url, options, reject, resolve: body => resolve(new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } })), resolveText: text => resolve(new Response(text)) });
    }),
  });
  t.after(() => controller.dispose());
  const h = {
    controller, requests, notifications,
    get now() { return now; }, get state() { return state; },
    advance(ms) { now += ms; },
    feed(location = point(), extra = {}) { controller.update({ snapshot: snapshot(now, location), connected: true, sourceKey: "relay:1", ...extra }); },
    start(location = point(), extra = {}) { h.feed(location, extra); h.advance(CLIMATE_COALESCE_MS); h.feed(location, extra); },
  };
  return h;
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("weather eligibility requires both a current connection and a fresh raw GPS fix", () => {
  assert.deepEqual(currentClimatePoint(snapshot(), true, epoch), point());
  assert.equal(currentClimatePoint(snapshot(), false, epoch), null);
  assert.equal(currentClimatePoint(null, true, epoch), null);
  for (const mutate of [
    value => { value.status = "stale"; },
    value => { value.receivedAt -= 5_001; },
    value => { value.gps.fix = false; },
    value => { value.gps.receivedAt -= 10_001; },
    value => { value.gps.receivedAt += 1; },
    value => { value.gps.recordedAt = new Date(epoch - 10_001).toISOString(); },
    value => { value.gps.recordedAt = new Date(epoch + 2_001).toISOString(); },
    value => { value.gps.recordedAt = "not a timestamp"; },
    value => { value.gps.ageMs = 10_001; },
    value => { value.gps.latitude = NaN; },
    value => { value.gps.longitude = 181; },
  ]) {
    const value = snapshot(); mutate(value);
    assert.equal(currentClimatePoint(value, true, epoch), null);
  }
});

test("undated GGA uses genuine receipt freshness, and zero coordinates are valid", () => {
  const value = snapshot(); value.gps.source = "GGA"; value.gps.recordedAt = null;
  assert.deepEqual(currentClimatePoint(value, true, epoch + 4_999), point());
  assert.equal(currentClimatePoint(value, true, epoch - 1), null);
  assert.equal(currentClimatePoint(value, true, NaN), null);
});

test("the weather URL preserves raw GPS and explicitly requests Celsius, km/h and UTC seconds", () => {
  const location = { latitude: -0.012345, longitude: 0.023456 };
  const url = new URL(climateUrl(location));
  assert.equal(url.origin, "https://api.open-meteo.com");
  assert.equal(Number(url.searchParams.get("latitude")), location.latitude);
  assert.equal(Number(url.searchParams.get("longitude")), location.longitude);
  assert.equal(url.searchParams.get("temperature_unit"), "celsius");
  assert.equal(url.searchParams.get("wind_speed_unit"), "kmh");
  assert.equal(url.searchParams.get("timeformat"), "unixtime");
  assert.equal(url.searchParams.get("timezone"), "UTC");
  assert.throws(() => climateUrl({ latitude: 91, longitude: 0 }), RangeError);
});

test("response parsing preserves zeros and distinguishes null measurements from zero", () => {
  const value = response();
  for (const key of ["temperature_2m", "apparent_temperature", "relative_humidity_2m", "wind_speed_10m", "weather_code", "is_day"]) value.current[key] = 0;
  const result = parseClimate(value, point(), epoch);
  assert.equal(result.temperatureC, 0); assert.equal(result.windKmh, 0); assert.equal(result.isDay, false);
  assert.equal(result.validAt, epoch);
  value.current.temperature_2m = null; delete value.current.apparent_temperature; value.current.weather_code = null;
  const partial = parseClimate(value, point(), epoch);
  assert.equal(partial.temperatureC, null); assert.equal(partial.feelsLikeC, null); assert.equal(partial.weatherCode, null);
});

test("invalid units, numeric strings, impossible values and unsupported weather codes are rejected", () => {
  for (const [key, bad] of [["temperature_2m", "12.4"], ["temperature_2m", 71], ["apparent_temperature", Infinity], ["relative_humidity_2m", 101], ["wind_speed_10m", -1], ["weather_code", 42], ["weather_code", 2.5], ["is_day", 0.5]]) {
    const value = response(); value.current[key] = bad;
    assert.equal(parseClimate(value, point(), epoch), null, `${key}: ${bad}`);
  }
  for (const [key, unit] of [["temperature_2m", "F"], ["wind_speed_10m", "m/s"], ["time", "iso8601"], ["interval", "minutes"]]) {
    const value = response(); value.current_units[key] = unit;
    assert.equal(parseClimate(value, point(), epoch), null, `${key}: ${unit}`);
  }
});

test("UTC model times, bounded intervals and provider-grid location are independently validated", () => {
  for (const mutate of [
    value => { value.current.time = epoch; },
    value => { value.current.time = epoch / 1_000 + 61; },
    value => { value.current.time = epoch / 1_000 - 86_401; },
    value => { value.current.interval = 0; },
    value => { value.current.interval = 3_601; },
    value => { value.utc_offset_seconds = 19_800; },
    value => { value.latitude = 91; },
    value => { value.longitude = 2; },
  ]) {
    const value = response(); mutate(value);
    assert.equal(parseClimate(value, point(), epoch), null);
  }
  const value = response(); value.current.time -= 3_600;
  const old = parseClimate(value, point(), epoch);
  assert.ok(old);
  assert.equal(climateIsCurrent(old, point(), epoch), false);
});

test("weather refresh is anchored to a kilometre of movement or five minutes, not successive GPS samples", () => {
  const value = reading();
  for (let metres = 0; metres < 1_000; metres += 10) assert.equal(shouldRefreshClimate(value, point(metres), epoch + 1_000), false);
  assert.equal(shouldRefreshClimate(value, point(1_001), epoch + 1_000), true);
  assert.equal(shouldRefreshClimate(value, point(), epoch + CLIMATE_REFRESH_MS - 1), false);
  assert.equal(shouldRefreshClimate(value, point(), epoch + CLIMATE_REFRESH_MS), true);
  assert.equal(shouldRefreshClimate(value, null, epoch + CLIMATE_REFRESH_MS), false);
  assert.equal(climateIsCurrent(value, point(), epoch), true);
  assert.equal(climateIsCurrent(value, point(1_001), epoch), false);
  assert.equal(climateIsCurrent(value, null, epoch), false);
  assert.equal(climateIsCurrent(value, { latitude: NaN, longitude: 0 }, epoch), false);
  assert.equal(climateIsCurrent(value, point(), epoch - 1), false);
});

test("distance uses the short arc across the international date line", () => {
  const distance = climateDistanceM({ latitude: 0, longitude: 179.999 }, { latitude: 0, longitude: -179.999 });
  assert.ok(distance > 220 && distance < 225);
});

test("WMO descriptions distinguish freezing rain, snow and thunderstorms without inventing unknown conditions", () => {
  assert.equal(climateCondition(0), "Clear sky");
  assert.equal(climateCondition(67), "Freezing rain");
  assert.equal(climateCondition(75), "Heavy snow");
  assert.equal(climateCondition(99), "Thunderstorm with heavy hail");
  assert.equal(climateCondition(null), "Conditions unavailable");
  assert.equal(climateCondition(42), "Conditions unavailable");
});

test("retained or expired GPS cannot start a request, including after the coalescing delay", t => {
  const h = harness(t);
  h.feed(point(), { connected: false }); h.advance(2_000); h.controller.poll();
  assert.equal(h.requests.length, 0);
  h.feed(); h.advance(10_001); h.controller.poll();
  assert.equal(h.requests.length, 0);
  const invalid = snapshot(h.now); invalid.gps.fix = false;
  h.feed(point(), { snapshot: invalid }); h.advance(2_000); h.controller.poll();
  assert.equal(h.requests.length, 0);
});

test("the coalesced request uses the newest raw fix and omits credentials and referrer", async t => {
  const h = harness(t);
  h.feed(); h.advance(400); h.feed(point(1));
  assert.equal(h.requests.length, 0);
  h.advance(400); h.feed(point(2));
  assert.equal(h.requests.length, 1);
  const request = h.requests[0];
  assert.equal(Number(new URL(request.url).searchParams.get("longitude")), point(2).longitude);
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.referrerPolicy, "no-referrer");
  request.resolve(response(h.now, point(2))); await settle();
  assert.equal(h.state.reading.temperatureC, 12.4);
  for (let i = 0; i < 100; i++) { h.advance(1_000); h.feed(point(i)); }
  assert.equal(h.requests.length, 1);
});

test("a superseded request is aborted and its late response cannot overwrite the new location", async t => {
  const h = harness(t); h.start();
  h.start(point(2_000));
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[0].options.signal.aborted, true);
  const newer = response(h.now, point(2_000)); newer.current.temperature_2m = 21;
  h.requests[1].resolve(newer); await settle();
  h.requests[0].resolve(response(h.now)); await settle();
  assert.equal(h.state.reading.temperatureC, 21);
  assert.deepEqual(h.state.reading.location, point(2_000));
});

test("a late response rechecks GPS receipt age even before the next UI polling tick", async t => {
  const h = harness(t); h.start(); h.advance(10_001);
  h.requests[0].resolve(response(h.now)); await settle();
  assert.equal(h.state.reading, null);
  assert.equal(h.state.loading, false);
  assert.equal(h.requests[0].options.signal.aborted, true);
});

test("fix loss retains the previous weather as history and cancels a pending location request", async t => {
  const h = harness(t); h.start();
  h.requests[0].resolve(response(h.now)); await settle();
  const retained = h.state.reading;
  h.start(point(2_000));
  const invalid = snapshot(h.now, point(2_000)); invalid.gps.fix = false;
  h.feed(point(2_000), { snapshot: invalid });
  assert.equal(h.requests[1].options.signal.aborted, true);
  h.requests[1].resolve(response(h.now, point(2_000))); await settle();
  assert.equal(h.state.reading, retained);
  assert.equal(climateIsCurrent(retained, currentClimatePoint(invalid, true, h.now), h.now), false);
});

test("source changes invalidate an in-flight request even at identical coordinates", async t => {
  const h = harness(t); h.start();
  h.start(point(), { sourceKey: "usb:2" });
  assert.equal(h.requests[0].options.signal.aborted, true);
  h.requests[0].resolve(response(h.now)); await settle();
  assert.equal(h.state.reading, null);
  h.requests[1].resolve(response(h.now)); await settle();
  assert.equal(h.state.sourceKey, "usb:2");
});

test("five-minute refresh waits for a fresh fix instead of reusing stored coordinates", async t => {
  const h = harness(t); h.start(); h.requests[0].resolve(response(h.now)); await settle();
  h.advance(CLIMATE_REFRESH_MS); h.controller.poll();
  assert.equal(h.requests.length, 1);
  h.start();
  assert.equal(h.requests.length, 2);
});

test("failed requests back off across sensor updates and then retry with the latest fix", async t => {
  const h = harness(t); h.start(); h.requests[0].reject(new Error("offline")); await settle();
  assert.equal(h.state.error, true); assert.equal(h.state.reading, null);
  for (let i = 0; i < 59; i++) { h.advance(1_000); h.feed(point(i)); }
  assert.equal(h.requests.length, 1);
  h.advance(CLIMATE_RETRY_MS - 59_000); h.start(point(99));
  assert.equal(h.requests.length, 2);
  assert.equal(Number(new URL(h.requests[1].url).searchParams.get("longitude")), point(99).longitude);
});

test("oversized and malformed responses cannot replace a valid historical reading", async t => {
  const h = harness(t); h.start(); h.requests[0].resolve(response(h.now)); await settle();
  const retained = h.state.reading;
  h.start(point(2_000)); h.requests[1].resolveText(" ".repeat(65 * 1_024)); await settle();
  assert.equal(h.state.error, true); assert.equal(h.state.reading, retained);
  h.start(point(4_000));
  const wrong = response(h.now, point(4_000)); wrong.current_units.temperature_2m = "F";
  h.requests[2].resolve(wrong); await settle();
  assert.equal(h.state.error, true); assert.equal(h.state.reading, retained);
});

test("unmount aborts the request and suppresses any later state publication", async t => {
  const h = harness(t); h.start();
  const count = h.notifications.length;
  h.controller.dispose();
  assert.equal(h.requests[0].options.signal.aborted, true);
  h.requests[0].resolve(response(h.now)); await settle();
  assert.equal(h.notifications.length, count);
});
