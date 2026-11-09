import { gpsDistanceM, validStabilityPoint, type StabilityPoint } from "./stabilization";
import type { LiveSnapshot, RawImu } from "./telemetry";

type Vector = readonly [number, number, number];
export type MotionEvidence = {
  available: boolean; receivedAt: number | null; sequence: number | null; uptimeMs: number | null;
  raw: RawImu | null; acceleration: Vector | null; rotation: Vector | null;
};
type Sample = { at: number; acceleration: Vector; rotation: Vector; physical: boolean };
export type MapFilterState = {
  sourceKey: string; restartFlag: boolean; gpsPoint: StabilityPoint | null;
  points: readonly StabilityPoint[]; lastGpsAt: number | null; lastGpsUtc: string | null;
  mode: "unknown" | "moving" | "still"; samples: readonly Sample[]; reference: Sample | null;
  lastMotionAt: number | null; sequence: number | null; uptimeMs: number | null;
  quietGps: readonly StabilityPoint[]; anchor: StabilityPoint | null;
  departures: readonly StabilityPoint[]; held: boolean; escapeUntil: number;
};
export type MapFilterInput = {
  sourceKey: string; restarted: boolean; now: number; connected: boolean; currentFix: boolean;
  gps: StabilityPoint | null; points: readonly StabilityPoint[]; motion: MotionEvidence | null;
};
const IMU_FRESH_MS = 3000, SETTLE_MS = 4000, CLUSTER_RADIUS_M = 12, HOLD_REGION_M = 40;
const norm = (v: Vector) => Math.hypot(...v);
const delta = (a: Vector, b: Vector) => Math.hypot(...a.map((x, i) => x - b[i]));
const vector = (v: Vector | null): v is Vector => v !== null && v.length === 3 && v.every(Number.isFinite);
const copy = (point: StabilityPoint) => ({ ...point });
const fresh = (at: number | null, now: number, limit: number) => at !== null && Number.isFinite(at) && at >= 0 && now >= at - 2000 && now - at <= limit;

export function mapMotionEvidence(snapshot: LiveSnapshot | null, now: number): MotionEvidence | null {
  if (!snapshot) return null;
  const report = snapshot.hardware?.imu;
  const fields = report && fresh(report.receivedAt, now, IMU_FRESH_MS) ? report.values : {};
  const physical = (prefix: string, unit: string): Vector | null => {
    const values = ["x", "y", "z"].map(axis => fields[`${prefix}_${axis}_${unit}`]);
    return values.every(value => typeof value === "number" && Number.isFinite(value)) ? values as unknown as Vector : null;
  };
  return { ...snapshot.imu, acceleration: physical("acceleration", "m_s2"), rotation: physical("rotation", "deg_s") };
}

export function emptyMapFilter(sourceKey = ""): MapFilterState {
  return { sourceKey, restartFlag: false, gpsPoint: null, points: [], lastGpsAt: null, lastGpsUtc: null,
    mode: "unknown", samples: [], reference: null, lastMotionAt: null, sequence: null, uptimeMs: null,
    quietGps: [], anchor: null, departures: [], held: false, escapeUntil: 0 };
}

function counterReset(before: number | null, after: number | null) {
  if (before === null || after === null || after >= before) return false;
  return !(before > 0xf0000000 && before <= 0xffffffff && after < 0x0fffffff);
}

function motionSample(evidence: MotionEvidence | null, now: number): Sample | null {
  if (!evidence?.available || !fresh(evidence.receivedAt, now, IMU_FRESH_MS) || !evidence.raw) return null;
  const raw = evidence.raw;
  if (![raw.ax, raw.ay, raw.az, raw.gx, raw.gy, raw.gz].every(v => Number.isInteger(v) && Math.abs(v) < 32760)) return null;
  if (vector(evidence.acceleration) && vector(evidence.rotation)) {
    return { at: evidence.receivedAt!, acceleration: [...evidence.acceleration], rotation: [...evidence.rotation], physical: true };
  }
  // Unscaled serial samples use relative gravity counts and explicit count thresholds.
  // No sensor model, physical rotation scale or calibration is invented.
  const acceleration: Vector = [raw.ax, raw.ay, raw.az];
  if (norm(acceleration) < 1000) return null;
  return { at: evidence.receivedAt!, acceleration, rotation: [raw.gx, raw.gy, raw.gz], physical: false };
}

