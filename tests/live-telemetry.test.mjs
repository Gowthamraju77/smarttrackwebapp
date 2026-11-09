import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Execute the real dependency-free decoder in memory. All coordinates and
// times below are synthetic equatorial fixtures, never captured device data.
const source = readFileSync(new URL("../lib/live/telemetry.ts", import.meta.url), "utf8");
const output = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
const module = { exports: {} };
new Function("exports", "module", output)(module.exports, module);
const { TelemetryDecoder, GPS_STALE_MS, STREAM_STALE_MS } = module.exports;
const start = Date.UTC(2026, 0, 1, 12, 0, 0);

function nmea(body) {
  let checksum = 0;
  for (const character of body) checksum ^= character.charCodeAt(0);
  return `$${body}*${checksum.toString(16).padStart(2, "0").toUpperCase()}\r\n`;
}
function rmc(time = "120000.00", { status = "A", lat = "0000.0000", ns = "N", lon = "00000.0000", ew = "E", knots = "10", course = "90", date = "010126", mode = "A" } = {}) {
  return nmea(`GNRMC,${time},${status},${lat},${ns},${lon},${ew},${knots},${course},${date},,,${mode}`);
}
function gga(time = "120000.00", { quality = "1", lat = "0000.0000", ns = "N", lon = "00000.0000", ew = "E", satellites = "12", hdop = "1.0" } = {}) {
  return nmea(`GNGGA,${time},${lat},${ns},${lon},${ew},${quality},${satellites},${hdop},10.0,M,0.0,M,,`);
}
function mpu(seq = 1, ms = 1000, changes = {}) {
  return `MPU_SAMPLE ${JSON.stringify({ ms, seq, ax: 0, ay: 0, az: 8192, gx: 0, gy: 0, gz: 0, temp: 0, ...changes })}\n`;
}
const display = (fix = true) => `DISPLAY_VALUES ${JSON.stringify({ mpu: true, gps_rx: true, gps_fix: fix, sat: 12, hdop: 1 })}\n`;

test("initial state and diagnostic booleans never manufacture a position or score", () => {
  const decoder = new TelemetryDecoder();
  const initial = decoder.snapshot(start);
  assert.equal(initial.status, "waiting");
  assert.equal(initial.gps.latitude, null);
  assert.equal(initial.trust.score, null);
  const snapshot = decoder.push(display() + mpu(), start);
  assert.equal(snapshot.status, "live");
  assert.equal(snapshot.imu.available, true);
  assert.equal(snapshot.gps.fix, false);
  assert.equal(snapshot.gps.longitude, null);
  assert.equal(snapshot.trust.score, null);
});

test("mixed partial byte chunks yield valid zero coordinates, explicit units and quality arithmetic", () => {
  const decoder = new TelemetryDecoder();
  const bytes = new TextEncoder().encode(`Device boot log\n${mpu()}${rmc()}${gga()}${nmea("GNGSA,A,3,01,02,03,04,,,,,,,,,1.0,1.0,1.0")}`);
  for (let offset = 0; offset < bytes.length; offset += 7) decoder.push(bytes.slice(offset, offset + 7), start);
  const snapshot = decoder.snapshot(start);
  assert.equal(snapshot.gps.fix, true);
  assert.equal(snapshot.gps.latitude, 0);
  assert.equal(snapshot.gps.longitude, 0);
  assert.ok(Math.abs(snapshot.gps.speedMps - 5.144444444444445) < 1e-9);
  assert.equal(snapshot.gps.courseDeg, 90);
  assert.equal(snapshot.gps.altitudeM, 10);
  assert.equal(snapshot.gps.recordedAt, "2026-01-01T12:00:00.000Z");
  assert.equal(snapshot.gps.satellites, 12);
  assert.deepEqual(snapshot.imu.raw, { ax: 0, ay: 0, az: 8192, gx: 0, gy: 0, gz: 0, temp: 0 });
  assert.equal(snapshot.trust.kind, "sensor_quality_heuristic");
  assert.equal(snapshot.trust.score, 100);
  assert.equal(snapshot.trust.factors.reduce((sum, factor) => sum + factor.weight, 0), 100);
  assert.ok(snapshot.trust.factors.every((factor) => factor.value >= 0 && factor.value <= 1));
});

test("hemisphere parsing and inclusive coordinate edges reject malformed degrees/minutes", () => {
  const decoder = new TelemetryDecoder();
  let snapshot = decoder.push(rmc("120000.00", { lat: "0001.5000", ns: "S", lon: "00003.0000", ew: "W" }), start);
  assert.equal(snapshot.gps.latitude, -0.025);
  assert.equal(snapshot.gps.longitude, -0.05);
  decoder.reset();
  snapshot = decoder.push(rmc("120000.00", { lat: "9000.0000", lon: "18000.0000" }), start);
  assert.equal(snapshot.gps.fix, true);
  for (const changes of [{ lat: "0060.0000" }, { lon: "18000.0001" }, { lat: "9000.0001" }, { ns: "E" }, { lon: "0000.0000" }]) {
    decoder.reset();
    snapshot = decoder.push(rmc("120000.00", changes), start);
    assert.equal(snapshot.gps.fix, false);
    assert.equal(snapshot.trust.score, null);
  }
});

