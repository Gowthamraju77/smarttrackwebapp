/*
 * Run against an ALREADY running server. This file never starts a server,
 * opens a serial port, changes the device, or deploys anything.
 *
 * Deterministic UI lifecycle (synthetic API fixtures):
 *   BASE_URL=http://127.0.0.1:3100 node tests/captured-browser-smoke.cjs
 * Actual hosted feed and real map tiles, after root enables the relay:
 *   SMARTTRACK_REAL_FEED=1 BASE_URL=https://... node tests/captured-browser-smoke.cjs
 *
 * Real mode reads SMARTTRACK_VIEWER_SECRET or .local/live-connection.json's
 * viewerSecret. Credentials, locations, raw samples and private URLs are never
 * printed. Screenshots remain in an OS temporary directory.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const playwrightPath = process.env.SMARTTRACK_PLAYWRIGHT_PATH
  || path.join(os.tmpdir(), "smarttrack-browser-tools", "node_modules", "playwright");
const { chromium } = require(playwrightPath);
const baseUrl = new URL(process.env.BASE_URL || "http://127.0.0.1:3100").origin;
const realFeed = process.env.SMARTTRACK_REAL_FEED === "1";
const waitingOnly = process.env.SMARTTRACK_WAITING_ONLY === "1";
const routes = ["/", "/map", "/journeys", "/navigation", "/activity", "/insights", "/analytics", "/alerts", "/devices", "/display", "/team", "/security", "/settings", "/help"];
const forbiddenFixtures = /\b(?:Northstar|Harbor 18|Cedar 27|Alex Stone|AlexStone|demo|synthetic)\b|Morning school route|SOS-0081|ST-041/i;
const checks = [];
const sensitive = new Set();
const screenshots = {};

function redact(value) {
  let text = String(value);
  for (const item of sensitive) if (item) text = text.split(item).join("[private]");
  return text.replace(/#feed=[A-Za-z0-9_-]+/g, "#feed=[private]")
    .replace(/-?\d{1,3}\.\d{5,}\s*,\s*-?\d{1,3}\.\d{5,}/g, "[coordinates]");
}

function decoderClass() {
  const source = fs.readFileSync(path.join(root, "lib", "live", "telemetry.ts"), "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const loaded = { exports: {} };
  new Function("exports", "module", javascript)(loaded.exports, loaded);
  return loaded.exports.TelemetryDecoder;
}
const TelemetryDecoder = decoderClass();
const syntheticStartedAt = Date.now() - 1000;

function nmea(body) {
  let checksum = 0;
  for (const character of body) checksum ^= character.charCodeAt(0);
  return `$${body}*${checksum.toString(16).padStart(2, "0")}\n`;
}

function syntheticFeed(now) {
  const date = new Date(now);
  const two = (value) => String(value).padStart(2, "0");
  const clock = `${two(date.getUTCHours())}${two(date.getUTCMinutes())}${two(date.getUTCSeconds())}.${String(date.getUTCMilliseconds()).padStart(3, "0")}`;
  const day = `${two(date.getUTCDate())}${two(date.getUTCMonth() + 1)}${two(date.getUTCFullYear() % 100)}`;
  // Fixed equatorial coordinates are synthetic and unrelated to any device.
  const decoder = new TelemetryDecoder();
  const live = decoder.push(nmea(`GNRMC,${clock},A,0000.6000,N,00001.2000,E,1.5,90,${day},,,A`)
    + nmea(`GNGGA,${clock},0000.6000,N,00001.2000,E,1,12,1.0,12,M,0,M,,`)
    + 'MPU_SAMPLE {"ms":1000,"seq":1,"ax":-163,"ay":42,"az":8192,"gx":-11,"gy":8,"gz":3,"temp":1500}\n', now);
  return {
    version: 1, source: "esp32-serial", generatedAt: now, startedAt: syntheticStartedAt,
    receivedAt: now, serial: { port: "COM14", baudRate: 115200, connected: true, error: null },
    live, capturedSnapshot: structuredClone(live),
    trajectory: [
      { latitude: 0.0099, longitude: 0.0199, receivedAt: now - 1000, recordedAt: new Date(now - 1000).toISOString() },
      { latitude: 0.01, longitude: 0.02, receivedAt: now, recordedAt: live.gps.recordedAt },
    ],
  };
}

function noSerialChooser() {
  window.__capturedSmokeSerialRequests = 0;
  Object.defineProperty(navigator, "serial", {
    configurable: true,
    value: { async requestPort() {
      window.__capturedSmokeSerialRequests += 1;
      throw new Error("Automatic feed must not request a USB port");
    } },
  });
}

async function installMapStub(context) {
  await context.route("https://tiles.openfreemap.org/styles/positron", (route) => route.fulfill({
    contentType: "application/json", headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#edf2ef" } }] }),
  }));
}

function quality(page) { return page.getByRole("region", { name: "Trust Score", exact: true }); }
function connection(page) { return ["/map", "/journeys", "/navigation"].includes(new URL(page.url()).pathname) ? page.locator("header.topbar") : page.getByRole("region", { name: "ESP32 connection", exact: true }); }
const visible = (locator) => locator.waitFor({ state: "visible" });

async function noFixtures(page, route) {
  const text = await page.locator("body").innerText();
  assert.ok(!forbiddenFixtures.test(text), `Legacy fixture text is visible on ${route}`);
  assert.equal(await page.getByRole("main").count(), 1, `Main landmark missing on ${route}`);
  assert.ok(await page.getByRole("heading", { level: 1 }).count() >= 1, `Page title missing on ${route}`);
}

async function numericScore(page) {
  await visible(quality(page).getByText("out of 100", { exact: true }));
  const text = await quality(page).locator("strong").first().innerText();
  const result = Number(text);
  assert.ok(Number.isInteger(result) && result >= 0 && result <= 100, "A bounded captured/current quality score must be visible");
  return result;
}

async function noChooser(page) {
  assert.equal(await page.evaluate(() => window.__capturedSmokeSerialRequests), 0, "The automatic feed requested a serial chooser");
  if (["/map", "/journeys", "/navigation"].includes(new URL(page.url()).pathname)) assert.equal(await page.getByRole("button", { name: /Connection options/ }).count(), 0, "Focused tracking sections must not duplicate connection controls");
  else assert.equal(await connection(page).getByRole("button", { name: /Connection options/ }).getAttribute("aria-expanded"), "false", "Optional USB controls should remain collapsed");
}

async function waitForEvidence(predicate, description, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, description);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function saveScreenshots(page, prefix) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "smarttrack-captured-browser-"));
  screenshots[`${prefix}Desktop`] = path.join(directory, `${prefix}-desktop.png`);
  await page.screenshot({ path: screenshots[`${prefix}Desktop`], fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const dimensions = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(dimensions.content <= dimensions.viewport + 1, "Captured map overflows the mobile viewport");
  screenshots[`${prefix}Mobile`] = path.join(directory, `${prefix}-mobile.png`);
  await page.screenshot({ path: screenshots[`${prefix}Mobile`], fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1080 });
}

async function waitingRoutes(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, reducedMotion: "reduce" });
  await context.addInitScript(require("./contact-fixture.cjs").seedContact);
  await context.addInitScript(noSerialChooser);
  await installMapStub(context);
  let feedRequests = 0;
  await context.route("**/api/live", (route) => { feedRequests++; return route.fulfill({ status: 401, contentType: "application/json", body: '{"error":"Private device link required"}' }); });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  for (const route of routes) {
    const response = await page.goto(baseUrl + route, { waitUntil: "domcontentloaded" });
    assert.equal(response.status(), 200, `Route ${route} must load`);
    await visible(connection(page).getByText("Connect a device", { exact: true }));
    assert.doesNotMatch(await page.locator("body").innerText(), /Open the private device link|Device feed locked/);
    await noFixtures(page, route);
    await noChooser(page);
    assert.equal(await page.getByRole("img", { name: "Current ESP32 GPS fix", exact: true }).count(), 0, `No-auth route ${route} fabricated a current position`);
  }
  assert.equal(errors.length, 0, "An initial route raised a browser exception");
  assert.equal(feedRequests, 0, "An unconnected browser must not request private device data");
  checks.push("All 14 unauthenticated routes render explicit waiting/empty states without legacy demo identities or fabricated locations");
  await context.close();
}

