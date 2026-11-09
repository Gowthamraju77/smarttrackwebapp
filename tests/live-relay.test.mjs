import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// No serial device is opened. Real decoder/state/HTTP code is exercised with
// synthetic equatorial telemetry, a private loopback listener and temporary files.
const require = createRequire(import.meta.url);
const { createRelayState, createRelayServer, readCapture, writeCapture } = require("../scripts/live-relay.cjs");
const secret = "synthetic-relay-test-key-0000000000000000";
const epoch = Date.UTC(2026, 0, 1, 12);

function sentence(body) {
  let checksum = 0;
  for (const character of body) checksum ^= character.charCodeAt(0);
  return `$${body}*${checksum.toString(16).padStart(2, "0")}\n`;
}

function fixture(second = 0) {
  const date = new Date(epoch + second * 1000);
  const time = date.toISOString().slice(11, 19).replaceAll(":", "");
  return sentence(`GNRMC,${time}.00,A,0000.0000,N,00000.0000,E,0,0,010126,,,A`)
    + sentence(`GNGGA,${time}.00,0000.0000,N,00000.0000,E,1,12,1.0,0,M,0,M,,`)
    + `MPU_SAMPLE ${JSON.stringify({ ms: (second + 1) * 1000, seq: second + 1, ax: 0, ay: 0, az: 8192, gx: 0, gy: 0, gz: 0, temp: 0 })}\n`;
}

test("relay needs a connected stream, distinguishes historical capture and stops scores immediately on disconnect", () => {
  let now = epoch;
  const state = createRelayState({ clock: () => now });
  assert.equal(state.ingest(fixture()), false);
  assert.equal(state.snapshot().capturedSnapshot, null);
  state.setSerial(true);
  assert.equal(state.ingest(fixture()), true);
  const live = state.snapshot();
  assert.equal(live.source, "esp32-serial");
  assert.equal(live.generatedAt, epoch);
  assert.equal(live.startedAt, epoch);
  assert.equal(live.live.gps.fix, true);
  assert.equal(live.live.trust.score, 100);
  assert.equal(live.trajectory.length, 1);
  now += 100;
  state.setSerial(false, "Serial reader stopped.");
  const disconnected = state.snapshot();
  assert.equal(disconnected.generatedAt, epoch + 100);
  assert.equal(disconnected.live.status, "stale");
  assert.equal(disconnected.live.gps.fix, false);
  assert.equal(disconnected.live.gps.speedMps, null);
  assert.equal(disconnected.live.trust.score, null);
  assert.equal(disconnected.capturedSnapshot.gps.receivedAt, epoch);
  assert.equal(disconnected.capturedSnapshot.trust.score, 100);
});

test("trajectory is bounded and repeated NMEA/IMU traffic cannot add duplicate position timestamps", () => {
  let now = epoch;
  const state = createRelayState({ clock: () => now });
  state.setSerial(true);
  for (let second = 0; second < 245; second++) {
    now = epoch + second * 1000;
    state.ingest(fixture(second));
    state.ingest(fixture(second));
  }
  const snapshot = state.snapshot();
  assert.equal(snapshot.trajectory.length, 240);
  assert.equal(snapshot.trajectory[0].receivedAt, epoch + 5000);
  assert.equal(snapshot.trajectory.at(-1).receivedAt, epoch + 244000);
  now += 11000;
  assert.equal(state.snapshot().live.trust.score, null);
  assert.equal(state.snapshot().capturedSnapshot.gps.receivedAt, epoch + 244000);
});

test("reconnect resets live evidence while preserving the previous actual capture", () => {
  let now = epoch;
  const state = createRelayState({ clock: () => now });
  state.setSerial(true);
  state.ingest(fixture());
  state.setSerial(false);
  now += 1000;
  state.setSerial(true);
  const reopened = state.snapshot();
  assert.equal(reopened.serial.connected, true);
  assert.equal(reopened.live.status, "waiting");
  assert.equal(reopened.live.gps.latitude, null);
  assert.equal(reopened.live.trust.score, null);
  assert.equal(reopened.capturedSnapshot.gps.latitude, 0);
});

test("capture persistence restores historical evidence only and rejects broken input", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "smarttrack-relay-test-"));
  const filename = path.join(directory, "capture.json");
  try {
    const state = createRelayState({ clock: () => epoch });
    state.setSerial(true);
    state.ingest(fixture());
    await writeCapture(state.captureRecord(), filename);
    const encoded = await readFile(filename, "utf8");
    assert.ok(!encoded.includes("MPU_SAMPLE"));
    assert.ok(!encoded.includes(secret));
    const restored = createRelayState({ clock: () => epoch + 60000 });
    assert.equal(restored.restoreCapture(await readCapture(filename)), true);
    assert.equal(restored.snapshot().live.status, "waiting");
    assert.equal(restored.snapshot().live.trust.score, null);
    assert.equal(restored.snapshot().serial.connected, false);
    assert.equal(restored.snapshot().capturedSnapshot.gps.receivedAt, epoch);
    assert.equal(restored.snapshot().trajectory.length, 1);
    assert.equal(restored.restoreCapture({ source: "demo", capturedSnapshot: {} }), false);
    await writeFile(filename, "{broken", "utf8");
    assert.equal(await readCapture(filename), null);
    assert.equal(await readCapture(path.join(directory, "absent.json")), null);
  } finally {
    // Exact leaf files only; no recursive shell deletion or computed tree removal.
    await rm(filename, { force: true });
    await rmdir(directory);
  }
});

test("HTTP requires bearer auth for every endpoint, exposes no raw route, and health excludes location", async () => {
  const state = createRelayState({ clock: () => epoch });
  state.setSerial(true);
  state.ingest(fixture());
  assert.throws(() => createRelayServer({ state, secret: "short" }));
  const server = createRelayServer({ state, secret });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const pathname of ["/health", "/snapshot", `/snapshot?token=${secret}`]) {
      const response = await fetch(origin + pathname);
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { error: "unauthorized" });
    }
    const headers = { Authorization: `Bearer ${secret}` };
    const health = await (await fetch(origin + "/health", { headers })).json();
    assert.equal(health.hasCapture, true);
    assert.ok(!JSON.stringify(health).includes("latitude"));
    assert.ok(!JSON.stringify(health).includes(secret));
    const response = await fetch(origin + "/snapshot", { headers });
    assert.equal(response.status, 200);
    const snapshot = await response.json();
    assert.equal(snapshot.live.gps.latitude, 0);
    assert.equal(snapshot.capturedSnapshot.trust.score, 100);
    assert.equal((await fetch(origin + "/raw", { headers })).status, 404);
    assert.equal((await fetch(origin + "/snapshot", { headers, method: "POST" })).status, 405);
    assert.equal((await fetch(origin + "/snapshot", { headers: { Authorization: "Bearer wrong" } })).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