function average(samples: readonly Sample[]): Sample {
  const mean = (key: "acceleration" | "rotation"): Vector => [0, 1, 2].map(i => samples.reduce((sum, sample) => sum + sample[key][i], 0) / samples.length) as unknown as Vector;
  return { at: samples[0].at, acceleration: mean("acceleration"), rotation: mean("rotation"), physical: samples[0].physical };
}
function thresholds(sample: Sample) {
  return sample.physical ? { acceleration: 0.45, rotation: 2, spreadA: 0.12, spreadG: 0.65 }
    : { acceleration: norm(sample.acceleration) * 0.045, rotation: 256, spreadA: norm(sample.acceleration) * 0.012, spreadG: 64 };
}
function moved(sample: Sample, baseline: Sample) {
  const limits = thresholds(baseline);
  return sample.physical !== baseline.physical || delta(sample.acceleration, baseline.acceleration) > limits.acceleration
    || delta(sample.rotation, baseline.rotation) > limits.rotation;
}
function quiet(samples: readonly Sample[]) {
  if (samples.length < 5 || samples.at(-1)!.at - samples[0].at < SETTLE_MS) return false;
  const mean = average(samples), limits = thresholds(mean);
  if (mean.physical && (norm(mean.acceleration) < 8 || norm(mean.acceleration) > 12)) return false;
  return (["acceleration", "rotation"] as const).every(key => {
    const spread = Math.sqrt(samples.reduce((sum, sample) => sum + delta(sample[key], mean[key]) ** 2, 0) / samples.length);
    return spread <= (key === "acceleration" ? limits.spreadA : limits.spreadG);
  });
}

/** Choose an observed point in the densest local cluster, never an invented road junction. */
export function commonGpsPoint(points: readonly StabilityPoint[]): StabilityPoint | null {
  let selected: StabilityPoint | null = null, support = 0, distance = Infinity;
  const candidates = points.filter(validStabilityPoint).slice(-30);
  for (const candidate of candidates) {
    const distances = candidates.map(point => gpsDistanceM(candidate, point)).filter(metres => metres <= CLUSTER_RADIUS_M);
    const total = distances.reduce((sum, metres) => sum + metres, 0);
    if (distances.length > support || (distances.length === support && total < distance - 0.001)) {
      selected = candidate; support = distances.length; distance = total;
    }
  }
  return support >= 3 && support >= Math.ceil(candidates.length * 0.6) && selected ? copy(selected) : null;
}

function trail(points: readonly StabilityPoint[], point: StabilityPoint) {
  const last = points.at(-1);
  return last?.latitude === point.latitude && last.longitude === point.longitude ? points : [...points, copy(point)].slice(-240);
}

