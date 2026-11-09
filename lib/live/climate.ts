import { GPS_STALE_MS, STREAM_STALE_MS, type LiveSnapshot } from "./telemetry";

export const CLIMATE_REFRESH_MS = 5 * 60_000;
export const CLIMATE_MOVE_M = 1_000;
export const CLIMATE_MODEL_MAX_AGE_MS = 30 * 60_000;
export const CLIMATE_COALESCE_MS = 800;
export const CLIMATE_RETRY_MS = 60_000;
const REQUEST_TIMEOUT_MS = 12_000;
const RESPONSE_LIMIT_BYTES = 64 * 1_024;
const MODEL_FUTURE_MS = 60_000;

export type ClimatePoint = { latitude: number; longitude: number };
export type ClimateReading = {
  location: ClimatePoint;
  gridLocation: ClimatePoint;
  validAt: number;
  fetchedAt: number;
  intervalSeconds: number;
  temperatureC: number | null;
  feelsLikeC: number | null;
  humidityPct: number | null;
  windKmh: number | null;
  weatherCode: number | null;
  isDay: boolean | null;
};
export type ClimateInput = { snapshot: LiveSnapshot | null; connected: boolean; sourceKey: string };
export type ClimateState = { reading: ClimateReading | null; sourceKey: string | null; loading: boolean; error: boolean };

function finite(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

function validPoint(point: ClimatePoint): boolean {
  return finite(point.latitude, -90, 90) && finite(point.longitude, -180, 180);
}

function recentReceipt(value: number | null, now: number, limit: number): boolean {
  return finite(value, 0, now) && now - value <= limit;
}

/** Use original GPS observations, never a held display-filter position. */
export function currentClimatePoint(snapshot: LiveSnapshot | null, connected: boolean, now: number): ClimatePoint | null {
  if (!finite(now, 0, 8.64e15) || !connected || snapshot?.status !== "live"
    || !recentReceipt(snapshot.receivedAt, now, STREAM_STALE_MS)) return null;
  const gps = snapshot.gps;
  if (!gps.fix || !recentReceipt(gps.receivedAt, now, GPS_STALE_MS)
    || !finite(gps.latitude, -90, 90) || !finite(gps.longitude, -180, 180)
    || (gps.ageMs !== null && !finite(gps.ageMs, 0, GPS_STALE_MS))) return null;
  if (gps.recordedAt !== null) {
    const recordedAt = Date.parse(gps.recordedAt);
    if (!Number.isFinite(recordedAt) || now - recordedAt > GPS_STALE_MS || recordedAt - now > 2_000) return null;
  }
  return { latitude: gps.latitude, longitude: gps.longitude };
}

export function climateDistanceM(a: ClimatePoint, b: ClimatePoint): number {
  if (!validPoint(a) || !validPoint(b)) return Infinity;
  const radians = Math.PI / 180;
  const latitude = Math.sin((b.latitude - a.latitude) * radians / 2);
  const longitude = Math.sin((b.longitude - a.longitude) * radians / 2);
  const h = latitude ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * longitude ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export function shouldRefreshClimate(reading: ClimateReading | null, point: ClimatePoint | null, now: number): boolean {
  if (!point || !validPoint(point) || !finite(now, 0, 8.64e15)) return false;
  return !reading || now < reading.fetchedAt || now - reading.fetchedAt >= CLIMATE_REFRESH_MS
    || climateDistanceM(reading.location, point) >= CLIMATE_MOVE_M;
}

export function climateIsCurrent(reading: ClimateReading | null, point: ClimatePoint | null, now: number): boolean {
  return !!reading && !!point && validPoint(point) && finite(now, 0, 8.64e15) && !shouldRefreshClimate(reading, point, now)
    && now - reading.validAt <= CLIMATE_MODEL_MAX_AGE_MS && reading.validAt - now <= MODEL_FUTURE_MS;
}

export function climateUrl(point: ClimatePoint): string {
  if (!validPoint(point)) throw new RangeError("Invalid weather location");
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(point.latitude), longitude: String(point.longitude),
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day",
    temperature_unit: "celsius", wind_speed_unit: "kmh", timeformat: "unixtime", timezone: "UTC", forecast_days: "1",
  }).toString();
  return url.toString();
}

