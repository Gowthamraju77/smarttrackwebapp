/* Real public providers, deliberately supplied public Berlin coordinates, no device secrets. */
const assert = require("node:assert/strict");
const origin = new URL(process.env.BASE_URL || "http://127.0.0.1:3104").origin;
const points = { start: { latitude: 52.52, longitude: 13.405 }, end: { latitude: 52.52, longitude: 13.415 } };
async function request(path, init = {}) {
  return fetch(origin + path, { ...init, headers: { Origin: origin, "Sec-Fetch-Site": "same-origin", ...init.headers }, signal: AbortSignal.timeout(20000) });
}
(async () => {
  const placeResponse = await request("/api/journey/places?q=Alexanderplatz%20Berlin");
  assert.equal(placeResponse.status, 200, "Online place search must work without a viewer token");
  const places = await placeResponse.json();
  assert.ok(places.places.length > 0 && places.places.length <= 5);
  const routeResponse = await request("/api/journey/routes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(points) });
  assert.equal(routeResponse.status, 200, "Selected points must return roads without a viewer token");
  const routes = await routeResponse.json();
  assert.ok(routes.routes.length > 0 && routes.routes.length <= 4);
  for (const route of routes.routes) assert.ok(route.coordinates.length > 1 && route.distanceM > 0 && route.durationS > 0);
  assert.equal(routes.traffic, false);
  const privateFeed = await request("/api/live");
  const privateStatus = privateFeed.status;
  await privateFeed.body?.cancel();
  assert.ok([401, 503].includes(privateStatus), "Private device data must remain protected");
  const foreign = await request("/api/journey/routes", { method: "POST", headers: { Origin: "https://untrusted.invalid", "Sec-Fetch-Site": "cross-site", "Content-Type": "application/json" }, body: JSON.stringify(points) });
  assert.equal(foreign.status, 403);
  await foreign.body?.cancel();
  console.log(JSON.stringify({ status: "passed", origin, checks: ["Anonymous real place search", "Anonymous real road routes with distance and ETA", "Private device feed still protected", "Foreign browser origin rejected"], places: places.places.length, routes: routes.routes.length, privateFeedStatus: privateStatus }, null, 2));
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
