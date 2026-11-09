"use strict";

// Local companion process, never a Vercel function. The only device writes are
// serial-port configuration: this process does not send firmware commands.
const { createHash, timingSafeEqual } = require("node:crypto");
const { readFileSync, promises: fs } = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { spawn } = require("node:child_process");
const ts = require("typescript");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const CAPTURE_PATH = path.join(PROJECT_ROOT, ".local", "live-capture.json");
const MAX_TRAJECTORY = 240;
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

function loadLiveModule(name) {
  const filename = path.join(PROJECT_ROOT, "lib", "live", name);
  const javascript = ts.transpileModule(readFileSync(filename, "utf8"), {
    fileName: filename,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const loaded = { exports: {} };
  new Function("exports", "module", javascript)(loaded.exports, loaded);
  return loaded.exports;
}

const { TelemetryDecoder } = loadLiveModule("telemetry.ts");
const { isLiveSnapshot, ageLiveSnapshot } = loadLiveModule("feed.ts");
const { createInfoEspState: makeInfoEspState } = loadLiveModule("infoesp.ts");
const createInfoEspState = (options = {}) => makeInfoEspState({ ...options, ageSnapshot: ageLiveSnapshot });

function infoEspUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error("Invalid infoesp URL");
  return url;
}

async function pollInfoEspOnce({ state, url, fetcher = fetch, signal }) {
  try {
    const response = await fetcher(infoEspUrl(url), {
      headers: { Accept: "application/json" }, cache: "no-store", redirect: "error",
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
    });
    if (!response.ok || !response.body || !response.headers.get("content-type")?.includes("application/json")) throw new Error("Unavailable collector");
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024 * 1024) { await reader.cancel(); throw new Error("Oversized collector response"); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (signal?.aborted) return false;
    return state.ingest(payload);
  } catch {
    state.fail();
    return false;
  }
}

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const validPoint = (point) => point && finite(point.latitude) && Math.abs(point.latitude) <= 90
  && finite(point.longitude) && Math.abs(point.longitude) <= 180
  && finite(point.receivedAt) && point.receivedAt >= 0 && point.receivedAt <= 8_640_000_000_000_000
  && (point.recordedAt === null || typeof point.recordedAt === "string");

function validCapturedSnapshot(snapshot) {
  return isLiveSnapshot(snapshot) && snapshot.gps.fix === true
    && validPoint({ ...snapshot.gps, receivedAt: snapshot.gps.receivedAt })
    && finite(snapshot.receivedAt) && snapshot.status === "live"
    && snapshot.trust?.kind === "sensor_quality_heuristic"
    && finite(snapshot.trust.score) && snapshot.trust.score >= 0 && snapshot.trust.score <= 100
    && Array.isArray(snapshot.trust.factors) && Array.isArray(snapshot.trust.reasons)
    && snapshot.imu && snapshot.diagnostics;
}

function createRelayState({ clock = Date.now, serialPort = "COM14", decoder = new TelemetryDecoder() } = {}) {
  const startedAt = clock();
  let serial = { port: serialPort, baudRate: 115200, connected: false, error: null };
  let capturedSnapshot = null;
  let trajectory = [];
  let lastPointTime = null;

  function snapshot() {
    const generatedAt = clock();
    let live = decoder.snapshot(generatedAt);
    if (!serial.connected) {
      live = {
        ...live,
        status: live.receivedAt === null ? "waiting" : "stale",
        gps: { ...live.gps, fix: false, speedMps: null, courseDeg: null, altitudeM: null },
        imu: { ...live.imu, available: false },
        trust: { ...live.trust, score: null, reasons: [...new Set([...live.trust.reasons, "serial_disconnected"])] },
      };
    }
    return {
      version: 1, source: "esp32-serial", generatedAt, startedAt,
      receivedAt: live.receivedAt, serial: { ...serial }, live,
      capturedSnapshot,
      trajectory: trajectory.map((point) => ({ ...point })),
    };
  }

  return {
    snapshot,
    setSerial(connected, error = null) {
      const wasConnected = serial.connected;
      serial = { ...serial, connected: connected === true, error };
      // A reopened port is a new live stream. Retain its historical baseline
      // separately, and never label an old decoder sample as newly live.
      if (connected && !wasConnected) decoder.reset();
    },
    ingest(chunk) {
      if (!serial.connected) return false;
      const live = decoder.push(chunk, clock());
      if (!validCapturedSnapshot(live)) return false;
      capturedSnapshot = live;
      if (live.gps.receivedAt !== lastPointTime) {
        trajectory.push({
          latitude: live.gps.latitude, longitude: live.gps.longitude,
          receivedAt: live.gps.receivedAt, recordedAt: live.gps.recordedAt,
        });
        if (trajectory.length > MAX_TRAJECTORY) trajectory.shift();
        lastPointTime = live.gps.receivedAt;
      }
      return true;
    },
    captureRecord() {
      return {
        version: 1, source: "esp32-serial", savedAt: clock(),
        capturedSnapshot, trajectory: trajectory.map((point) => ({ ...point })),
      };
    },
    restoreCapture(record) {
      if (record?.version !== 1 || record.source !== "esp32-serial" || !validCapturedSnapshot(record.capturedSnapshot)) return false;
      capturedSnapshot = record.capturedSnapshot;
      trajectory = Array.isArray(record.trajectory) ? record.trajectory.filter(validPoint).slice(-MAX_TRAJECTORY) : [];
      lastPointTime = trajectory.at(-1)?.receivedAt ?? null;
      // Deliberately do not hydrate the live decoder or set serial.connected.
      return true;
    },
  };
}

async function readCapture(filename = CAPTURE_PATH) {
  try {
    const stat = await fs.stat(filename);
    if (!stat.isFile() || stat.size > MAX_CAPTURE_BYTES) return null;
    return JSON.parse(await fs.readFile(filename, "utf8"));
  } catch { return null; }
}

async function writeCapture(record, filename = CAPTURE_PATH) {
  if (!validCapturedSnapshot(record?.capturedSnapshot)) return;
  const serialized = JSON.stringify(record);
  if (Buffer.byteLength(serialized) > MAX_CAPTURE_BYTES) throw new Error("capture_too_large");
  await fs.mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
  const temporary = `${filename}.${process.pid}.tmp`;
  await fs.writeFile(temporary, serialized, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporary, filename);
}

function createRelayServer({ state, secret }) {
  if (typeof secret !== "string" || secret.length < 32 || /\s/.test(secret)) {
    throw new Error("SMARTTRACK_RELAY_SECRET must contain at least 32 non-whitespace characters");
  }
  const expected = createHash("sha256").update(secret).digest();
  const server = http.createServer({ maxHeaderSize: 8192 }, (request, response) => {
    const reply = (status, value, extra = {}) => {
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store", "Vary": "Authorization",
        "X-Content-Type-Options": "nosniff", ...extra,
      });
      response.end(JSON.stringify(value));
    };
    const match = /^Bearer ([^\s,]+)$/i.exec(request.headers.authorization ?? "");
    const supplied = createHash("sha256").update(match?.[1] ?? "").digest();
    if (!timingSafeEqual(expected, supplied)) {
      reply(401, { error: "unauthorized" }, { "WWW-Authenticate": "Bearer" });
      return;
    }
    if (request.method !== "GET") { reply(405, { error: "method_not_allowed" }, { Allow: "GET" }); return; }
    // Query-string authentication and raw-line access are intentionally absent.
    const route = request.url?.split("?", 1)[0];
    if (route === "/snapshot") { reply(200, state.snapshot()); return; }
    if (route === "/health") {
      const snapshot = state.snapshot();
      reply(200, {
        service: "smarttrack-local-relay", generatedAt: snapshot.generatedAt,
        startedAt: snapshot.startedAt, serial: snapshot.serial,
        status: snapshot.live.status, hasCapture: snapshot.capturedSnapshot !== null,
        trajectoryPoints: snapshot.trajectory.length,
      });
      return;
    }
    reply(404, { error: "not_found" });
  });
  server.requestTimeout = 5000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 1000;
  return server;
}