/** Only map presentation changes. Raw positions, timestamps and journey evidence are never mutated. */
export function advanceMapFilter(previous: MapFilterState, input: MapFilterInput): MapFilterState {
  if (!Number.isFinite(input.now)) return previous;
  const sample = input.connected ? motionSample(input.motion, input.now) : null;
  const newer = sample !== null && (previous.lastMotionAt === null || sample.at > previous.lastMotionAt);
  const reset = previous.sourceKey !== input.sourceKey || (input.restarted && !previous.restartFlag)
    || (newer && (counterReset(previous.sequence, input.motion!.sequence) || counterReset(previous.uptimeMs, input.motion!.uptimeMs)));
  let state: MapFilterState = reset ? { ...emptyMapFilter(input.sourceKey), points: input.points.filter(validStabilityPoint).slice(-240).map(copy) } : { ...previous };
  state.restartFlag = input.restarted;
  const oldMode = state.mode;
  const hadAnchor = state.anchor !== null;
  if (!sample || (state.lastMotionAt !== null && input.now - state.lastMotionAt > IMU_FRESH_MS && sample.at <= state.lastMotionAt)) {
    state.mode = "unknown"; state.samples = []; state.reference = null;
  } else if (state.lastMotionAt === null || sample.at > state.lastMotionAt) {
    const duplicate = (input.motion!.uptimeMs !== null && input.motion!.uptimeMs === state.uptimeMs)
      || (input.motion!.sequence !== null && input.motion!.sequence === state.sequence);
    if (!duplicate) {
      const gap = state.lastMotionAt !== null && sample.at - state.lastMotionAt > IMU_FRESH_MS;
      const before = gap ? null : state.reference ?? state.samples.at(-1) ?? null;
      if (gap) { state.samples = []; state.reference = null; state.mode = "unknown"; }
      if (before && moved(sample, before)) {
        state.mode = "moving"; state.samples = [sample]; state.reference = null;
      } else {
        // Keep a time-spanning window even when USB reports hundreds of samples per second.
        const window = state.samples.filter(value => value.physical === sample.physical && sample.at - value.at <= 12000);
        state.samples = !window.length || sample.at - window.at(-1)!.at >= 500 ? [...window, sample].slice(-25) : window;
        if (input.now >= state.escapeUntil && quiet(state.samples)) {
          state.mode = "still"; state.reference ??= average(state.samples);
        }
      }
      state.lastMotionAt = sample.at; state.sequence = input.motion!.sequence; state.uptimeMs = input.motion!.uptimeMs;
    } else if (!fresh(state.lastMotionAt, input.now, IMU_FRESH_MS)) {
      state.mode = "unknown"; state.samples = []; state.reference = null;
    }
  }
  if (state.mode !== "still") {
    state.anchor = null; state.departures = []; state.held = false;
    if (state.mode === "moving" || !sample || reset || oldMode === "still") state.quietGps = [];
  }

  const candidate = input.gps;
  if (!candidate || !validStabilityPoint(candidate)) return state;
  if (!input.connected || !input.currentFix || !fresh(candidate.receivedAt, input.now, 10000)) {
    // Keep the displayed last-known position through GPS loss. The caller retains its stale label.
    state.gpsPoint ??= copy(candidate);
    return state;
  }
  if (state.lastGpsAt !== null && candidate.receivedAt < state.lastGpsAt) return state;
  const sameGps = candidate.receivedAt === state.lastGpsAt || (candidate.recordedAt != null && candidate.recordedAt === state.lastGpsUtc);
  const released = hadAnchor && state.anchor === null;
  if (sameGps && !released) return state;
  const gpsGap = state.lastGpsAt !== null && candidate.receivedAt - state.lastGpsAt > 10000;
  if (gpsGap) { state.anchor = null; state.quietGps = []; state.departures = []; }
  state.lastGpsAt = candidate.receivedAt; state.lastGpsUtc = candidate.recordedAt ?? null;

  if (!sameGps && sample && state.mode !== "moving") {
    const quietSince = state.samples[0]?.at ?? input.now;
    state.quietGps = [...state.quietGps.filter(point => point.receivedAt >= quietSince && input.now - point.receivedAt <= 20000), copy(candidate)].slice(-30);
  }
  if (state.mode === "still" && !state.anchor && state.quietGps.length >= 5) {
    const consensus = commonGpsPoint(state.quietGps);
    if (consensus) {
      state.anchor = consensus;
      const quietSince = state.quietGps[0].receivedAt;
      state.points = state.points.filter(point => point.receivedAt < quietSince);
      state.points = trail(state.points, consensus);
    }
  }
  if (state.anchor) {
    const distance = gpsDistanceM(state.anchor, candidate);
    state.departures = distance > HOLD_REGION_M ? [...state.departures, copy(candidate)].slice(-3) : [];
    const [first, middle, last] = state.departures;
    // An IMU cannot distinguish rest from smooth constant-velocity travel. Coherent
    // GPS departure from this small region releases the hold instead of freezing a journey.
    const coherent = state.departures.length === 3 && last.receivedAt - first.receivedAt >= 2000
      && gpsDistanceM(first, middle) < 100 && gpsDistanceM(middle, last) < 100;
    const escaping = coherent && (commonGpsPoint(state.departures) !== null
      || (gpsDistanceM(first, last) >= 5 && gpsDistanceM(state.anchor, last) > gpsDistanceM(state.anchor, first) + 3));
    if (!escaping) { state.gpsPoint = copy(state.anchor); state.held = true; return state; }
    state.anchor = null; state.mode = "moving"; state.reference = null; state.samples = [];
    state.quietGps = []; state.departures = []; state.escapeUntil = input.now + 10000;
  }
  state.gpsPoint = copy(candidate); state.held = false;
  state.points = trail(state.points, candidate);
  return state;
}
