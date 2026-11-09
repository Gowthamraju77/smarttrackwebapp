import { distanceToRouteM, MAX_PLANNED_ROUTES, MAX_ROUTE_ALTERNATIVES, pointDistanceM, validJourneyPoint, validPlannedRoute, type Place, type PlannedRoute } from "@/lib/live/journey";

const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Origin, Sec-Fetch-Site" };
const reply = (status: number, error: string) => Response.json({ error }, { status, headers });
/** Public map lookup only: no device feed, stored journeys or credentials are accessed. */
function checkPlanningOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin"), site = request.headers.get("sec-fetch-site");
  const url = new URL(request.url);
  // Next may normalize its internal URL to localhost; browsers address the incoming Host.
  const expectedOrigin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if ((origin !== null && origin !== expectedOrigin)
    || (site !== null && site !== "same-origin" && site !== "none")) {
    return reply(403, "Open Journey in SmartTrack to plan this route.");
  }
  return null;
}
async function boundedJson(response: Response, limit: number): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error("Provider unavailable");
  const reader = response.body.getReader(), decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0, text = "";
  try { for (;;) { const { value, done } = await reader.read(); if (done) break; bytes += value.byteLength;
    if (bytes > limit) { await reader.cancel(); throw new Error("Oversized response"); } text += decoder.decode(value, { stream: true }); }
    return JSON.parse(text + decoder.decode());
  } finally { reader.releaseLock(); }
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export async function placesGET(request: Request) {
  const denied = checkPlanningOrigin(request); if (denied) return denied;
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query || query.length < 3 || query.length > 120 || /[\x00-\x1f]/.test(query)) return reply(400, "Enter a place name with 3 to 120 characters.");
  try {
    const url = new URL("https://photon.komoot.io/api/"); url.searchParams.set("q", query); url.searchParams.set("limit", "5");
    const raw = await boundedJson(await fetch(url, { headers: { Accept: "application/json", "User-Agent": "SmartTrack/1.0 (https://smarttrack-web.vercel.app)" }, signal: AbortSignal.timeout(9000), redirect: "error", cache: "no-store" }), 256_000);
    if (!object(raw) || !Array.isArray(raw.features)) throw new Error("Invalid places");
    const places: Place[] = [];
    for (const feature of raw.features.slice(0, 5)) {
      if (!object(feature) || !object(feature.geometry) || feature.geometry.type !== "Point" || !Array.isArray(feature.geometry.coordinates) || !object(feature.properties)) continue;
      const [longitude, latitude] = feature.geometry.coordinates;
      const point = { longitude, latitude }; if (!validJourneyPoint(point)) continue;
      const names = [feature.properties.name, feature.properties.city, feature.properties.state, feature.properties.country]
        .filter((value): value is string => typeof value === "string" && value.length > 0).map(value => value.slice(0, 160));
      if (!names.length) continue;
      places.push({ ...point, id: `place-${places.length}`, label: [...new Set(names)].join(", ") });
    }
    return Response.json({ places, provider: "Photon / OpenStreetMap" }, { headers });
  } catch { return reply(503, "Place search is unavailable right now. You can still choose points on the map."); }
}

export async function routesPOST(request: Request) {
  const denied = checkPlanningOrigin(request); if (denied) return denied;
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json") return reply(415, "Send start and finish as JSON.");
  let body: unknown;
  try {
    const text = await boundedJson(new Response(request.body), 2048); body = text;
  } catch { return reply(400, "Start and finish points are invalid or too large."); }
  if (!object(body) || !validJourneyPoint(body.start) || !validJourneyPoint(body.end)) return reply(400, "Choose valid start and finish points.");
  if (body.start.latitude === body.end.latitude && body.start.longitude === body.end.longitude) return reply(400, "Choose different start and finish points.");
  const via = body.via ?? null;
  if (via !== null && (!validJourneyPoint(via) || pointDistanceM(body.start, via) < 1 || pointDistanceM(body.end, via) < 1)) return reply(400, "Choose a valid via place different from your start and destination.");
  try {
    const points = via ? [body.start, via, body.end] : [body.start, body.end];
    const coords = points.map(p => `${p.longitude.toFixed(6)},${p.latitude.toFixed(6)}`).join(";");
    const url = new URL(`https://router.project-osrm.org/route/v1/driving/${coords}`);
    url.search = new URLSearchParams({ alternatives: String(MAX_ROUTE_ALTERNATIVES), overview: "full", geometries: "geojson", steps: "false", ...(via ? { continue_straight: "true" } : {}) }).toString();
    const raw = await boundedJson(await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(11000), cache: "no-store", redirect: "error" }), 3_000_000);
    if (!object(raw) || raw.code !== "Ok" || !Array.isArray(raw.routes)) return reply(422, "No road route was found between these points. Choose points near accessible roads.");
    const routes: PlannedRoute[] = [];
    const seen = new Set<string>();
    for (const candidate of raw.routes) {
      if (routes.length === MAX_PLANNED_ROUTES) break;
      if (!object(candidate) || !object(candidate.geometry) || candidate.geometry.type !== "LineString") continue;
      const route = { coordinates: candidate.geometry.coordinates, distanceM: candidate.distance, durationS: candidate.duration, provider: "OSRM / OpenStreetMap" };
      if (validPlannedRoute(route)) {
        const first = route.coordinates[0], last = route.coordinates[route.coordinates.length - 1];
        const startSnapDistanceM = pointDistanceM(body.start, { longitude: first[0], latitude: first[1] });
        const endSnapDistanceM = pointDistanceM(body.end, { longitude: last[0], latitude: last[1] });
        const viaSnapDistanceM = via ? distanceToRouteM(via, route.coordinates) : undefined;
        const key = JSON.stringify(route.coordinates);
        if (startSnapDistanceM <= 500 && endSnapDistanceM <= 500 && (viaSnapDistanceM === undefined || viaSnapDistanceM <= 500) && !seen.has(key)) {
          seen.add(key);
          routes.push({ ...route, startSnapDistanceM, endSnapDistanceM, ...(viaSnapDistanceM === undefined ? {} : { viaSnapDistanceM }) });
        }
      }
    }
    if (!routes.length) return reply(422, "The routing service returned no usable routes.");
    return Response.json({ routes, profile: "driving", traffic: false }, { headers });
  } catch { return reply(503, "Road routing is unavailable right now. Please try again."); }
}