function startSerialReader(state, onCapture, { spawnReader = spawn } = {}) {
  const environment = { ...process.env, SMARTTRACK_RELAY_PARENT_PID: String(process.pid) };
  delete environment.SMARTTRACK_RELAY_SECRET;
  const child = spawnReader("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
    "-File", path.join(__dirname, "start-live-relay.ps1"), "-ReadSerial",
  ], { cwd: PROJECT_ROOT, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let statusText = "";
  child.stderr.on("data", (chunk) => {
    statusText = (statusText + chunk.toString("utf8")).slice(-2048);
    const lines = statusText.split(/\r?\n/);
    statusText = lines.pop() ?? "";
    for (const line of lines) {
      if (line === "SERIAL_CONNECTED") state.setSerial(true);
      if (line.startsWith("SERIAL_ERROR:")) state.setSerial(false, "Serial port is unavailable or disconnected.");
    }
  });
  child.stdout.on("data", (chunk) => { if (state.ingest(chunk)) onCapture(); });
  child.on("error", () => state.setSerial(false, "Serial reader could not be started."));
  child.on("exit", () => state.setSerial(false, "Serial reader stopped."));
  return child;
}

async function main() {
  const port = Number(process.env.SMARTTRACK_RELAY_PORT ?? "4317");
  const serialPort = process.env.SMARTTRACK_SERIAL_PORT ?? "COM14";
  const inputMode = process.env.SMARTTRACK_RELAY_INPUT ?? "serial";
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid relay TCP port");
  if (inputMode === "serial" && !/^COM[1-9]\d*$/i.test(serialPort)) throw new Error("Invalid serial port name");
  if (!["serial", "stdin", "infoesp"].includes(inputMode)) throw new Error("Invalid relay input mode");
  const collectorUrl = inputMode === "infoesp" ? infoEspUrl(process.env.SMARTTRACK_INFOESP_URL).href : null;
  const state = inputMode === "infoesp" ? createInfoEspState() : createRelayState({ serialPort });
  if (inputMode !== "infoesp") {
    const restored = await readCapture();
    if (restored) state.restoreCapture(restored);
  }
  const server = createRelayServer({ state, secret: process.env.SMARTTRACK_RELAY_SECRET });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  // Operational output contains no coordinates, raw samples, or credentials.
  process.stdout.write(`SmartTrack relay listening on 127.0.0.1:${port}\n`);
  let dirty = false;
  let writing = false;
  async function persist() {
    if (!dirty || writing) return;
    dirty = false;
    writing = true;
    try { await writeCapture(state.captureRecord()); }
    catch { process.stderr.write("Local capture could not be saved.\n"); }
    finally { writing = false; }
  }
  const saveTimer = setInterval(() => { void persist(); }, 1000);
  let child = null;
  let stopping = false;
  let retryTimer = null;
  const collectorAbort = new AbortController();
  const pollCollector = async () => {
    await pollInfoEspOnce({ state, url: collectorUrl, signal: collectorAbort.signal });
    if (!stopping) retryTimer = setTimeout(() => void pollCollector(), 1000);
  };
  const reconnect = () => {
    if (stopping) return;
    child = startSerialReader(state, () => { dirty = true; });
    child.once("close", () => {
      if (!stopping) retryTimer = setTimeout(reconnect, 2000);
    });
  };
  if (inputMode === "infoesp") void pollCollector();
  else if (inputMode === "serial") reconnect();
  else {
    state.setSerial(true);
    process.stdin.on("data", (chunk) => { if (state.ingest(chunk)) dirty = true; });
    process.stdin.on("end", () => state.setSerial(false, "Input stream ended."));
  }
  async function stop() {
    if (stopping) return;
    stopping = true;
    clearInterval(saveTimer);
    if (retryTimer) clearTimeout(retryTimer);
    collectorAbort.abort();
    child?.kill();
    if (inputMode === "infoesp") state.fail("Relay stopped.");
    else state.setSerial(false, "Relay stopped.");
    await persist();
    server.close(() => process.exit(0));
    server.closeAllConnections();
  }
  process.once("SIGINT", () => { void stop(); });
  process.once("SIGTERM", () => { void stop(); });
}

module.exports = { createRelayState, createRelayServer, readCapture, writeCapture, startSerialReader, createInfoEspState, pollInfoEspOnce };
if (require.main === module) main().catch(() => {
  process.stderr.write("Relay could not start. Check its port, configuration, and local dependencies.\n");
  process.exitCode = 1;
});
