import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

// All locations and access tokens are synthetic. Fetch and process.env are
// injected; this suite does not contact providers or read real credentials.
const require = createRequire(import.meta.url);
const compile = path => ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const liveModule = { exports: {} };
new Function("exports", "module", compile("lib/live/journey.ts"))(liveModule.exports, liveModule);
const { validJourneyPoint, validPlannedRoute, pointDistanceM, distanceToRouteM, emptyJourney, advanceJourney, MAX_PLANNED_ROUTES } = liveModule.exports;
const serverSource = compile("lib/server/journey.ts");
const epoch = Date.UTC(2026, 10, 5, 12);
const degreePerMetre = 180 / Math.PI / 6_371_008.8;
const point = (east = 0, north = 0) => ({ latitude: north * degreePerMetre, longitude: east * degreePerMetre });
const coordinate = (east = 0, north = 0) => [east * degreePerMetre, north * degreePerMetre];
const start = point(), end = point(1_000);
const route = { coordinates: [coordinate(), coordinate(1_000)], distanceM: 1_000, durationS: 120, provider: "Synthetic test provider" };
const sample = (east, north, elapsed) => ({ point: point(east, north), receivedAt: epoch + elapsed });
const advance = (state, next) => advanceJourney(state, next, route, start, end);
const armed = () => ({ ...emptyJourney(), phase: "armed" });
const active = () => advance(armed(), sample(0, 0, 0));
const near = (actual, expected, tolerance = 0.01) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} was not near ${expected}`);
const viewer = "synthetic_journey_viewer_" + "x".repeat(32);

function providerRoute(overrides = {}) {
  return { distance: 1_000, duration: 120, geometry: { type: "LineString", coordinates: route.coordinates }, ...overrides };
}
function feature(index = 0) {
  return { type: "Feature", geometry: { type: "Point", coordinates: coordinate(index) }, properties: { name: `Synthetic place ${index}`, city: "Test City", country: "Test Region" } };
}
function server(provider = { code: "Ok", routes: [providerRoute()] }, env = { SMARTTRACK_VIEWER_SECRET: viewer }) {
  const calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url: String(url), init });
    const result = typeof provider === "function" ? await provider(url, init) : provider;
    return result instanceof Response ? result : Response.json(result);
  };
  const loaded = { exports: {} };
  const imports = name => name === "@/lib/live/journey" ? liveModule.exports : name === "server-only" ? {} : require(name);
  new Function("exports", "module", "require", "fetch", "process", serverSource)(loaded.exports, loaded, imports, fetcher, { env });
  return { ...loaded.exports, calls };
}
function placesRequest(query = "Test Place", token = null) {
  const url = new URL("http://localhost/api/journey/places");
  if (query !== null) url.searchParams.set("q", query);
  return new Request(url, { headers: token === null ? {} : { Authorization: `Bearer ${token}` } });
}
function routesRequest(body = { start, end }, options = {}) {
  const headers = new Headers();
  const token = options.token ?? null;
  const contentType = options.contentType === undefined ? "application/json" : options.contentType;
  if (token !== null) headers.set("Authorization", `Bearer ${token}`);
  if (contentType !== null) headers.set("Content-Type", contentType);
  if (options.contentLength) headers.set("Content-Length", options.contentLength);
  return new Request("http://localhost/api/journey/routes", {
    method: "POST", headers, body: typeof body === "string" || body instanceof Uint8Array ? body : JSON.stringify(body),
  });
}
async function failure(response, status) {
  assert.equal(response.status, status);
  assert.match(response.headers.get("cache-control"), /private.*no-store/);
  assert.match(response.headers.get("vary"), /Origin/i);
  const body = await response.json();
  assert.equal(typeof body.error, "string");
  assert.equal(body.routes, undefined); assert.equal(body.places, undefined);
}

test("journey coordinate and route validators reject malformed numeric data and oversized shapes", () => {
  assert.equal(validJourneyPoint(start), true);
  assert.equal(validJourneyPoint({ latitude: -90, longitude: 180 }), true);
  for (const value of [null, {}, [0, 0], { latitude: "0", longitude: 0 }, { latitude: NaN, longitude: 0 }, { latitude: 91, longitude: 0 }, { latitude: 0, longitude: -181 }]) assert.equal(validJourneyPoint(value), false);
  assert.equal(validPlannedRoute(route), true);
  for (const patch of [
    { distanceM: 0 }, { distanceM: 20_000_001 }, { durationS: -1 }, { durationS: Infinity }, { provider: null },
    { coordinates: [] }, { coordinates: [coordinate()] }, { coordinates: [[0, 0, 0], [1, 1]] },
    { coordinates: [[0, 0], [181, 0]] }, { coordinates: [[0, 0], [0, NaN]] },
    { coordinates: Array.from({ length: 20_001 }, (_, i) => coordinate(i)) },
    { startSnapDistanceM: -1 }, { endSnapDistanceM: 501 },
  ]) assert.equal(validPlannedRoute({ ...route, ...patch }), false, JSON.stringify(patch).slice(0, 100));
});

test("route distance is clamped to segment ends and uses the nearest segment", () => {
  near(distanceToRouteM(point(500, 100), route.coordinates), 100);
  near(distanceToRouteM(point(-150), route.coordinates), 150);
  near(distanceToRouteM(point(1_150), route.coordinates), 150);
  const corner = [coordinate(), coordinate(1_000), coordinate(1_000, 1_000)];
  near(distanceToRouteM(point(1_050, 500), corner), 50);
  near(distanceToRouteM(point(500, 100), [coordinate(), coordinate(), coordinate(1_000)]), 100);
});

test("spherical route geometry takes the short path across the date line", () => {
  const a = { latitude: 0, longitude: 179.99 }, b = { latitude: 0, longitude: -179.99 };
  near(pointDistanceM(a, b), 2_223.9016, 0.01);
  const line = [[a.longitude, a.latitude], [b.longitude, b.latitude]];
  near(distanceToRouteM({ latitude: 0, longitude: 180 }, line), 0);
  near(distanceToRouteM({ latitude: 100 * degreePerMetre, longitude: -180 }, line), 100);
  assert.ok(distanceToRouteM({ latitude: 0, longitude: 0 }, line) > 19_000_000);
});

test("a curved great-circle segment remains accurate at high latitudes", () => {
  const latitude = Math.atan(Math.tan(80 * Math.PI / 180) / Math.cos(45 * Math.PI / 180)) * 180 / Math.PI;
  near(distanceToRouteM({ latitude, longitude: 0 }, [[-45, 80], [45, 80]]), 0);
  assert.ok(distanceToRouteM({ latitude: 80, longitude: 0 }, [[-45, 80], [45, 80]]) > 300_000);
});

test("arming waits for the origin area and records the actual qualifying GPS receipt", () => {
  let state = advance(armed(), sample(31, 0, 100));
  assert.equal(state.phase, "armed"); assert.equal(state.startedAt, null);
  state = advance(state, sample(29, 0, 200));
  assert.equal(state.phase, "active"); assert.equal(state.startedAt, epoch + 200);
  assert.equal(state.deviation, "on-route");
  assert.equal(advance(emptyJourney(), sample(0, 0, 300)).phase, "idle");
});

test("GPS loss clears an armed journey's last distance instead of preserving a current-looking value", () => {
  const observed = advance(armed(), sample(400, 100, 100));
  near(observed.distanceM, 100);
  const waiting = advance(observed, null);
  assert.equal(waiting.distanceM, null); assert.equal(waiting.deviation, "waiting");
  assert.equal(waiting.startedAt, null); assert.equal(waiting.lastGpsAt, observed.lastGpsAt);
});

test("duplicate, out-of-order and invalid observations cannot advance counters or timestamps", () => {
  const state = advance(active(), sample(500, 80, 1_000));
  for (const value of [sample(500, 80, 1_000), sample(500, 80, 999), { point: { latitude: 100, longitude: 0 }, receivedAt: epoch + 2_000 }, { point: start, receivedAt: -1 }, { point: start, receivedAt: NaN }, { point: start, receivedAt: Infinity }]) assert.equal(advance(state, value), state);
});

test("deviation requires distinct samples over three seconds and recovery uses a narrower corridor", () => {
  let state = active();
  for (const at of [1_000, 2_000, 3_000]) state = advance(state, sample(500, 61, at));
  assert.notEqual(state.deviation, "off-route");
  state = advance(state, sample(500, 61, 4_000));
  assert.equal(state.deviation, "off-route"); assert.equal(state.notice.kind, "off-route");
  const notice = state.notice;
  state = advance(state, sample(500, 70, 5_000)); assert.equal(state.notice, notice);
  state = advance(state, sample(500, 50, 6_000)); assert.equal(state.deviation, "off-route");
  state = advance(state, sample(500, 39, 7_000)); assert.equal(state.deviation, "off-route");
  state = advance(state, sample(500, 39, 8_000)); assert.equal(state.deviation, "on-route");
  for (const at of [9_000, 10_000, 11_000, 12_000]) state = advance(state, sample(500, 70, at));
  assert.equal(state.deviation, "off-route"); assert.notEqual(state.notice.id, notice.id);
});

test("a corridor interruption and a long GPS gap reset sustained-deviation evidence", () => {
  let state = active();
  for (const at of [1_000, 2_000]) state = advance(state, sample(500, 80, at));
  state = advance(state, sample(500, 50, 2_500));
  assert.equal(state.outsideCount, 0); assert.equal(state.outsideSince, null);
  for (const at of [3_000, 4_000]) state = advance(state, sample(500, 80, at));
  state = advance(state, sample(500, 80, 14_001));
  assert.equal(state.outsideCount, 1); assert.equal(state.outsideSince, epoch + 14_001);
  assert.notEqual(state.deviation, "off-route"); assert.equal(state.notice, null);
  state = advance(state, null);
  assert.equal(state.outsideCount, 0); assert.equal(state.distanceM, null);
});

test("arrival requires two distinct destination observations and produces one terminal receipt", () => {
  let state = advance(active(), sample(1_000, 29, 1_000));
  assert.equal(state.arrivalCount, 1); assert.equal(state.phase, "active");
  assert.equal(advance(state, sample(1_000, 29, 1_000)), state);
  state = advance(state, sample(1_000, 29, 2_000));
  assert.equal(state.phase, "finished"); assert.equal(state.finishedAt, epoch + 2_000);
  assert.equal(state.notice.kind, "arrival"); assert.equal(state.notice.receivedAt, epoch + 2_000);
  assert.equal(advance(state, sample(1_000, 29, 3_000)), state);
  assert.equal(advance(state, null), state);
});

test("leaving the destination area, losing GPS, or a long receipt gap breaks arrival confirmation", () => {
  for (const interruption of [sample(1_000, 31, 1_500), null]) {
    let state = advance(active(), sample(1_000, 0, 1_000));
    state = advance(state, interruption);
    state = advance(state, sample(1_000, 0, 2_000));
    assert.equal(state.phase, "active"); assert.equal(state.arrivalCount, 1);
  }
  let state = advance(active(), sample(1_000, 0, 1_000));
  state = advance(state, sample(1_000, 0, 11_001));
  assert.equal(state.phase, "active"); assert.equal(state.arrivalCount, 1);
});

test("journey advancement leaves input state, route and coordinates unchanged", () => {
  const state = active(), input = sample(500, 80, 1_000);
  const before = structuredClone({ state, input, route });
  Object.freeze(state); Object.freeze(input.point); Object.freeze(input);
  advance(state, input);
  assert.deepEqual({ state, input, route }, before);
});

test("public planning needs neither viewer configuration nor a private device link", async () => {
  const app = server(url => String(url).includes("photon.") ? { features: [feature()] } : { code: "Ok", routes: [providerRoute()] }, {});
  const places = await app.placesGET(placesRequest());
  const routes = await app.routesPOST(routesRequest());
  assert.equal(places.status, 200); assert.equal(routes.status, 200);
  assert.equal((await places.json()).places.length, 1);
  assert.equal((await routes.json()).routes.length, 1);
  assert.equal(app.calls.length, 2);
  for (const call of app.calls) assert.equal(new Headers(call.init.headers).has("Authorization"), false);
});

test("old viewer credentials do not affect planning or reach public providers", async () => {
  const app = server(url => String(url).includes("photon.") ? { features: [] } : { code: "Ok", routes: [providerRoute()] });
  for (const token of [viewer, "expired_viewer_" + "x".repeat(32), "short"]) {
    assert.equal((await app.placesGET(placesRequest("Test Place", token))).status, 200);
    assert.equal((await app.routesPOST(routesRequest({ start, end }, { token }))).status, 200);
  }
  for (const call of app.calls) assert.equal(new Headers(call.init.headers).has("Authorization"), false);
});

test("foreign browser origins are rejected before planning providers are contacted", async () => {
  const app = server();
  for (const input of [{ Origin: "https://untrusted.invalid" }, { Origin: "null" }, { "Sec-Fetch-Site": "cross-site" }, { "Sec-Fetch-Site": "same-site" }]) {
    const places = placesRequest(), routes = routesRequest();
    for (const [key, value] of Object.entries(input)) { places.headers.set(key, value); routes.headers.set(key, value); }
    await failure(await app.placesGET(places), 403);
    await failure(await app.routesPOST(routes), 403);
  }
  assert.equal(app.calls.length, 0);
});

test("same-origin browser planning remains usable without any device credentials", async () => {
  const app = server(url => String(url).includes("photon.") ? { features: [] } : { code: "Ok", routes: [providerRoute()] });
  const places = placesRequest(), routes = routesRequest();
  for (const request of [places, routes]) { request.headers.set("Origin", "http://localhost"); request.headers.set("Sec-Fetch-Site", "same-origin"); }
  assert.equal((await app.placesGET(places)).status, 200);
  assert.equal((await app.routesPOST(routes)).status, 200);
});

test("planning checks the browser's incoming Host when Next normalizes the internal hostname", async () => {
  const app = server();
  const request = routesRequest();
  request.headers.set("Host", "127.0.0.1:3104");
  request.headers.set("Origin", "http://127.0.0.1:3104");
  request.headers.set("Sec-Fetch-Site", "same-origin");
  assert.equal((await app.routesPOST(request)).status, 200);
  const foreign = routesRequest();
  foreign.headers.set("Host", "127.0.0.1:3104");
  foreign.headers.set("Origin", "http://localhost");
  await failure(await app.routesPOST(foreign), 403);
});

test("place queries are trimmed and bounded before the provider is called", async () => {
  const app = server({ features: [] });
  for (const query of [null, "", "ab", "a".repeat(121), "a\u0000bc", "ab\nc"]) await failure(await app.placesGET(placesRequest(query)), 400);
  assert.equal(app.calls.length, 0);
  assert.equal((await app.placesGET(placesRequest("  Test Place  "))).status, 200);
  const url = new URL(app.calls[0].url);
  assert.equal(url.origin, "https://photon.komoot.io"); assert.equal(url.searchParams.get("q"), "Test Place");
  assert.equal(url.searchParams.get("limit"), "5"); assert.equal(app.calls[0].init.redirect, "error");
  assert.equal(new Headers(app.calls[0].init.headers).has("Authorization"), false);
});

test("place results require Point geometry and valid coordinates without fabricating replacement places", async () => {
  const wrongType = feature(0); wrongType.geometry.type = "LineString";
  const wrongCoordinate = feature(1); wrongCoordinate.geometry.coordinates = [181, 0];
  const unnamed = feature(2); unnamed.properties = {};
  const valid = feature(3); valid.properties = { name: "Same", city: "Same", country: "Synthetic Region" };
  const app = server({ features: [wrongType, wrongCoordinate, unnamed, valid] });
  const result = await (await app.placesGET(placesRequest())).json();
  assert.equal(result.places.length, 1); assert.equal(result.places[0].label, "Same, Synthetic Region");
  assert.deepEqual({ latitude: result.places[0].latitude, longitude: result.places[0].longitude }, point(3));
  const many = server({ features: Array.from({ length: 12 }, (_, i) => feature(i)) });
  assert.equal((await (await many.placesGET(placesRequest())).json()).places.length, 5);
});

test("route request coordinates, content type and byte limits are checked without trusting content-length", async () => {
  const app = server();
  for (const body of [null, [], {}, { start }, { start: { latitude: "0", longitude: 0 }, end }, { start: point(), end: { latitude: 91, longitude: 0 } }, { start, end: start }]) await failure(await app.routesPOST(routesRequest(body)), 400);
  await failure(await app.routesPOST(routesRequest("not JSON")), 400);
  await failure(await app.routesPOST(routesRequest(new Uint8Array([123, 128, 125]))), 400);
  await failure(await app.routesPOST(routesRequest({ start, end, padding: "x".repeat(2_049) }, { contentLength: "1" })), 400);
  await failure(await app.routesPOST(routesRequest({ start, end, padding: "\u00e9".repeat(1_025) })), 400);
  await failure(await app.routesPOST(routesRequest({ start, end }, { contentType: "text/plain" })), 415);
  await failure(await app.routesPOST(routesRequest({ start, end }, { contentType: null })), 415);
  assert.equal(app.calls.length, 0);
});

test("routing sends bounded numeric coordinates only to the fixed provider and preserves its one real route", async () => {
  const supplied = providerRoute();
  const app = server({ code: "Ok", routes: [supplied], traffic: true });
  const result = await app.routesPOST(routesRequest({ start, end, provider: "https://untrusted.invalid/" }, { contentType: "application/json; charset=utf-8" }));
  assert.equal(result.status, 200); assert.match(result.headers.get("cache-control"), /no-store/);
  const body = await result.json();
  assert.equal(body.routes.length, 1); assert.equal(body.routes[0].distanceM, supplied.distance); assert.equal(body.routes[0].durationS, supplied.duration);
  assert.deepEqual(body.routes[0].coordinates, supplied.geometry.coordinates);
  assert.equal(body.profile, "driving"); assert.equal(body.traffic, false);
  const url = new URL(app.calls[0].url);
  assert.equal(url.origin, "https://router.project-osrm.org");
  assert.equal(url.pathname, `/route/v1/driving/0.000000,0.000000;${end.longitude.toFixed(6)},0.000000`);
  assert.equal(url.searchParams.get("alternatives"), "3"); assert.equal(url.searchParams.get("geometries"), "geojson");
  assert.equal(app.calls[0].init.redirect, "error"); assert.equal(new Headers(app.calls[0].init.headers).has("Authorization"), false);
  assert.ok(app.calls[0].init.signal instanceof AbortSignal);
});

test("routing keeps four distinct usable routes, including alternatives beyond the old cap", async () => {
  const invalid = providerRoute({ geometry: { type: "Point", coordinates: route.coordinates } });
  const app = server({ code: "Ok", routes: [invalid, providerRoute()] });
  const body = await (await app.routesPOST(routesRequest())).json();
  assert.equal(body.routes.length, 1);
  const distinct = Array.from({ length: 5 }, (_, index) => providerRoute({ distance: 1100 + index * 100, geometry: { type: "LineString", coordinates: [coordinate(), coordinate(500, 100 + index * 100), coordinate(1_000)] } }));
  const many = server({ code: "Ok", routes: [invalid, distinct[0], distinct[0], ...distinct.slice(1)] });
  const result = await (await many.routesPOST(routesRequest())).json();
  assert.equal(result.routes.length, MAX_PLANNED_ROUTES);
  assert.equal(result.routes.length, 4);
  assert.deepEqual(result.routes.map(route => route.distanceM), [1100, 1200, 1300, 1400]);
});

test("via routing sends start, via, and destination in order and preserves the real road geometry", async () => {
  const via = { ...point(400, 900), label: "Synthetic via place" };
  const supplied = providerRoute({ geometry: { type: "LineString", coordinates: [coordinate(), coordinate(400, 900), coordinate(1_000)] } });
  const app = server({ code: "Ok", routes: [supplied] });
  const response = await app.routesPOST(routesRequest({ start, via, end }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.routes[0].coordinates, supplied.geometry.coordinates);
  near(result.routes[0].viaSnapDistanceM, 0);
  const url = new URL(app.calls[0].url);
  assert.equal(url.pathname, `/route/v1/driving/0.000000,0.000000;${via.longitude.toFixed(6)},${via.latitude.toFixed(6)};${end.longitude.toFixed(6)},0.000000`);
  assert.equal(url.searchParams.get("alternatives"), "3");
  assert.equal(url.searchParams.get("continue_straight"), "true");
  assert.equal(url.toString().includes("Synthetic"), false);
});

test("invalid or redundant via points are rejected before contacting the provider", async () => {
  const app = server();
  for (const via of [{}, "road", [], { latitude: 91, longitude: 0 }, { latitude: 0, longitude: "0" }, start, end]) {
    await failure(await app.routesPOST(routesRequest({ start, end, via })), 400);
  }
  assert.equal(app.calls.length, 0);
  assert.equal((await app.routesPOST(routesRequest({ start, end, via: null }))).status, 200);
});

test("a route that misses the requested via place is never offered as a valid option", async () => {
  await failure(await server().routesPOST(routesRequest({ start, end, via: point(500, 1500) })), 422);
  const response = await server().routesPOST(routesRequest({ start, end, via: point(500, 250) }));
  assert.equal(response.status, 200);
  near((await response.json()).routes[0].viaSnapDistanceM, 250);
  assert.equal(validPlannedRoute({ ...route, viaSnapDistanceM: 501 }), false);
  assert.equal(validPlannedRoute({ ...route, viaSnapDistanceM: -1 }), false);
});

test("malformed provider routes never become straight-line or synthetic alternatives", async () => {
  const bad = [
    {}, { code: "NoRoute", routes: [providerRoute()] }, { code: "Ok", routes: [] },
    { code: "Ok", routes: [providerRoute({ geometry: { type: "Polygon", coordinates: route.coordinates } })] },
    { code: "Ok", routes: [providerRoute({ geometry: { type: "LineString", coordinates: [[0, 0], [0, 91]] } })] },
    { code: "Ok", routes: [providerRoute({ distance: -1 })] },
    { code: "Ok", routes: [providerRoute({ duration: "120" })] },
  ];
  for (const provider of bad) await failure(await server(provider).routesPOST(routesRequest()), 422);
});

test("route endpoints must remain near the requested points and provider snapping is disclosed", async () => {
  const unrelated = providerRoute({ geometry: { type: "LineString", coordinates: [coordinate(2_000), coordinate(3_000)] } });
  await failure(await server({ code: "Ok", routes: [unrelated] }).routesPOST(routesRequest()), 422);
  const snapped = providerRoute({ distance: 1_100, geometry: { type: "LineString", coordinates: [coordinate(200), coordinate(1_300)] } });
  const body = await (await server({ code: "Ok", routes: [snapped] }).routesPOST(routesRequest())).json();
  assert.equal(body.routes.length, 1);
  near(body.routes[0].startSnapDistanceM, 200); near(body.routes[0].endSnapDistanceM, 300);
});

test("a stationary provider geometry cannot claim a positive-distance road journey", async () => {
  const stationary = [coordinate(200), coordinate(200)];
  assert.equal(validPlannedRoute({ ...route, coordinates: stationary }), false);
  assert.equal(validPlannedRoute({ ...route, coordinates: [coordinate(), coordinate(), coordinate(1_000)] }), true);
  const supplied = providerRoute({ geometry: { type: "LineString", coordinates: stationary } });
  await failure(await server({ code: "Ok", routes: [supplied] }).routesPOST(routesRequest({ start, end: point(400) })), 422);
});

test("provider failures and oversized or invalid JSON fail closed at both planning endpoints", async () => {
  for (const provider of [() => { throw new Error("synthetic network failure"); }, () => new Response("unavailable", { status: 503 }), () => new Response("not JSON"), () => new Response(new Uint8Array([123, 128, 125]))]) {
    const app = server(provider);
    await failure(await app.routesPOST(routesRequest()), 503);
    await failure(await app.placesGET(placesRequest()), 503);
  }
  await failure(await server(() => new Response(" ".repeat(3_000_001))).routesPOST(routesRequest()), 503);
  await failure(await server(() => new Response(" ".repeat(256_001))).placesGET(placesRequest()), 503);
});

test("dateline endpoints are accepted as a short provider-supplied road route", async () => {
  const a = { latitude: 0, longitude: 179.99 }, b = { latitude: 0, longitude: -179.99 };
  const supplied = providerRoute({ distance: 2_224, duration: 180, geometry: { type: "LineString", coordinates: [[179.99, 0], [-179.99, 0]] } });
  const result = await server({ code: "Ok", routes: [supplied] }).routesPOST(routesRequest({ start: a, end: b }));
  assert.equal(result.status, 200); assert.equal((await result.json()).routes.length, 1);
});
