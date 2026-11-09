import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

// Review fixtures are synthetic. No local capture, credentials, or serial port
// is accessed, and importing the relay does not start its main process.
const require = createRequire(import.meta.url);
const { createRelayState } = require("../scripts/live-relay.cjs");
function load(relative) {
  const source = readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const loaded = { exports: {} };
  new Function("exports", "module", javascript)(loaded.exports, loaded);
  return loaded.exports;
}
const { isLiveFeed, ageLiveSnapshot } = load("lib/live/feed.ts");
const { TelemetryDecoder } = load("lib/live/telemetry.ts");
const epoch = Date.UTC(2026, 0, 1, 12);
function nmea(body) {
  let checksum = 0;
  for (const character of body) checksum ^= character.charCodeAt(0);
  return `$${body}*${checksum.toString(16).padStart(2, "0")}\n`;
}
function fixture() {
  const live = new TelemetryDecoder().push(
    nmea("GNRMC,120000.00,A,0000.0000,N,00000.0000,E,0,0,010126,,,A")
      + nmea("GNGGA,120000.00,0000.0000,N,00000.0000,E,1,12,1,0,M,0,M,,")
      + 'MPU_SAMPLE {"ms":1000,"seq":1,"ax":0,"ay":0,"az":8192,"gx":0,"gy":0,"gz":0,"temp":0}\n',
    epoch,
  );
  return {
    version: 1, source: "esp32-serial", generatedAt: epoch, startedAt: epoch,
    receivedAt: epoch, serial: { port: "COM14", baudRate: 115200, connected: true, error: null },
    live, capturedSnapshot: structuredClone(live), trajectory: [],
  };
}

test("review: every receipt timestamp is nonnegative and representable as a JavaScript Date", () => {
  const acceptedInvalidFields = [];
  for (const field of ["generatedAt", "startedAt", "receivedAt", "live.receivedAt", "live.gps.receivedAt", "live.imu.receivedAt", "capturedSnapshot.receivedAt"]) {
    for (const invalid of [-1, 8_640_000_000_000_001]) {
      const data = fixture();
      const parts = field.split(".");
      const target = parts.slice(0, -1).reduce((value, key) => value[key], data);
      target[parts.at(-1)] = invalid;
      if (isLiveFeed(data)) acceptedInvalidFields.push(`${field}=${invalid}`);
    }
  }
  assert.deepEqual(acceptedInvalidFields, []);
});

test("review: a last-known GPS position still requires a complete coordinate pair", () => {
  const data = fixture();
  data.live.gps.fix = false;
  data.live.gps.longitude = null;
  assert.equal(isLiveFeed(data), false);
});

test("review: a parseable malformed saved capture cannot poison the whole relay feed", () => {
  const data = fixture();
  const record = { version: 1, source: "esp32-serial", capturedSnapshot: data.capturedSnapshot, trajectory: [] };
  delete record.capturedSnapshot.imu.raw;
  const state = createRelayState({ clock: () => epoch });
  assert.equal(state.restoreCapture(record), false);
  assert.equal(isLiveFeed(state.snapshot()), true);
});

test("review: independently future GPS and IMU receipts cannot retain current claims", () => {
  const data = fixture();
  data.live.gps.receivedAt = epoch + 60_000;
  data.live.gps.recordedAt = null;
  data.live.imu.receivedAt = epoch + 60_000;
  const aged = ageLiveSnapshot(data.live, epoch, true);
  assert.equal(aged.gps.fix, false);
  assert.equal(aged.imu.available, false);
  assert.equal(aged.trust.score, null);
});
