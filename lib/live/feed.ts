import type { LiveSnapshot } from "./telemetry";

export type FeedPoint = { latitude: number; longitude: number; receivedAt: number; recordedAt: string | null };
export type LiveFeed = {
  version: 1;
  source: "esp32-serial" | "esp32-infoesp";
  generatedAt: number;
  startedAt: number;
  receivedAt: number | null;
  serial: { port: string; baudRate: number; connected: boolean; error: string | null };
  live: LiveSnapshot;
  capturedSnapshot: LiveSnapshot | null;
  trajectory: FeedPoint[];
};

const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const nullableNumber = (value: unknown) => value === null || finite(value);
const timestamp = (value: unknown) => finite(value) && value >= 0 && value <= 8_640_000_000_000_000;
const nullableTimestamp = (value: unknown) => value === null || timestamp(value);

function validHardware(value: unknown): boolean {
  if (!object(value) || Object.keys(value).length > 7) return false;
  return Object.entries(value).every(([kind, report]) => ["display", "modem", "imu", "wifi", "system", "firmware", "gpsReceiver"].includes(kind)
    && object(report) && timestamp(report.receivedAt) && object(report.values) && Object.keys(report.values).length <= 32
    && Object.entries(report.values).every(([key, field]) => key.length <= 48 && (typeof field === "boolean"
      || (finite(field) && Math.abs(field) <= 1e12) || (typeof field === "string" && field.length <= 160 && !/[\x00-\x1f\x7f]/.test(field)))));
}

export function isLiveSnapshot(value: unknown): value is LiveSnapshot {
  if (!object(value) || value.version !== 1 || !["waiting", "live", "stale"].includes(String(value.status))) return false;
  if (!nullableTimestamp(value.receivedAt) || !object(value.gps) || !object(value.imu) || !object(value.trust) || !object(value.diagnostics)) return false;
  if (value.hardware !== undefined && !validHardware(value.hardware)) return false;
  const { gps, imu, trust, diagnostics } = value;
  if (typeof gps.fix !== "boolean" || !nullableNumber(gps.latitude) || !nullableNumber(gps.longitude)
    || (finite(gps.latitude) && Math.abs(gps.latitude) > 90) || (finite(gps.longitude) && Math.abs(gps.longitude) > 180)) return false;
  if (gps.fix && (!finite(gps.latitude) || !finite(gps.longitude))) return false;
  if ((gps.latitude === null) !== (gps.longitude === null)) return false;
  if (gps.source !== null && gps.source !== "RMC" && gps.source !== "GGA" && gps.source !== "INFOESP") return false;
  if (!nullableTimestamp(gps.receivedAt) || ["speedMps", "courseDeg", "altitudeM", "satellites", "hdop", "ageMs"].some((key) => !nullableNumber(gps[key]))) return false;
  if (gps.recordedAt !== null && (typeof gps.recordedAt !== "string" || !Number.isFinite(Date.parse(gps.recordedAt)))) return false;
  if (typeof imu.available !== "boolean" || !nullableTimestamp(imu.receivedAt) || !nullableNumber(imu.sequence) || !nullableNumber(imu.uptimeMs)) return false;
  if (imu.raw !== null && (!object(imu.raw) || ["ax", "ay", "az", "gx", "gy", "gz", "temp"].some((key) => {
    const count = (imu.raw as Record<string, unknown>)[key];
    return !finite(count) || !Number.isInteger(count) || count < -32768 || count > 32767;
  }))) return false;
  if (trust.kind !== "sensor_quality_heuristic" || !nullableNumber(trust.score) || (finite(trust.score) && (trust.score < 0 || trust.score > 100))) return false;
  if (!Array.isArray(trust.factors) || trust.factors.length > 20 || !trust.factors.every((factor) => object(factor)
    && typeof factor.id === "string" && typeof factor.label === "string" && typeof factor.detail === "string"
    && finite(factor.weight) && factor.weight > 0 && factor.weight <= 100 && nullableNumber(factor.value)
    && (factor.value === null || (finite(factor.value) && factor.value >= 0 && factor.value <= 1)))) return false;
  if (!Array.isArray(trust.reasons) || trust.reasons.length > 50 || !trust.reasons.every((reason) => typeof reason === "string")) return false;
  return ["lines", "checksumErrors", "invalidLines"].every((key) => diagnostics[key] === null || (finite(diagnostics[key]) && (diagnostics[key] as number) >= 0));
}

export function isLiveFeed(value: unknown): value is LiveFeed {
  if (!object(value) || value.version !== 1 || !["esp32-serial", "esp32-infoesp"].includes(String(value.source)) || !timestamp(value.generatedAt) || !timestamp(value.startedAt)) return false;
  if (!nullableTimestamp(value.receivedAt) || !object(value.serial) || typeof value.serial.connected !== "boolean"
    || typeof value.serial.port !== "string" || !finite(value.serial.baudRate)
    || (value.serial.error !== null && typeof value.serial.error !== "string")) return false;
  if (!isLiveSnapshot(value.live) || (value.capturedSnapshot !== null && !isLiveSnapshot(value.capturedSnapshot))) return false;
  return Array.isArray(value.trajectory) && value.trajectory.length <= 240 && value.trajectory.every((point) => object(point)
    && finite(point.latitude) && Math.abs(point.latitude) <= 90 && finite(point.longitude) && Math.abs(point.longitude) <= 180
    && timestamp(point.receivedAt) && (point.recordedAt === null || typeof point.recordedAt === "string"));
}

/** Only age the latest observation; never promote a captured snapshot to live. */
export function ageLiveSnapshot(snapshot: LiveSnapshot, now = Date.now(), connected = true): LiveSnapshot {
  const copy: LiveSnapshot = { ...snapshot, gps: { ...snapshot.gps }, imu: { ...snapshot.imu }, trust: { ...snapshot.trust, reasons: [...snapshot.trust.reasons] }, diagnostics: { ...snapshot.diagnostics } };
  if (snapshot.hardware) copy.hardware = Object.fromEntries(Object.entries(snapshot.hardware).map(([kind, report]) => [kind, { receivedAt: report.receivedAt, values: { ...report.values } }]));
  const streamAge = copy.receivedAt === null ? Infinity : now - copy.receivedAt;
  const gpsAge = copy.gps.receivedAt === null ? null : now - copy.gps.receivedAt;
  const imuAge = copy.imu.receivedAt === null ? null : now - copy.imu.receivedAt;
  const captureAge = copy.gps.recordedAt === null ? null : now - Date.parse(copy.gps.recordedAt);
  const clockConflict = [streamAge, gpsAge, imuAge].some((age) => age !== null && age < -2000);
  copy.gps.ageMs = gpsAge === null || gpsAge < -2000 ? null : Math.max(0, gpsAge);
  if (!connected || streamAge > 5000 || clockConflict) copy.status = copy.receivedAt === null ? "waiting" : "stale";
  if (!connected || clockConflict || gpsAge === null || gpsAge > 10000 || (captureAge !== null && (captureAge > 10000 || captureAge < -2000))) {
    copy.gps.fix = false;
    copy.gps.speedMps = null;
    copy.gps.courseDeg = null;
  }
  if (!connected || clockConflict || imuAge === null || imuAge > 5000) copy.imu.available = false;
  if (clockConflict && !copy.trust.reasons.includes("host_clock_reversed")) copy.trust.reasons.push("host_clock_reversed");
  if (copy.status !== "live" || !copy.gps.fix) copy.trust.score = null;
  return copy;
}
