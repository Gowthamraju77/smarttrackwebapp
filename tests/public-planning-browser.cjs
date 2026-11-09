/* Real public place/road APIs in a clean browser; only the map style is a fixture. */
const assert = require("node:assert/strict");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require(process.env.SMARTTRACK_PLAYWRIGHT_PATH || path.join(os.tmpdir(), "smarttrack-browser-tools/node_modules/playwright"));
const origin = new URL(process.env.BASE_URL || "http://127.0.0.1:3104").origin;
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(require("./contact-fixture.cjs").seedContact);
    await context.route("https://tiles.openfreemap.org/styles/positron", route => route.fulfill({ contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#173d36" } }] }) }));
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    const errors = [], requests = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("request", request => { if (request.url().startsWith(origin + "/api/journey/")) requests.push({ path: new URL(request.url()).pathname, authorization: request.headers().authorization }); });
    await page.goto(origin + "/journeys");
    assert.equal(await page.evaluate(() => sessionStorage.getItem("smarttrack.feed.viewer.v1")), null);
    const planner = page.getByRole("region", { name: "Journey planner", exact: true });
    await planner.getByRole("searchbox", { name: "Search start place", exact: true }).fill("Alexanderplatz Berlin");
    await planner.getByRole("list", { name: "Start place results", exact: true }).getByRole("button").first().click();
    await planner.getByRole("searchbox", { name: "Search destination place", exact: true }).fill("Berliner Dom");
    await planner.getByRole("list", { name: "Destination place results", exact: true }).getByRole("button").first().click();
    const route = planner.getByRole("radio", { name: "Choose route 1", exact: true });
    await route.waitFor({ state: "visible" });
    assert.match(await planner.innerText(), /\d.*km/);
    assert.match(await planner.innerText(), /min estimated/);
    assert.equal(await planner.getByRole("button", { name: "Start journey", exact: true }).isDisabled(), true);
    await route.check();
    await planner.getByRole("button", { name: "Start journey", exact: true }).click();
    await page.waitForURL(url => url.pathname === "/navigation");
    await page.getByRole("region", { name: "Journey navigation", exact: true }).getByText("Waiting for fresh GPS", { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => sessionStorage.getItem("smarttrack.feed.viewer.v1")), null);
    assert.ok(requests.filter(request => request.path.endsWith("/places")).length >= 2);
    assert.ok(requests.some(request => request.path.endsWith("/routes")));
    assert.ok(requests.every(request => request.authorization === undefined));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: "passed", origin, checks: ["Clean browser searches real public places without a private link", "Selected places return real road choices with km and ETA", "Explicit selection opens Navigation and waits for genuine GPS", "No device credential sent and no browser runtime errors"] }, null, 2));
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
