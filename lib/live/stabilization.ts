/** Display-only deadbands. Raw telemetry, timestamps, scores, and alerts are untouched. */
import type { RawImu } from "./telemetry";

export const GPS_DEADBAND_M = 3;
export const ACCEL_DEADBAND_COUNTS = 64;
export const GYRO_DEADBAND_COUNTS = 12;
export type StabilityPoint = { latitude: number; longitude: number; receivedAt: number; recordedAt?: string | null };
export type MotionInput = { raw: RawImu | null; receivedAt: number | null; sequence: number | null; uptimeMs: number | null };
export type StabilityInput = {
  sourceKey: string;
  points: readonly StabilityPoint[];
  gps: StabilityPoint | null;
  motion: MotionInput | null;
  restarted: boolean;
  receivedAt: number | null;
};
export type StabilityState = {
  sourceKey: string;
  gpsPoint: StabilityPoint | null;
  anchor: StabilityPoint | null;
  lastGpsAt: number | null;
  points: readonly StabilityPoint[];
  gpsHeld: boolean;
  suppressedGps: number;
  motionValues: RawImu | null;
  motionReceivedAt: number | null;
  motionSequence: number | null;
  motionUptime: number | null;
  heldMotionAxes: readonly string[];
  restartFlag: boolean;
  epochFloorAt: number;
};

export function emptyStability(sourceKey = ""): StabilityState {
  return { sourceKey, gpsPoint: null, anchor: null, lastGpsAt: null, points: [], gpsHeld: false,
    suppressedGps: 0, motionValues: null, motionReceivedAt: null, motionSequence: null,
    motionUptime: null, heldMotionAxes: [], restartFlag: false, epochFloorAt: 0 };
}

function validTime(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0 && value <= 8_640_000_000_000_000;
}
export function validStabilityPoint(point: StabilityPoint | null): point is StabilityPoint {
  return point !== null && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180 && validTime(point.receivedAt);
}

export function gpsDistanceM(a: StabilityPoint, b: StabilityPoint): number {
  const radians = Math.PI / 180;
  const lat = (b.latitude - a.latitude) * radians;
  const lon = (b.longitude - a.longitude) * radians;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(lon / 2) ** 2;
  return 12_742_017.6 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

function wentBackwards(previous: number | null, next: number | null) {
  if (previous === null || next === null || previous === next) return false;
  // Treat normal uint32 wrap as forwards, but a counter reset as a new baseline.
  return (next - previous + 0x100000000) % 0x100000000 > 0x80000000;
}

function acceptGps(state: StabilityState, candidate: StabilityPoint): StabilityState {
  if (!validStabilityPoint(candidate) || candidate.receivedAt < state.epochFloorAt
    || (state.lastGpsAt !== null && candidate.receivedAt <= state.lastGpsAt)) return state;
  const anchor = state.anchor;
  const reset = !anchor || state.lastGpsAt === null || candidate.receivedAt - state.lastGpsAt > 10_000;
  const distance = anchor ? gpsDistanceM(anchor, candidate) : Infinity;
  if (!reset && distance > 0.001 && distance <= GPS_DEADBAND_M) {
    return { ...state, lastGpsAt: candidate.receivedAt, gpsHeld: true, suppressedGps: state.suppressedGps + 1 };
  }
  const copy = { ...candidate };
  const previous = state.points[state.points.length - 1];
  const duplicate = previous?.latitude === candidate.latitude && previous?.longitude === candidate.longitude;
  return { ...state, gpsPoint: copy, anchor: copy, lastGpsAt: candidate.receivedAt, gpsHeld: false,
    points: duplicate ? state.points : [...state.points, copy].slice(-240) };
}

/** A pure incremental reducer: rolling input histories cannot shift an existing anchor. */
export function advanceStability(previous: StabilityState, input: StabilityInput): StabilityState {
  const previousCutoff = Math.max(previous.lastGpsAt ?? -1, previous.motionReceivedAt ?? -1) + 1;
  const hadPreviousEvidence = previous.lastGpsAt !== null || previous.motionReceivedAt !== null || previous.epochFloorAt > 0;
  let state = previous.sourceKey === input.sourceKey ? previous : {
    ...emptyStability(input.sourceKey),
    epochFloorAt: hadPreviousEvidence ? validTime(input.receivedAt) ? input.receivedAt : previousCutoff : 0,
  };
  const sample = input.motion;
  const newMotion = sample && validTime(sample.receivedAt)
    && (state.motionReceivedAt === null || sample.receivedAt > state.motionReceivedAt);
  const restart = (input.restarted && !state.restartFlag) || Boolean(newMotion && (
    wentBackwards(state.motionSequence, sample.sequence) || wentBackwards(state.motionUptime, sample.uptimeMs)));
  if (restart) {
    // BOOT clears the live receipt. Retained historical captures must not seed
    // the new baseline, including when GPS returns before the first new IMU.
    const capturedCutoff = Math.max(previousCutoff - 1, input.gps?.receivedAt ?? -1,
      input.motion?.receivedAt ?? -1, ...input.points.slice(-240).map(point => validTime(point.receivedAt) ? point.receivedAt : -1)) + 1;
    state = { ...emptyStability(input.sourceKey), epochFloorAt: validTime(input.receivedAt) ? input.receivedAt : capturedCutoff };
  }
  if (state.restartFlag !== input.restarted) state = { ...state, restartFlag: input.restarted };
  for (const point of input.points.slice(-240)) state = acceptGps(state, point);
  if (input.gps) state = acceptGps(state, input.gps);

  const raw = sample?.raw;
  const validRaw = raw && ["ax", "ay", "az", "gx", "gy", "gz", "temp"].every(key => {
    const value = raw[key as keyof RawImu];
    return Number.isInteger(value) && value >= -32768 && value <= 32767;
  });
  if (sample && validRaw && validTime(sample.receivedAt) && sample.receivedAt >= state.epochFloorAt
    && (state.motionReceivedAt === null || sample.receivedAt > state.motionReceivedAt)) {
    const reset = !state.motionValues || state.motionReceivedAt === null || sample.receivedAt - state.motionReceivedAt > 5000;
    const values = { ...raw };
    const held: string[] = [];
    if (!reset && state.motionValues) {
      for (const axis of ["ax", "ay", "az", "gx", "gy", "gz"] as const) {
        const delta = Math.abs(raw[axis] - state.motionValues[axis]);
        const threshold = axis.startsWith("a") ? ACCEL_DEADBAND_COUNTS : GYRO_DEADBAND_COUNTS;
        if (delta > 0 && delta <= threshold) { values[axis] = state.motionValues[axis]; held.push(axis); }
      }
    }
    state = { ...state, motionValues: values, motionReceivedAt: sample.receivedAt,
      motionSequence: sample.sequence, motionUptime: sample.uptimeMs, heldMotionAxes: held };
  }
  return state;
}