test("bad checksums cannot move the marker or refresh its observation", () => {
  const decoder = new TelemetryDecoder();
  decoder.push(rmc(), start);
  const corrupt = rmc("120001.00", { lon: "00001.0000" }).replace(/\*[A-F0-9]{2}/, "*XX");
  const snapshot = decoder.push(corrupt, start + 1000);
  assert.equal(snapshot.gps.longitude, 0);
  assert.equal(snapshot.gps.receivedAt, start);
  assert.equal(snapshot.diagnostics.checksumErrors, 1);
  assert.ok(snapshot.trust.reasons.includes("nmea_checksum_error"));
  const changedBytes = rmc("120001.00", { lon: "00001.0000" }).replace("00001.0000", "00002.0000");
  assert.equal(decoder.push(changedBytes, start + 1000).diagnostics.checksumErrors, 2);
  assert.equal(decoder.snapshot(start + 1000).gps.longitude, 0);
});

test("a live IMU stream cannot keep old GPS or replayed NMEA current", () => {
  const decoder = new TelemetryDecoder();
  decoder.push(rmc() + gga() + mpu(), start);
  decoder.push(rmc() + mpu(2, 12000), start + GPS_STALE_MS + 1);
  const snapshot = decoder.snapshot(start + GPS_STALE_MS + 1);
  assert.equal(snapshot.status, "live");
  assert.equal(snapshot.gps.fix, false);
  assert.equal(snapshot.gps.receivedAt, start);
  assert.equal(snapshot.gps.latitude, 0, "retain a clearly last-known position");
  assert.equal(snapshot.trust.score, null);
  assert.ok(snapshot.trust.reasons.includes("gps_stale"));
});

test("unplugged input becomes stale without any new bytes and stops scoring", () => {
  const decoder = new TelemetryDecoder();
  decoder.push(rmc() + gga() + mpu(), start);
  const snapshot = decoder.snapshot(start + STREAM_STALE_MS + 1);
  assert.equal(snapshot.status, "stale");
  assert.equal(snapshot.imu.available, false);
  assert.equal(snapshot.trust.score, null);
});

test("RMC validity requires its own coordinates and invalid fixes override old GGA", () => {
  const decoder = new TelemetryDecoder();
  decoder.push(gga(), start);
  let snapshot = decoder.push(rmc("120001.00", { lat: "", lon: "" }) + display(), start + 1000);
  assert.equal(snapshot.gps.fix, false);
  assert.equal(snapshot.gps.receivedAt, start);
  assert.equal(snapshot.trust.score, null);
  decoder.reset();
  decoder.push(gga(), start);
  snapshot = decoder.push(rmc("120001.00", { status: "V" }) + gga("120001.00"), start + 1000);
  assert.equal(snapshot.gps.fix, false, "conflicting same-epoch GGA must not override RMC void");
  snapshot = decoder.push(rmc("120002.00") + gga("120002.00"), start + 2000);
  assert.equal(snapshot.gps.fix, true);
});

test("old, future and malformed GPS dates cannot claim a current fix", () => {
  for (const changes of [{ date: "311225" }, { date: "020126" }, { date: "310226" }, { date: "" }]) {
    const snapshot = new TelemetryDecoder().push(rmc("120000.00", changes), start);
    assert.equal(snapshot.gps.fix, false);
    assert.equal(snapshot.trust.score, null);
  }
  const snapshot = new TelemetryDecoder().push(gga(), start);
  assert.equal(snapshot.gps.recordedAt, null);
  assert.ok(snapshot.trust.reasons.includes("gps_time_unknown"));
});

test("NMEA void, estimated, manual, simulated and unknown modes never become satellite fixes", () => {
  for (const mode of ["N", "E", "M", "S", "X"]) {
    const snapshot = new TelemetryDecoder().push(rmc("120000.00", { mode }), start);
    assert.equal(snapshot.gps.fix, false);
    assert.equal(snapshot.trust.score, null);
  }
  for (const quality of ["0", "6", "7", "8", "9", ""]) {
    const snapshot = new TelemetryDecoder().push(gga("120000.00", { quality }), start);
    assert.equal(snapshot.gps.fix, false);
    assert.equal(snapshot.trust.score, null);
  }
});

test("RMC supplies the date for GGA across midnight without inventing host capture time", () => {
  const decoder = new TelemetryDecoder();
  const midnight = Date.UTC(2026, 0, 2);
  decoder.push(rmc("235959.00"), midnight - 1000);
  const snapshot = decoder.push(gga("000000.00"), midnight);
  assert.equal(snapshot.gps.fix, true);
  assert.equal(snapshot.gps.recordedAt, "2026-01-02T00:00:00.000Z");
});

