// Explicit real-feed verification. No device commands, contact submissions,
// coordinates, credentials or screenshots are written to the report.
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require(path.join(os.tmpdir(), "smarttrack-browser-tools", "node_modules", "playwright"));
const origin = process.env.BASE_URL || "http://127.0.0.1:3111";

async function expectReportedPosition(page, feed) {
  const hasPosition = feed.live.gps.latitude !== null || feed.capturedSnapshot?.gps.latitude != null;
  if (hasPosition) {
    await page.getByRole("img", { name: /Current ESP32 GPS fix|Last known ESP32 position, not current/ }).waitFor();
  } else {
    await page.getByText("Waiting for your GPS", { exact: true }).first().waitFor();
  }
  assert.equal(await page.getByRole("button", { name: /^(Steady|Raw)$/ }).count(), 0, "Map filtering must have no visible mode controls");
  assert.equal(await page.getByRole("region", { name: "Signal stabilization" }).count(), 0, "The stabilization panel must not be displayed");
  return hasPosition;
}

async function main() {
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  try {
    const context = await browser.newContext({ viewport: { width: 1365, height: 1000 }, reducedMotion: "reduce" });
    await context.addInitScript(require("./contact-fixture.cjs").seedContact);
    await context.route("**/api/notifications/contact", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Contact sync is excluded from this feed check."}' }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const errors = [], observations = [], routesChecked = ["/"];
    let credentialedRequests = 0;
    page.on("request", request => {
      if (new URL(request.url()).pathname === "/api/live" && request.headers().authorization) credentialedRequests++;
    });
    page.on("pageerror", error => errors.push(error.message));
    page.on("response", async response => {
      if (new URL(response.url()).pathname !== "/api/live" || response.status() !== 200) return;
      try { observations.push(await response.json()); } catch { /* Ignore requests cancelled by closing the browser. */ }
    });
    await page.goto(origin, { waitUntil: "domcontentloaded" });
    const display = page.locator('[data-hardware-kind="display"][data-report-state="current"]');
    await display.waitFor();
    const firstDisplayReceipt = Number(await display.getAttribute("data-received-at"));
    const firstFeedReceipt = observations.at(-1)?.live.receivedAt;
    assert.ok(Number.isFinite(firstFeedReceipt), "The initial device receipt must be present");
    await page.waitForFunction(before => Number(document.querySelector('[data-hardware-kind="display"]')?.getAttribute("data-received-at")) > before, firstDisplayReceipt);
    assert.ok(observations.some(feed => feed.live.receivedAt > firstFeedReceipt), "The browser must receive a newer actual sensor observation");
    const latest = observations.at(-1);
    assert.equal(latest.source, "esp32-infoesp");
    assert.equal(latest.live.status, "live");
    assert.equal(latest.serial.connected, true);
    const positionMarker = await expectReportedPosition(page, latest);
    assert.equal(await page.evaluate(() => location.hash), "", "The normal URL has no private fragment");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("smarttrack.feed.viewer.v1")), null, "No viewer credential may be required or injected");
    assert.equal(await page.locator('[aria-labelledby="live-motion-title"]').getByText("Receiving", { exact: true }).count(), latest.live.imu.available ? 1 : 0, "MPU availability in the panel must follow the feed");
    for (const [kind, field] of [["modem", "last_error"], ["imu", "error"]]) {
      const reported = latest.live.hardware[kind]?.values[field];
      if (reported) assert.ok((await page.locator(`[data-hardware-kind="${kind}"]`).innerText()).includes(reported), "The component's reported error must appear in its panel");
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 2), false, "Mobile layout must fit the viewport");
    await page.reload({ waitUntil: "domcontentloaded" });
    const reloadFeed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/live" && response.status() === 200);
    await expectReportedPosition(page, await (await reloadFeed).json());
    assert.equal(await page.evaluate(() => sessionStorage.getItem("smarttrack.feed.viewer.v1")), null);

    // A separate browser context opens the exact /map URL from the user's report.
    const mapContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    await mapContext.addInitScript(require("./contact-fixture.cjs").seedContact);
    await mapContext.route("**/api/notifications/contact", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"Contact sync is excluded from this feed check."}' }));
    const mapPage = await mapContext.newPage();
    const mapResponse = mapPage.waitForResponse(response => new URL(response.url()).pathname === "/api/live" && response.status() === 200);
    await mapPage.goto(origin + "/map", { waitUntil: "domcontentloaded" });
    const mapFeedResponse = await mapResponse;
    assert.equal(mapFeedResponse.request().headers().authorization, undefined);
    await expectReportedPosition(mapPage, await mapFeedResponse.json());
    assert.equal(await mapPage.evaluate(() => sessionStorage.getItem("smarttrack.feed.viewer.v1")), null);
    routesChecked.push("/map (fresh browser)");
    await mapContext.close();

    if (process.env.SMARTTRACK_ALL_SECTIONS === "1") {
      await page.setViewportSize({ width: 1440, height: 1000 });
      for (const route of ["/journeys", "/navigation", "/insights", "/analytics", "/alerts", "/devices", "/display", "/activity", "/settings"]) {
        await page.goto(origin + route, { waitUntil: "domcontentloaded" });
        // Register after navigation so an old page's in-flight poll cannot win.
        const nextResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/live" && response.status() === 200);
        const response = await nextResponse;
        assert.equal(response.request().headers().authorization, undefined);
        assert.equal((await response.json()).source, "esp32-infoesp");
        await page.getByText("Receiving device data", { exact: true }).first().waitFor();
        if (route === "/devices") await page.locator('[data-hardware-kind="display"][data-report-state="current"]').waitFor();
        routesChecked.push(route);
      }
    }
    assert.equal(credentialedRequests, 0, "All live requests must work without an Authorization header");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: "passed", origin, verifiedAt: new Date().toISOString(), source: latest.source,
      responses: observations.length, distinctSensorReceipts: new Set(observations.map(feed => feed.live.receivedAt)).size,
      sensorTimestampsAdvance: true, renderedHardwareTimestampsAdvance: true, positionMarker,
      gpsFixAtCheck: latest.live.gps.fix, imuAvailableAtCheck: latest.live.imu.available,
      hardwareReports: Object.keys(latest.live.hardware), browserErrors: errors.length,
      access: "plain website URL, no viewer token or private link", credentialedRequests, routesChecked,
      note: "Actual infoesp readings via the website API. Physical display, modem registration and MPU operation are not independently certified." }, null, 2));
  } finally { await browser.close(); }
}
main().catch(error => {
  // Keep assertion labels, but never dump actual feed objects or private URLs.
  console.error(JSON.stringify({ status: "failed", message: String(error.message).replace(/#feed=[A-Za-z0-9_-]+/g, "#feed=[private]") }));
  process.exitCode = 1;
});