const CONDITIONS: Readonly<Record<number, string>> = {
  0: "Clear sky", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog",
  51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 56: "Light freezing drizzle", 57: "Freezing drizzle",
  61: "Light rain", 63: "Rain", 65: "Heavy rain", 66: "Light freezing rain", 67: "Freezing rain",
  71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Light rain showers",
  81: "Rain showers", 82: "Heavy rain showers", 85: "Light snow showers", 86: "Heavy snow showers",
  95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail",
};

export function climateCondition(code: number | null): string {
  return code === null ? "Conditions unavailable" : CONDITIONS[code] ?? "Conditions unavailable";
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Unknown units and out-of-range data fail closed instead of becoming plausible numbers. */
export function parseClimate(value: unknown, location: ClimatePoint, fetchedAt: number): ClimateReading | null {
  const body = object(value);
  const current = object(body?.current);
  const units = object(body?.current_units);
  if (!validPoint(location) || !finite(fetchedAt, 0, 8.64e15) || !body || !current || !units
    || body.utc_offset_seconds !== 0 || units.time !== "unixtime" || units.interval !== "seconds"
    || !finite(body.latitude, -90, 90) || !finite(body.longitude, -180, 180)
    || !finite(current.time, Math.max(0, (fetchedAt - 86_400_000) / 1_000), (fetchedAt + MODEL_FUTURE_MS) / 1_000)
    || !Number.isInteger(current.time) || !finite(current.interval, 1, 3_600) || !Number.isInteger(current.interval)) return null;
  const fields = [
    ["temperature_2m", "°C", -100, 70], ["apparent_temperature", "°C", -150, 100],
    ["relative_humidity_2m", "%", 0, 100], ["wind_speed_10m", "km/h", 0, 450],
    ["weather_code", "wmo code", 0, 99], ["is_day", "", 0, 1],
  ] as const;
  for (const [key, unit, min, max] of fields) {
    if (current[key] !== null && current[key] !== undefined && (units[key] !== unit || !finite(current[key], min, max))) return null;
  }
  const code = current.weather_code;
  const isDay = current.is_day;
  if (code !== undefined && code !== null && (typeof code !== "number" || !Object.hasOwn(CONDITIONS, code))) return null;
  if (isDay !== undefined && isDay !== null && isDay !== 0 && isDay !== 1) return null;
  const gridLocation = { latitude: body.latitude, longitude: body.longitude };
  // A distant provider grid must not be presented as weather near the receiver.
  if (climateDistanceM(location, gridLocation) > 100_000) return null;
  const number = (key: string) => typeof current[key] === "number" ? current[key] as number : null;
  return {
    location: { ...location }, gridLocation, validAt: current.time * 1_000, fetchedAt, intervalSeconds: current.interval,
    temperatureC: number("temperature_2m"), feelsLikeC: number("apparent_temperature"),
    humidityPct: number("relative_humidity_2m"), windKmh: number("wind_speed_10m"), weatherCode: number("weather_code"),
    isDay: isDay === 1 ? true : isDay === 0 ? false : null,
  };
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.ok || !response.body) throw new Error("Weather response unavailable");
  if (Number(response.headers.get("content-length")) > RESPONSE_LIMIT_BYTES) throw new Error("Weather response too large");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > RESPONSE_LIMIT_BYTES) throw new Error("Weather response too large");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

type Attempt = { location: ClimatePoint; sourceKey: string; at: number };
type ActiveRequest = Attempt & { controller: AbortController; timeout: ReturnType<typeof setTimeout> | null };