async function deterministicLifecycle(browser) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, reducedMotion: "reduce" });
  await context.addInitScript(require("./contact-fixture.cjs").seedContact);
  await context.addInitScript(noSerialChooser);
  await installMapStub(context);
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  await page.clock.install({ time: new Date() });
  const viewer = "synthetic_viewer_key_00000000000000000000";
  let phase = "live";
  let clockOffset = 0;
  let latest = null;
  let frozen = null;
  let requests = 0;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await context.route("**/api/live", async (route) => {
    requests += 1;
    assert.equal(route.request().headers().authorization, `Bearer ${viewer}`, "Automatic polling must carry its scoped viewer key");
    if (phase === "offline") {
      await route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Device feed unavailable"}' });
      return;
    }
    const now = Date.now() + clockOffset;
    let data;
    if (phase === "live") {
      data = syntheticFeed(now);
      latest = structuredClone(data);
    } else {
      data = structuredClone(frozen);
      data.generatedAt = now;
      if (phase === "disconnected") {
        data.serial = { ...data.serial, connected: false, error: "Serial reader stopped." };
        data.live = new TelemetryDecoder().snapshot(now);
        data.receivedAt = null;
      }
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(data) });
  });

  await page.goto(`${baseUrl}/#feed=${viewer}`, { waitUntil: "domcontentloaded" });
  await visible(connection(page).getByText("Receiving device data", { exact: true }));
  await visible(quality(page).getByText("Current estimate", { exact: true }));
  await numericScore(page);
  await visible(page.getByRole("img", { name: "Current ESP32 GPS fix", exact: true }));
  await noChooser(page);
  assert.equal(await page.evaluate(() => location.hash), "", "Private fragment must be removed after consumption");
  assert.equal(await page.evaluate(() => sessionStorage.getItem("smarttrack.feed.viewer.v1")), viewer);
  checks.push("Private link automatically loads authenticated device observations, a map marker and an explained score without USB interaction");

  for (const route of routes) {
    await page.goto(baseUrl + route, { waitUntil: "domcontentloaded" });
    await visible(connection(page).getByText("Receiving device data", { exact: true }));
    await noFixtures(page, route);
    await noChooser(page);
  }
  assert.ok(requests >= routes.length, "Every route must retain automatic feed access");
  checks.push("All 14 authenticated routes use received sensor data or an explicit unavailable state");

  await page.goto(baseUrl + "/map", { waitUntil: "domcontentloaded" });
  await visible(page.getByRole("img", { name: "Current ESP32 GPS fix", exact: true }));
  assert.equal(await quality(page).count(), 0, "Live Map must not repeat the score dashboard");
  await saveScreenshots(page, "synthetic-feed");
  await page.getByRole("link", { name: "Trust & safety", exact: true }).first().click();
  await page.waitForURL((url) => url.pathname === "/insights");
  await visible(quality(page).getByText("Current estimate", { exact: true }));
  await visible(page.getByText("What supports this estimate?", { exact: true }));
  await noChooser(page);
  checks.push("Client navigation preserves automatic polling; captured map fits desktop and mobile viewports");

  frozen = structuredClone(latest);
  phase = "frozen";
  const capturedScore = frozen.capturedSnapshot.trust.score;
  const capturedAt = frozen.capturedSnapshot.gps.receivedAt;
  clockOffset += 11000;
  await page.clock.fastForward(11100);
  await visible(quality(page).getByText("Last captured Trust Score", { exact: true }));
  await visible(quality(page).getByText("At capture", { exact: true }));
  assert.equal(await numericScore(page), Math.round(capturedScore), "Expired stream must preserve only its labelled historical score");
  assert.equal(await quality(page).getByText("Current estimate", { exact: true }).count(), 0);
  const storedCaptureTime = await page.evaluate(() => JSON.parse(sessionStorage.getItem("smarttrack.feed.capture.v1")).capturedSnapshot.gps.receivedAt);
  assert.equal(storedCaptureTime, capturedAt, "Aging must not rewrite the original capture timestamp");
  checks.push("An unchanged feed ages to historical data, preserving the original captured score and timestamp");

  phase = "disconnected";
  clockOffset += 2000;
  await page.clock.fastForward(2100);
  await visible(connection(page).getByText("Last captured data", { exact: true }));
  await page.goto(baseUrl + "/", { waitUntil: "domcontentloaded" });
  await visible(page.getByRole("img", { name: "Last known ESP32 position, not current", exact: true }));
  await visible(quality(page).getByText("Last captured Trust Score", { exact: true }));
  assert.equal(await page.getByRole("img", { name: "Current ESP32 GPS fix", exact: true }).count(), 0);
  checks.push("Disconnected relay with an empty live snapshot falls back to explicitly historical captured coordinates and quality");

  phase = "offline";
  await page.reload({ waitUntil: "domcontentloaded" });
  await visible(page.getByRole("img", { name: "Last known ESP32 position, not current", exact: true }));
  await visible(quality(page).getByText("Last captured Trust Score", { exact: true }));
  assert.equal(await numericScore(page), Math.round(capturedScore));
  await visible(connection(page).getByRole("status").filter({ hasText: /unavailable|could not be reached/ }));
  await noChooser(page);
  assert.equal(errors.length, 0, "The deterministic lifecycle raised a browser exception");
  checks.push("Session-cached actual-capture structure survives reload during a feed outage and remains historical");
  await context.close();
}

