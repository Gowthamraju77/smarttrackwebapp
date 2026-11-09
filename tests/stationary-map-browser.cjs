// Synthetic motion/GPS integration only; no physical equipment or notification delivery.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");
const { chromium } = require(process.env.SMARTTRACK_PLAYWRIGHT_PATH || path.join(os.tmpdir(), "smarttrack-browser-tools", "node_modules", "playwright"));
const loaded = { exports: {} };
new Function("exports", "module", ts.transpileModule(fs.readFileSync(path.join(__dirname, "../lib/live/telemetry.ts"), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(loaded.exports, loaded);

async function verifyStationaryMap(browser, origin) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
  try {
    await context.addInitScript(require("./contact-fixture.cjs").seedContact);
    await context.addInitScript(() => localStorage.setItem("smarttrack.display.steady.v1", "raw"));
    await context.route("https://tiles.openfreemap.org/styles/positron", route => route.fulfill({ contentType: "application/json",
      headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#183c34" } }] }) }));
    await context.route("**/api/notifications/contact", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Synthetic test"}' }));
    await context.route("https://api.open-meteo.com/**", route => route.abort());
    let sequence = 0, startedAt = Date.now() - 10000, stage = "quiet", latest = null;
    const history = [], longitude = metres => metres / 6_371_008.8 * 180 / Math.PI;
    await context.route("**/api/live", route => {
      const now = Date.now();
      if (stage === "offline") {
        const data = structuredClone(latest);
        data.generatedAt = now; data.serial.connected = false;
        return route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
      }
      sequence++;
      const metres = stage === "moving" ? 8 : stage === "restart" ? 9 : stage === "stale" ? 12 : sequence === 1 ? 25 : [-1, 0, 1][sequence % 3];
      const imu = { available: stage !== "stale", receivedAt: stage === "stale" ? now - 6000 : now, sequence, uptimeMs: now - startedAt,
        raw: { ax: stage === "moving" ? 2000 : 200, ay: -100, az: 8192, gx: -1000, gy: 1400, gz: 40, temp: 1500 } };
      const live = new loaded.exports.TelemetryDecoder().snapshot(now);
      live.status = "live"; live.receivedAt = now; live.imu = imu;
      live.gps = { fix: true, latitude: 0, longitude: longitude(metres), receivedAt: now, recordedAt: new Date(now).toISOString(),
        speedMps: 0, courseDeg: null, altitudeM: 0, satellites: 12, hdop: 1, ageMs: 0, source: "INFOESP" };
      live.trust.score = 90; live.trust.reasons = [];
      live.hardware = { imu: { receivedAt: now, values: {
        acceleration_x_m_s2: stage === "moving" ? 2 : 0.3, acceleration_y_m_s2: -0.1, acceleration_z_m_s2: 9.8,
        rotation_x_deg_s: -8, rotation_y_deg_s: 11.5, rotation_z_deg_s: 0.4,
      } } };
      history.push({ latitude: 0, longitude: longitude(metres), receivedAt: now, recordedAt: live.gps.recordedAt });
      const data = { version: 1, source: "esp32-infoesp", generatedAt: now, startedAt, receivedAt: now,
        serial: { port: "SYNTHETIC", baudRate: 115200, connected: true, error: null }, live, capturedSnapshot: structuredClone(live), trajectory: history.slice(-240) };
      latest = structuredClone(data);
      return route.fulfill({ contentType: "application/json", body: JSON.stringify(data) });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(origin + "/#feed=synthetic_stationary_viewer_0000000000000", { waitUntil: "domcontentloaded" });
    const marker = page.getByRole("img", { name: "Current ESP32 GPS fix", exact: true });
    await marker.waitFor();
    await page.locator('[data-position-held="true"]').waitFor();
    assert.equal(await page.getByRole("button", { name: /^(Steady|Raw)$/ }).count(), 0);
    assert.equal(await page.getByRole("region", { name: "Signal stabilization" }).count(), 0);
    assert.doesNotMatch(await page.locator("body").innerText(), /position stabilized|small drift held|display stabilizer|steady position|steady trail/i);

    // Move the camera off the device so a fixed marker cannot merely be camera following.
    const frame = page.locator("[data-map-ready=true]");
    await frame.scrollIntoViewIfNeeded();
    const box = await frame.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 70, box.y + box.height / 2 + 35, { steps: 8 });
    await page.mouse.up();
    await page.locator('[data-map-follow="false"]').waitFor();
    // Wait out map drag inertia before comparing marker positions.
    await page.waitForTimeout(600);
    const markerPosition = await marker.evaluate(element => element.style.transform);
    const receipt = latest.live.receivedAt;
    await page.waitForFunction(before => JSON.parse(sessionStorage.getItem("smarttrack.feed.capture.v1") || "null")?.capturedSnapshot?.receivedAt > before, receipt + 1000);
    assert.equal(await marker.evaluate(element => element.style.transform), markerPosition, "Quiet GPS drift must leave the rendered marker fixed");
    const capture = await page.evaluate(() => JSON.parse(sessionStorage.getItem("smarttrack.feed.capture.v1")));
    assert.ok(capture.points.length > 1, "Original GPS captures must remain available");
    assert.equal(capture.capturedSnapshot.trust.score, 90);
    stage = "moving";
    await page.locator('[data-position-held="false"]').waitFor();
    await page.waitForFunction(before => document.querySelector('[role="img"][aria-label="Current ESP32 GPS fix"]')?.style.transform !== before, markerPosition);
    await page.waitForFunction(expected => JSON.parse(sessionStorage.getItem("smarttrack.feed.capture.v1") || "null")?.capturedSnapshot?.gps.longitude === expected, longitude(8));
    stage = "quiet";
    await page.locator('[data-position-held="true"]').waitFor();
    stage = "stale";
    await page.locator('[data-position-held="false"]').waitFor();
    stage = "quiet";
    await page.locator('[data-position-held="true"]').waitFor();
    stage = "restart"; startedAt = Date.now(); sequence = 0;
    await page.locator('[data-position-held="false"]').waitFor();
    stage = "offline";
    await page.getByRole("img", { name: "Last known ESP32 position, not current", exact: true }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false);
    assert.deepEqual(errors, []);
    return { status: "passed", source: "synthetic GPS and MPU", fixedMarkerDuringDrift: true, movementReleased: true,
      staleMpuReleased: true, reconnectReset: true, originalCapturesPreserved: true, hiddenControls: true, browserErrors: 0 };
  } finally { await context.close(); }
}
module.exports = { verifyStationaryMap };
if (require.main === module) {
  (async () => {
    const browser = await chromium.launch({ headless: true, channel: "msedge", args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
    try { console.log(JSON.stringify(await verifyStationaryMap(browser, process.env.BASE_URL || "http://127.0.0.1:3111"))); }
    finally { await browser.close(); }
  })().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