/** Polling is driven by the view's clock, independently of the sensor sample rate. */
export class ClimateController {
  private input: ClimateInput | null = null;
  private state: ClimateState = { reading: null, sourceKey: null, loading: false, error: false };
  private active: ActiveRequest | null = null;
  private retry: Attempt | null = null;
  private dueAt: number | null = null;
  private disposed = false;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly onChange: (state: ClimateState) => void, options: { fetcher?: typeof fetch; now?: () => number } = {}) {
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
    this.now = options.now ?? Date.now;
  }

  update(input: ClimateInput): void {
    this.input = input;
    this.poll();
  }

  poll(): void {
    if (this.disposed || !this.input) return;
    const now = this.now();
    const point = currentClimatePoint(this.input.snapshot, this.input.connected, now);
    if (!point) {
      this.dueAt = null;
      this.cancel();
      return;
    }
    const sourceKey = this.input.sourceKey;
    if (this.active && (this.active.sourceKey !== sourceKey || now < this.active.at
      || climateDistanceM(this.active.location, point) >= CLIMATE_MOVE_M)) {
      this.cancel();
      this.dueAt = null;
    }
    if (this.active) return;
    if (!shouldRefreshClimate(this.state.sourceKey === sourceKey ? this.state.reading : null, point, now)) {
      this.dueAt = null;
      this.publish({ error: false });
      return;
    }
    if (this.retry && this.retry.sourceKey === sourceKey && climateDistanceM(this.retry.location, point) < CLIMATE_MOVE_M
      && now >= this.retry.at && now - this.retry.at < CLIMATE_RETRY_MS) return;
    if (this.dueAt === null) this.dueAt = now + CLIMATE_COALESCE_MS;
    if (now < this.dueAt) return;
    this.dueAt = null;
    const request: ActiveRequest = { location: point, sourceKey, at: now, controller: new AbortController(), timeout: null };
    this.active = request;
    request.timeout = setTimeout(() => this.fail(request), REQUEST_TIMEOUT_MS);
    this.publish({ loading: true, error: false });
    void this.load(request);
  }

  dispose(): void {
    this.disposed = true;
    this.dueAt = null;
    this.cancel();
    this.input = null;
  }

  private publish(patch: Partial<ClimateState>): void {
    const next = { ...this.state, ...patch };
    if (Object.keys(next).some((key) => next[key as keyof ClimateState] !== this.state[key as keyof ClimateState])) {
      this.state = next;
      if (!this.disposed) this.onChange(next);
    }
  }

  private cancel(): void {
    if (!this.active) return;
    const request = this.active;
    this.active = null;
    if (request.timeout !== null) clearTimeout(request.timeout);
    request.controller.abort();
    this.publish({ loading: false });
  }

  private fail(request: ActiveRequest): void {
    if (this.disposed || this.active !== request) return;
    this.retry = { location: request.location, sourceKey: request.sourceKey, at: this.now() };
    this.cancel();
    this.publish({ error: true });
  }

  private async load(request: ActiveRequest): Promise<void> {
    try {
      const response = await this.fetcher(climateUrl(request.location), {
        signal: request.controller.signal, credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const value = await readResponse(response);
      if (this.disposed || this.active !== request || !this.input) return;
      const now = this.now();
      const point = currentClimatePoint(this.input.snapshot, this.input.connected, now);
      if (!point || this.input.sourceKey !== request.sourceKey || climateDistanceM(request.location, point) >= CLIMATE_MOVE_M
        || now < request.at || now - request.at >= REQUEST_TIMEOUT_MS) {
        this.cancel();
        this.poll();
        return;
      }
      const reading = parseClimate(value, request.location, now);
      if (!reading) throw new Error("Invalid weather response");
      if (request.timeout !== null) clearTimeout(request.timeout);
      this.active = null;
      this.retry = null;
      this.publish({ reading, sourceKey: request.sourceKey, loading: false, error: false });
    } catch {
      this.fail(request);
    }
  }
}