function readViewerSecret() {
  let viewer = process.env.SMARTTRACK_VIEWER_SECRET;
  if (!viewer) {
    const connection = JSON.parse(fs.readFileSync(path.join(root, ".local", "live-connection.json"), "utf8"));
    viewer = connection.viewerSecret;
  }
  if (typeof viewer !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(viewer)) throw new Error("A valid scoped viewer key is required for the real-feed smoke test");
  sensitive.add(viewer);
  return viewer;
}

async function actualFeed(browser) {
  const viewer = readViewerSecret();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, reducedMotion: "reduce" });
  await context.addInitScript(require("./contact-fixture.cjs").seedContact);
  await context.addInitScript(noSerialChooser);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  let latest = null;
  let successes = 0;
  let styleLoaded = false;
  let tileCount = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", async (response) => {
    const url = new URL(response.url());
    if (url.hostname === "tiles.openfreemap.org" && response.status() === 200) {
      if (url.pathname === "/styles/positron") styleLoaded = true;
      if (/\.pbf$/.test(url.pathname)) tileCount += 1;
    }
    if (url.origin === baseUrl && url.pathname === "/api/live" && response.status() === 200) {
      try { latest = await response.json(); successes += 1; } catch { /* A cancelled navigation is checked by subsequent observations. */ }
    }
  });
  await page.goto(`${baseUrl}/#feed=${viewer}`, { waitUntil: "domcontentloaded" });
  await visible(page.getByRole("img", { name: /Current ESP32 GPS fix|Last known ESP32 position, not current/ }));
  await numericScore(page);
  await noChooser(page);
  await noFixtures(page, "/map");
  assert.ok(successes > 0 && latest?.source === "esp32-serial", "The real authenticated device feed must load automatically");
  const evidence = latest.live.gps.latitude !== null ? latest.live : latest.capturedSnapshot;
  assert.ok(evidence && Number.isFinite(evidence.gps.latitude) && Number.isFinite(evidence.gps.longitude), "Actual captured coordinates are required");
  const coordinates = `${evidence.gps.latitude.toFixed(6)}, ${evidence.gps.longitude.toFixed(6)}`;
  sensitive.add(coordinates);
  await page.getByRole("button", { name: /Position & evidence/ }).click();
  const coordinatesMatch = await page.evaluate((expected) => document.body.innerText.includes(expected), coordinates);
  assert.ok(coordinatesMatch, "Rendered coordinates must match the actual feed response");
  assert.ok(await connection(page).locator("time[datetime]").count() > 0, "Actual observations need a visible original receipt timestamp");
  assert.equal(await page.evaluate(() => location.hash), "", "Viewer fragment must be removed from the current URL");
  await page.waitForFunction(() => document.querySelector(".maplibregl-canvas") !== null);
  await waitForEvidence(() => styleLoaded && tileCount > 0, "Real map style and vector tiles must load");
  await saveScreenshots(page, "actual-capture");
  await page.getByRole("link", { name: "Trust & safety", exact: true }).first().click();
  await page.waitForURL((url) => url.pathname === "/insights");
  await numericScore(page);
  await visible(page.getByText("What supports this estimate?", { exact: true }));
  await noChooser(page);
  for (const route of routes) {
    const previousSuccesses = successes;
    const response = await page.goto(baseUrl + route, { waitUntil: "domcontentloaded" });
    assert.equal(response.status(), 200, `Actual-feed route ${route} must load`);
    await waitForEvidence(() => successes > previousSuccesses, `Actual-feed route ${route} must automatically receive its authenticated feed`);
    await visible(connection(page).getByText(/^(Receiving device data|Last captured data)$/));
    await noFixtures(page, route);
    await noChooser(page);
  }
  assert.equal(errors.length, 0, "The actual-feed browser session raised an exception");
  checks.push("Actual hosted feed loads automatically, renders matching captured coordinates and a timestamped score, and loads real street-map vector tiles");
  checks.push("All 14 authenticated routes automatically receive the actual device feed and show no legacy demo identities");
  await context.close();
}

async function main() {
  const browser = await chromium.launch({
    headless: true, channel: process.env.SMARTTRACK_BROWSER_CHANNEL || "msedge",
    args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    await waitingRoutes(browser);
    if (waitingOnly) { /* Verify the public empty states without requesting device data. */ }
    else if (realFeed) await actualFeed(browser);
    else await deterministicLifecycle(browser);
    console.log(JSON.stringify({
      status: "passed", origin: baseUrl,
      mode: waitingOnly ? "public waiting states; no private feed requests" : realFeed ? "actual hosted device feed and real map tiles" : "synthetic authenticated API fixtures; no hardware or hosted feed tested",
      routesChecked: routes.length, serialPortOpened: false, checks, screenshots,
    }, null, 2));
  } finally { await browser.close(); }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "failed", mode: realFeed ? "actual-feed" : "synthetic-feed", checks, screenshots, error: redact(error.stack || error) }, null, 2));
  process.exitCode = 1;
});
