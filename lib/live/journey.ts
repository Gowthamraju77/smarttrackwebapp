export type JourneyPoint = { latitude: number; longitude: number; label?: string };
export type Place = JourneyPoint & { id: string; label: string };
export type PlannedRoute = { coordinates: [number, number][]; distanceM: number; durationS: number; provider: string; startSnapDistanceM?: number; endSnapDistanceM?: number; viaSnapDistanceM?: number };
// The public OSRM server accepts three alternatives, in addition to its primary route.
export const MAX_ROUTE_ALTERNATIVES = 3;
export const MAX_PLANNED_ROUTES = MAX_ROUTE_ALTERNATIVES + 1;
export type JourneyPhase = "idle" | "armed" | "active" | "finished";
export type JourneyNotice = { id: string; title: string; body: string; receivedAt: number; kind: "off-route" | "arrival" };
export type JourneyState = {
  phase: JourneyPhase; startedAt: number | null; finishedAt: number | null; lastGpsAt: number | null;
  deviation: "waiting" | "on-route" | "off-route"; distanceM: number | null;
  outsideSince: number | null; outsideCount: number; insideCount: number;
  arrivalCount: number; notice: JourneyNotice | null;
};
export const ROUTE_CORRIDOR_M = 60;
export const ARRIVAL_RADIUS_M = 30;
const R = 6_371_008.8;
const radians = Math.PI / 180;
export function validJourneyPoint(value: unknown): value is JourneyPoint {
  if (!value || typeof value !== "object") return false;
  const p = value as JourneyPoint;
  return Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90 && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180
    && (p.label === undefined || typeof p.label === "string" && p.label.length <= 700);
}
export function validPlannedRoute(value: unknown): value is PlannedRoute {
  if (!value || typeof value !== "object") return false;
  const route = value as PlannedRoute;
  return Number.isFinite(route.distanceM) && route.distanceM > 0 && route.distanceM <= 20_000_000
    && Number.isFinite(route.durationS) && route.durationS > 0 && route.durationS <= 2_000_000
    && typeof route.provider === "string" && route.provider.length <= 100
    && [route.startSnapDistanceM, route.endSnapDistanceM, route.viaSnapDistanceM].every(value => value === undefined || (Number.isFinite(value) && value >= 0 && value <= 500))
    && Array.isArray(route.coordinates) && route.coordinates.length >= 2 && route.coordinates.length <= 20_000
    && route.coordinates.every(p => Array.isArray(p) && p.length === 2 && validJourneyPoint({ longitude: p[0], latitude: p[1] }))
    && route.coordinates.some((p, index) => index > 0 && pointDistanceM({ longitude: p[0], latitude: p[1] }, { longitude: route.coordinates[index - 1][0], latitude: route.coordinates[index - 1][1] }) > 0.1);
}
export function pointDistanceM(a: JourneyPoint, b: JourneyPoint) {
  const dlat = (b.latitude - a.latitude) * radians, dlon = (b.longitude - a.longitude) * radians;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(dlon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
function bearing(a: JourneyPoint, b: JourneyPoint) {
  const delta = (b.longitude - a.longitude) * radians;
  return Math.atan2(Math.sin(delta) * Math.cos(b.latitude * radians), Math.cos(a.latitude * radians) * Math.sin(b.latitude * radians)
    - Math.sin(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.cos(delta));
}
/** Spherical cross-track distance, clamped to each finite segment; date-line safe. */
export function distanceToRouteM(point: JourneyPoint, coordinates: readonly [number, number][]) {
  let nearest = Infinity;
  for (let i = 1; i < coordinates.length; i++) {
    const a = { longitude: coordinates[i - 1][0], latitude: coordinates[i - 1][1] };
    const b = { longitude: coordinates[i][0], latitude: coordinates[i][1] };
    const length = pointDistanceM(a, b), fromStart = pointDistanceM(a, point);
    if (length < 0.01) { nearest = Math.min(nearest, fromStart); continue; }
    const delta = fromStart / R, angle = bearing(a, point) - bearing(a, b);
    const along = Math.atan2(Math.sin(delta) * Math.cos(angle), Math.cos(delta)) * R;
    const cross = Math.abs(Math.asin(Math.max(-1, Math.min(1, Math.sin(delta) * Math.sin(angle))))) * R;
    nearest = Math.min(nearest, along < 0 ? fromStart : along > length ? pointDistanceM(b, point) : cross);
  }
  return nearest;
}
export function emptyJourney(): JourneyState {
  return { phase: "idle", startedAt: null, finishedAt: null, lastGpsAt: null, deviation: "waiting", distanceM: null,
    outsideSince: null, outsideCount: 0, insideCount: 0, arrivalCount: 0, notice: null };
}
export function advanceJourney(state: JourneyState, sample: { point: JourneyPoint; receivedAt: number } | null, route: PlannedRoute, start: JourneyPoint, end: JourneyPoint): JourneyState {
  if (state.phase !== "armed" && state.phase !== "active") return state;
  if (!sample) return state.deviation === "waiting" && state.distanceM === null && state.outsideCount === 0 && state.insideCount === 0 && state.arrivalCount === 0 ? state
    : { ...state, deviation: "waiting", distanceM: null, outsideSince: null, outsideCount: 0, insideCount: 0, arrivalCount: 0 };
  if (!validJourneyPoint(sample.point) || !Number.isFinite(sample.receivedAt) || sample.receivedAt < 0
    || (state.lastGpsAt !== null && sample.receivedAt <= state.lastGpsAt)) return state;
  const distance = distanceToRouteM(sample.point, route.coordinates);
  let next = { ...state, lastGpsAt: sample.receivedAt, distanceM: distance };
  if (state.phase === "armed") {
    if (pointDistanceM(sample.point, start) <= ARRIVAL_RADIUS_M) next = { ...next, phase: "active", startedAt: sample.receivedAt, deviation: "on-route" };
    return next;
  }
  if (state.lastGpsAt !== null && sample.receivedAt - state.lastGpsAt > 10_000) {
    next = { ...next, outsideSince: null, outsideCount: 0, insideCount: 0, arrivalCount: 0, deviation: "waiting" };
  }
  const nearEnd = pointDistanceM(sample.point, end) <= ARRIVAL_RADIUS_M;
  next.arrivalCount = nearEnd ? next.arrivalCount + 1 : 0;
  if (next.arrivalCount >= 2 && state.startedAt !== null && sample.receivedAt >= state.startedAt) {
    return { ...next, phase: "finished", finishedAt: sample.receivedAt, deviation: "on-route",
      notice: { id: `arrival-${sample.receivedAt}`, title: "Destination reached", body: "Two fresh GPS observations reached your destination area.", receivedAt: sample.receivedAt, kind: "arrival" } };
  }
  if (distance > ROUTE_CORRIDOR_M) {
    next.outsideSince ??= sample.receivedAt;
    next.outsideCount += 1; next.insideCount = 0;
    if (next.outsideCount >= 3 && sample.receivedAt - next.outsideSince >= 3000) {
      if (next.deviation !== "off-route") next.notice = { id: `off-route-${sample.receivedAt}`, title: "Device outside your route", body: `Fresh GPS stayed more than ${ROUTE_CORRIDOR_M} m from the selected path.`, receivedAt: sample.receivedAt, kind: "off-route" };
      next.deviation = "off-route";
    }
  } else if (distance <= ROUTE_CORRIDOR_M * 2 / 3) {
    next.outsideSince = null; next.outsideCount = 0; next.insideCount += 1;
    if (next.deviation !== "off-route" || next.insideCount >= 2) next.deviation = "on-route";
  } else {
    next.outsideSince = null; next.outsideCount = 0; next.insideCount = 0;
    if (next.deviation !== "off-route") next.deviation = "on-route";
  }
  return next;
}
