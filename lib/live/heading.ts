import type { LiveSnapshot } from "./telemetry";
import { currentClimatePoint } from "./climate";

/** GPS course over ground describes travel direction, not the stationary device's orientation. */
export function currentHeading(snapshot: LiveSnapshot | null, connected: boolean, now = Date.now()): number | null {
  if (!currentClimatePoint(snapshot, connected, now)) return null;
  const gps = snapshot!.gps;
  return typeof gps.courseDeg === "number" && Number.isFinite(gps.courseDeg) && gps.courseDeg >= 0 && gps.courseDeg < 360
    && typeof gps.speedMps === "number" && Number.isFinite(gps.speedMps) && gps.speedMps >= 0.5 ? gps.courseDeg : null;
}
export function compassLabel(degrees: number) { return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(degrees / 45) % 8]; }