test("rejected RMC clock data cannot poison the date inferred for later GGA", () => {
  const decoder = new TelemetryDecoder();
  decoder.push(rmc() + gga(), start);
  let snapshot = decoder.push(rmc("120000.00", { date: "311225" }), start);
  assert.equal(snapshot.gps.fix, false);
  snapshot = decoder.push(gga("120001.00"), start + 1000);
  assert.equal(snapshot.gps.fix, true);
  assert.equal(snapshot.gps.recordedAt, "2026-01-01T12:00:01.000Z");
  assert.equal(snapshot.gps.longitude, 0);
});

test("older observations and impossible jumps are visible and do not move the marker", () => {
  const decoder = new TelemetryDecoder();
  decoder.push(rmc("120002.00"), start + 2000);
  let snapshot = decoder.push(rmc("120001.00", { lon: "00000.0010" }), start + 3000);
  assert.equal(snapshot.gps.longitude, 0);
  assert.ok(snapshot.trust.reasons.includes("gps_out_of_order"));
  snapshot = decoder.push(rmc("120003.00", { lon: "00100.0000" }), start + 3000);
  assert.equal(snapshot.gps.longitude, 0);
  assert.equal(snapshot.gps.fix, false);
  assert.equal(snapshot.trust.score, null);
  assert.ok(snapshot.trust.reasons.includes("gps_jump_rejected"));
});

test("raw IMU validation, duplicate counters, rollover and reboot preserve honest availability", () => {
  const decoder = new TelemetryDecoder();
  for (const change of [{ ax: "0" }, { gx: 40000 }, { seq: true }, { temp: null }]) decoder.push(mpu(1, 1000, change), start);
  assert.equal(decoder.snapshot(start).imu.available, false);
  decoder.push(mpu(1, 1000), start);
  let snapshot = decoder.push(mpu(1, 1000), start + 6000);
  assert.equal(snapshot.imu.available, false);
  assert.ok(snapshot.trust.reasons.includes("imu_duplicate"));
  decoder.reset();
  decoder.push(mpu(0xfffffffe, 0xfffffff0), start);
  snapshot = decoder.push(mpu(1, 20), start + 100);
  assert.equal(snapshot.imu.available, true);
  assert.ok(!snapshot.trust.reasons.includes("device_restarted"));
  decoder.reset();
  decoder.push(mpu(100, 200000) + rmc(), start);
  snapshot = decoder.push(mpu(1, 1000), start + 1000);
  assert.equal(snapshot.gps.latitude, null);
  assert.equal(snapshot.trust.score, null);
  assert.ok(snapshot.trust.reasons.includes("device_restarted"));
});

test("boot logs/reset and bounded line recovery do not retain another connection's position", () => {
  const decoder = new TelemetryDecoder();
  decoder.push(rmc(), start);
  let snapshot = decoder.push("ESP-ROM:esp32s3-20210327\n", start + 1000);
  assert.equal(snapshot.gps.latitude, null);
  decoder.push("x".repeat(5000) + "\n" + rmc("120002.00"), start + 2000);
  snapshot = decoder.snapshot(start + 2000);
  assert.equal(snapshot.gps.fix, true);
  assert.ok(snapshot.trust.reasons.includes("line_too_long"));
  decoder.reset();
  snapshot = decoder.snapshot(start + 2000);
  assert.equal(snapshot.status, "waiting");
  assert.equal(snapshot.gps.latitude, null);
  assert.equal(snapshot.diagnostics.lines, 0);
});

test("missing quality factors are explicit; worse measured HDOP reduces the live estimate", () => {
  const decoder = new TelemetryDecoder();
  let snapshot = decoder.push(rmc(), start);
  assert.equal(snapshot.trust.factors.find((factor) => factor.id === "precision").value, null);
  assert.ok(snapshot.trust.reasons.includes("gps_hdop_missing"));
  decoder.push(gga() + mpu(), start);
  const excellent = decoder.snapshot(start).trust.score;
  snapshot = decoder.push(rmc("120001.00") + gga("120001.00", { hdop: "5", satellites: "04" }) + mpu(2, 2000), start + 1000);
  assert.ok(snapshot.trust.score < excellent);
  assert.equal(snapshot.trust.factors.find((factor) => factor.id === "precision").value, 0.2);
  assert.match(snapshot.trust.factors.find((factor) => factor.id === "imu").detail, /does not establish calibration/);
});

test("snapshot copies cannot mutate decoder state and backward clocks cannot produce current scores", () => {
  const decoder = new TelemetryDecoder();
  const snapshot = decoder.push(rmc() + gga() + mpu(), start);
  snapshot.imu.raw.ax = 100;
  snapshot.diagnostics.lines = 999;
  snapshot.trust.factors[0].value = 0;
  assert.equal(decoder.snapshot(start).imu.raw.ax, 0);
  assert.notEqual(decoder.snapshot(start).diagnostics.lines, 999);
  const reversed = decoder.snapshot(start - 1000);
  assert.equal(reversed.status, "stale");
  assert.equal(reversed.gps.fix, false);
  assert.equal(reversed.trust.score, null);
  assert.ok(reversed.trust.reasons.includes("host_clock_reversed"));
  assert.doesNotThrow(() => JSON.stringify(reversed));
});
