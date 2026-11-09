/*
 * Browser integration smoke test, using a MOCK USB transport and synthetic
 * coordinates near 0 degrees latitude/longitude. It never opens a real port.
 * A minimal local map style makes marker tests independent of tile availability.
 * This verifies the UI/decoder lifecycle, not hardware or the external map service.
 *
 * Run against an already running server:
 *   node tests/live-browser-smoke.cjs
 * Optional: BASE_URL, SMARTTRACK_PLAYWRIGHT_PATH, SMARTTRACK_BROWSER_CHANNEL.
 * Set SMARTTRACK_REAL_TILES=1 to also verify the real OpenFreeMap provider.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const playwrightPath = process.env.SMARTTRACK_PLAYWRIGHT_PATH
  || path.join(os.tmpdir(), "smarttrack-browser-tools", "node_modules", "playwright");
const { chromium } = require(playwrightPath);
const baseUrl = process.env.BASE_URL || "http://127.0.0.1:3100";
const realTiles = process.env.SMARTTRACK_REAL_TILES === "1";
const checks = [];
const screenshots = {};

function nmea(body) {
  let checksum = 0;
  for (const character of body) checksum ^= character.charCodeAt(0);
  return `$${body}*${checksum.toString(16).toUpperCase().padStart(2, "0")}\r\n`;
}

function observation(timestamp, sequence, fix = true) {
  const now = new Date(timestamp);
  const two = (value) => String(value).padStart(2, "0");
  const clock = `${two(now.getUTCHours())}${two(now.getUTCMinutes())}${two(now.getUTCSeconds())}.${String(now.getUTCMilliseconds()).padStart(3, "0")}`;
  const date = `${two(now.getUTCDate())}${two(now.getUTCMonth() + 1)}${two(now.getUTCFullYear() % 100)}`;
  // Deliberately synthetic: 0.010000 N, 0.020000 E. No person's location.
  const rmc = `GPRMC,${clock},${fix ? "A" : "V"},0000.6000,N,00001.2000,E,1.5,90.0,${date},,,${fix ? "A" : "N"}`;
  const gga = `GPGGA,${clock},0000.6000,N,00001.2000,E,${fix ? "1" : "0"},10,0.80,12.3,M,0.0,M,,`;
  const imu = { ms: sequence * 1000, seq: sequence, ax: -163, ay: 42, az: 16320, gx: -11, gy: 8, gz: 3, temp: 1500 };
  return nmea(rmc) + nmea(gga) + `MPU_SAMPLE ${JSON.stringify(imu)}\r\n`;
}

function installMockSerial() {
  let controller = null;
  const stats = { requested: 0, opened: 0, closed: 0, cancelled: 0, writes: 0, chunks: 0, options: null, signals: [] };
  const port = {
    readable: null,
    get writable() {
      stats.writes += 1;
      throw new Error("The browser smoke fixture permits serial reads only");
    },
    async open(options) {
      if (options.baudRate !== 115200) throw new Error("Unexpected serial baud rate");
      stats.opened += 1;
      stats.options = options;
      this.readable = new ReadableStream({
        start(value) { controller = value; },
        cancel() { stats.cancelled += 1; controller = null; },
      });
    },
    async close() { stats.closed += 1; this.readable = null; },
    async setSignals(signals) { stats.signals.push(signals); },
  };
  Object.defineProperty(navigator, "serial", {
    configurable: true,
    value: {
      async requestPort(options) {
        stats.requested += 1;
        const filter = options.filters?.[0];
        if (filter?.usbVendorId !== 0x303a || filter?.usbProductId !== 0x1001) {
          throw new Error("The chooser did not filter for the ESP32 USB device");
        }
        return port;
      },
    },
  });
  window.__smarttrackSerialSmoke = {
    stats,
    push(text) {
      if (!controller) throw new Error("Connect the mock device before sending data");
      const bytes = new TextEncoder().encode(text);
      const widths = [1, 3, 17, 2, 29, 5, 11];
      let offset = 0;
      let index = 0;
      while (offset < bytes.length) {
        const end = Math.min(bytes.length, offset + widths[index++ % widths.length]);
        controller.enqueue(bytes.slice(offset, end));
        stats.chunks += 1;
        offset = end;
      }
    },
  };
}

async function main() {
  const errors = [];
  const ignoredFaviconErrors = [];
  const providerResponses = [];
  const launch = {
    headless: true,
    args: ["--enable-webgl", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  };
  if (process.env.SMARTTRACK_BROWSER_CHANNEL) launch.channel = process.env.SMARTTRACK_BROWSER_CHANNEL;
  const browser = await chromium.launch(launch);
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1080 }, reducedMotion: "reduce" });
    await context.addInitScript(require("./contact-fixture.cjs").seedContact);
    await context.addInitScript(installMockSerial);
    if (!realTiles) {
      await context.route("https://tiles.openfreemap.org/styles/positron", (route) => route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "access-control-allow-origin": "*" },
        body: JSON.stringify({
          version: 8,
          name: "Synthetic browser smoke map background",
          sources: {},
          layers: [{ id: "background", type: "background", paint: { "background-color": "#e7eee9" } }],
        }),
      }));
    }
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.on("response", (response) => {
      const url = new URL(response.url());
      if (url.hostname === "tiles.openfreemap.org") {
        providerResponses.push({ path: url.pathname, status: response.status() });
      }
    });
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const source = message.location().url;
      const entry = `${message.text()}${source ? ` (${source})` : ""}`;
      // Browsers may request an optional favicon independently of the app.
      if (/\/favicon\.ico(?:\?|$)/.test(source)) ignoredFaviconErrors.push(entry);
      else errors.push(entry);
    });
    // The browser clock lets us exercise expiry without an eleven-second sleep.
    await page.clock.install({ time: new Date() });

    const visible = async (locator) => locator.waitFor({ state: "visible" });
    const connection = () => page.getByRole("region", { name: "ESP32 connection", exact: true });
    const quality = () => page.getByRole("region", { name: "Trust Score", exact: true });
    let sequence = 0;
    const sendObservation = async (fix = true) => {
      const now = await page.evaluate(() => Date.now());
      const text = observation(now, ++sequence, fix);
      await page.evaluate((value) => window.__smarttrackSerialSmoke.push(value), text);
    };
    const scoreAvailable = async () => {
      await visible(quality().getByText("out of 100", { exact: true }));
      const score = Number(await quality().locator("strong").first().innerText());
      assert.ok(Number.isInteger(score) && score > 0 && score <= 100, `Expected a live quality estimate, got ${score}`);
    };
    const scoreUnavailable = async () => {
      await visible(quality().getByText("unavailable", { exact: true }));
      assert.ok(!/^\d+$/.test(await quality().locator("strong").first().innerText()), "Unavailable score must clear the numeric value");
    };
    const stillConnected = async () => {
      await visible(connection().getByRole("button", { name: "Disconnect", exact: true }));
      const stats = await page.evaluate(() => window.__smarttrackSerialSmoke.stats);
      assert.equal(stats.requested, 1, "Route navigation must not request the port again");
      assert.equal(stats.opened, 1, "Route navigation must retain the existing serial connection");
      assert.equal(stats.closed, 0, "Route navigation must not close the selected port");
    };
    const navigate = async (label, pathname) => {
      await page.getByRole("link", { name: label, exact: true }).first().click();
      await page.waitForURL((url) => url.pathname === pathname);
      await stillConnected();
    };

    const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
    assert.equal(response.status(), 200, "Dashboard must load");
    await visible(connection().getByRole("button", { name: "Connect ESP32", exact: true }));
    checks.push("Dashboard exposes the user-initiated USB connection control");

    await connection().getByRole("button", { name: "Connect ESP32", exact: true }).click();
    await stillConnected();
    await sendObservation();
    await visible(page.getByRole("heading", { name: "Your ESP32, in view", exact: true }));
    await visible(page.getByText("0.010000, 0.020000", { exact: true }));
    await visible(page.getByRole("img", { name: "Current ESP32 GPS fix", exact: true }));
    await scoreAvailable();
    await visible(quality().getByText(/Heuristic estimate.*ML unavailable/));
    await visible(page.getByRole("region", { name: "Motion readings", exact: true }).getByText("-163", { exact: true }));
    checks.push("Chunked mock RMC/GGA and raw MPU messages produce the coordinate, map marker, readings, and explicitly heuristic score");

    await navigate("Live map", "/map");
    await sendObservation();
    await visible(page.getByRole("heading", { name: "Follow your device", exact: true }));
    await visible(page.getByRole("img", { name: "Current ESP32 GPS fix", exact: true }));
    await visible(page.getByText("0.010000, 0.020000", { exact: true }));
    await scoreAvailable();
    const artifactDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "smarttrack-browser-smoke-"));
    screenshots.desktop = path.join(artifactDirectory, "connected-map-desktop.png");
    await page.screenshot({ path: screenshots.desktop, fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await sendObservation();
    await scoreAvailable();
    await visible(page.getByRole("img", { name: "Current ESP32 GPS fix", exact: true }));
    const mobileWidth = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    assert.ok(mobileWidth.content <= mobileWidth.viewport + 1, `Mobile content overflows horizontally: ${JSON.stringify(mobileWidth)}`);
    screenshots.mobile = path.join(artifactDirectory, "connected-map-mobile.png");
    await page.screenshot({ path: screenshots.mobile, fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1080 });
    checks.push("Connected map renders on desktop and mobile without horizontal overflow; screenshots saved outside the repository");
    await navigate("Trust & safety", "/insights");
    await sendObservation();
    await visible(page.getByRole("heading", { name: "Trust, with the evidence", exact: true }));
    await scoreAvailable();
    await visible(page.getByText("What supports this estimate?", { exact: true }));
    checks.push("Map and insights navigation preserves the same serial reader and live evidence");

    await page.clock.fastForward(11_100);
    await scoreUnavailable();
    await visible(page.getByRole("status").filter({ hasText: "No recent usable observations" }));
    checks.push("Stale observations clear the numeric live score");

    await sendObservation();
    await scoreAvailable();
    await sendObservation(false);
    await scoreUnavailable();
    await navigate("Live map", "/map");
    await visible(page.getByRole("heading", { name: "Last known position", exact: true }));
    await visible(page.getByRole("img", { name: "Last known ESP32 position, not current", exact: true }));
    await visible(page.getByText("0.010000, 0.020000", { exact: true }));
    checks.push("Explicit no-fix messages clear the score and retain coordinates only as historical");

    await page.clock.fastForward(1000);
    await sendObservation();
    await scoreAvailable();
    await connection().getByRole("button", { name: "Disconnect", exact: true }).click();
    await visible(connection().getByRole("button", { name: "Connect ESP32", exact: true }));
    await scoreUnavailable();
    await visible(page.getByRole("status").filter({ hasText: "The serial connection is closed" }));
    await visible(page.getByRole("img", { name: "Last known ESP32 position, not current", exact: true }));
    const stats = await page.evaluate(() => window.__smarttrackSerialSmoke.stats);
    assert.equal(stats.cancelled, 1, "Disconnect must cancel the active read");
    assert.equal(stats.closed, 1, "Disconnect must close the port");
    assert.equal(stats.writes, 0, "The app must not write to the device");
    assert.ok(stats.chunks > 20, "The fixture must exercise partial serial chunks");
    checks.push("Disconnect releases the port, labels retained data, and clears the score without serial writes");

    assert.deepEqual(errors, [], "Unexpected browser console/page errors");
    checks.push("No unexpected browser console or page errors");
    if (realTiles) {
      assert.ok(providerResponses.some((response) => response.path === "/styles/positron" && response.status === 200), "Real OpenFreeMap style must return HTTP 200");
      assert.ok(providerResponses.some((response) => /\/planet\/.+\.pbf$/.test(response.path) && response.status === 200), "At least one real OpenFreeMap vector tile must load");
      checks.push("Real OpenFreeMap style and vector tiles load and display the GPS marker");
    }
    console.log(JSON.stringify({
      status: "passed",
      baseUrl,
      transport: "mock navigator.serial; synthetic NMEA/MPU fixtures",
      mapStyle: realTiles ? "real OpenFreeMap style and vector tiles" : "stubbed background; external street tiles not tested",
      actualHardwareTested: false,
      checks,
      screenshots,
      ignoredOptionalFaviconErrors: ignoredFaviconErrors.length,
      ...(realTiles ? { mapResponses: providerResponses.length, successfulVectorTiles: providerResponses.filter((response) => /\/planet\/.+\.pbf$/.test(response.path) && response.status === 200).length } : {}),
    }, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ status: "failed", completedChecks: checks, screenshots, error: error.stack || String(error) }, null, 2));
  process.exitCode = 1;
});
