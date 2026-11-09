/* Synthetic public places and roads verify route choices; no device or messages. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(path.join(os.tmpdir(), 'smarttrack-browser-tools/node_modules/playwright'));
const origin = process.env.BASE_URL || 'http://127.0.0.1:3110';
const start = { latitude: 52.52, longitude: 13.405, label: 'Synthetic Start' };
const end = { latitude: 52.52, longitude: 13.415, label: 'Synthetic Finish' };
const via = { latitude: 52.524, longitude: 13.410, label: 'Synthetic Via Park' };
const coordinate = point => [point.longitude, point.latitude];
const routes = Array.from({ length: 4 }, (_, index) => ({
  coordinates: [coordinate(start), [13.410, 52.520 + index * .001], coordinate(end)],
  distanceM: 800 + index * 200, durationS: 180 + index * 60, provider: 'Synthetic road fixture',
  startSnapDistanceM: 0, endSnapDistanceM: 0,
}));
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'smarttrack-route-options-'));
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(require('./contact-fixture.cjs').seedContact);
    await context.addInitScript(({ start, end, routes }) => {
      if (!sessionStorage.getItem('smarttrack.journey.tab.v1')) sessionStorage.setItem('smarttrack.journey.tab.v1', JSON.stringify({ version: 1, plan: { start, end, routes: routes.slice(0, 2), selectedRouteIndex: 0 }, state: { phase: 'idle', startedAt: null, finishedAt: null } }));
    }, { start, end, routes });
    await context.route('https://tiles.openfreemap.org/**', route => route.fulfill({ json: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e6eddf' } }] } }));
    await context.route('**/api/journey/places?*', route => route.fulfill({ json: { places: [{ ...via, id: 'synthetic-via' }] } }));
    const requests = [], errors = [];
    await context.route('**/api/journey/routes', route => {
      const body = route.request().postDataJSON(); requests.push(body);
      assert.equal(route.request().headers().authorization, undefined);
      return route.fulfill({ json: { routes: body.via ? [{ ...routes[0], coordinates: [coordinate(body.start), coordinate(body.via), coordinate(body.end)], viaSnapDistanceM: 0, distanceM: 1800, durationS: 420 }] : routes, profile: 'driving', traffic: false } });
    });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin + '/journeys');
    const planner = page.getByRole('region', { name: 'Journey planner', exact: true });
    await planner.getByRole('radio', { name: 'Choose route 2', exact: true }).waitFor();
    assert.equal(requests.length, 0, 'Legacy saved plans still restore');
    await planner.getByRole('button', { name: 'Refresh routes', exact: true }).click();
    await planner.getByRole('radio', { name: 'Choose route 4', exact: true }).waitFor();
    assert.equal(await planner.getByRole('radio').count(), 4);
    await planner.getByRole('radio', { name: 'Choose route 4', exact: true }).check();
    await page.reload();
    await planner.getByRole('radio', { name: 'Choose route 4', exact: true }).waitFor();
    assert.ok(await planner.getByRole('radio', { name: 'Choose route 4', exact: true }).isChecked());
    assert.equal(requests.length, 1, 'All four routes and selection persist without another lookup');
    await page.waitForFunction(() => document.querySelector('[data-map-ready="true"]'));
    await page.evaluate(() => document.activeElement?.blur());
    await planner.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'four-routes-desktop.png'), fullPage: true });
    await planner.getByRole('button', { name: /Add a via place/ }).click();
    assert.ok(await planner.getByRole('searchbox', { name: 'Search via place' }).evaluate(el => el === document.activeElement));
    await planner.getByRole('button', { name: 'Remove via', exact: true }).click();
    assert.equal(requests.length, 1, 'Closing an unused via field keeps the selected route');
    assert.ok(await planner.getByRole('radio', { name: 'Choose route 4', exact: true }).isChecked());
    await planner.getByRole('button', { name: /Add a via place/ }).click();
    await planner.getByRole('searchbox', { name: 'Search via place' }).fill('Via Park');
    await planner.getByRole('button', { name: via.label, exact: true }).click();
    await planner.getByText('1.80 km', { exact: true }).waitFor();
    await page.getByRole('img', { name: 'Planned via place', exact: true }).waitFor();
    assert.deepEqual(requests.at(-1).via, { latitude: via.latitude, longitude: via.longitude });
    assert.equal(requests.at(-1).start.label, undefined, 'Only coordinates are sent upstream');
    assert.ok(await planner.getByRole('button', { name: 'Start journey', exact: true }).isDisabled(), 'Changing the path clears the previous selection');
    await planner.getByRole('radio', { name: 'Choose route 1', exact: true }).check();
    await page.reload();
    await planner.getByText('1.80 km', { exact: true }).waitFor();
    assert.ok(await planner.getByRole('radio', { name: 'Choose route 1', exact: true }).isChecked());
    assert.equal(requests.length, 2, 'Via point and selected route survive reload');
    await page.waitForFunction(() => document.querySelector('[data-map-ready="true"]'));
    await page.evaluate(() => document.activeElement?.blur());
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await planner.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'via-mobile.png'), fullPage: true });
    await planner.getByRole('button', { name: 'Remove via', exact: true }).click();
    await planner.getByRole('radio', { name: 'Choose route 4', exact: true }).waitFor();
    assert.equal(requests.at(-1).via, undefined);
    assert.equal(await page.getByRole('img', { name: 'Planned via place', exact: true }).count(), 0);
    assert.ok(await planner.getByRole('button', { name: 'Start journey', exact: true }).isDisabled());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await planner.getByRole('button', { name: /Add a via place/ }).click();
    await planner.getByRole('button', { name: 'Choose via on map', exact: true }).click();
    await page.getByRole('button', { name: 'Use map center', exact: true }).click();
    await planner.getByText('1.80 km', { exact: true }).waitFor();
    await page.getByRole('img', { name: 'Planned via place', exact: true }).waitFor();
    assert.ok(Number.isFinite(requests.at(-1).via.latitude));
    await planner.getByRole('radio', { name: 'Choose route 1', exact: true }).check();
    await planner.getByRole('button', { name: 'Start journey', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/navigation');
    await page.getByRole('region', { name: 'Journey navigation' }).getByText(/Via point/).waitFor();
    await page.getByRole('img', { name: 'Planned via place', exact: true }).waitFor();
    await page.getByRole('link', { name: 'View journey plan', exact: true }).click();
    assert.ok(await planner.getByRole('button', { name: 'Remove via', exact: true }).isDisabled());
    assert.ok(await planner.getByRole('button', { name: 'Choose via on map', exact: true }).isDisabled());
    assert.equal(await planner.getByRole('button', { name: 'Refresh routes', exact: true }).count(), 0);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ status: 'passed', origin, checks: ['Legacy plans can refresh to four choices', 'Fourth route selection and all alternatives persist', 'Unused via field preserves selection', 'Via search, marker and coordinate-only requests', 'Via selection persists and removal restores alternatives', 'Via map picking and navigation lock', 'Desktop/mobile layouts and clean browser runtime'], screenshots: output }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
