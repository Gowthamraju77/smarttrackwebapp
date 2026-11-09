import { createHash } from "node:crypto";

export const MAX_INGEST_BODY_BYTES = 32 * 1024;
export const MAX_RECORD_ID_BYTES = 128;
const RPC_TIMEOUT_MS = 10_000;

export type IngestKind = "telemetry" | "sos";

export interface DeviceGps {
  fix: boolean;
  lat: number | null;
  lon: number | null;
  speed_mps: number | null;
  hdop: number | null;
  age_ms: number | null;
}

interface RecordIdentity {
  version: 1;
  device_id: string;
  record_id: string;
  recorded_at: string | null;
  boot_id: string;
  sequence: number;
  uptime_ms: number;
}

export interface TelemetryPayload extends RecordIdentity {
  gps: DeviceGps;
  imu: { accel_mps2: number | null; gyro_dps: number | null } | null;
}

export interface SosPayload extends RecordIdentity {
  event: "sos";
  gps: DeviceGps;
}

export type DevicePayload = TelemetryPayload | SosPayload;

export class IngestError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "IngestError";
  }
}

function invalidPayload(message: string): never {
  throw new IngestError(422, "invalid_payload", message);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (!isObject(value)) invalidPayload(`${name} must be an object.`);
  return value;
}

function requireKeys(
  value: Record<string, unknown>,
  name: string,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  ) {
    invalidPayload(`${name} has missing or unsupported fields.`);
  }
}

// JSON escapes can represent lone surrogates even when the request bytes are UTF-8.
// Reject them rather than silently replacing them before checking the checksum.
function isWellFormedUnicode(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const unit = value.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function identifier(value: unknown, name: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    !isWellFormedUnicode(value) ||
    Buffer.byteLength(value, "utf8") > MAX_RECORD_ID_BYTES
  ) {
    invalidPayload(`${name} must be a nonempty identifier of at most 128 UTF-8 bytes.`);
  }
  return value;
}

function nullableNumber(
  value: unknown,
  name: string,
  minimum = -Number.MAX_VALUE,
  maximum = Number.MAX_VALUE,
): number | null {
  if (value === null) return null;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalidPayload(`${name} must be null or a finite number within its valid range.`);
  }
  return value;
}

function counter(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalidPayload(`${name} must be a nonnegative safe integer.`);
  }
  return value;
}

export function validateRecordedAt(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 40) {
    invalidPayload("recorded_at must be null or an RFC 3339 timestamp with a timezone.");
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) invalidPayload("recorded_at must be null or an RFC 3339 timestamp with a timezone.");
  const [, y, m, d, h, min, s, zone] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (
    year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1] ||
    Number(h) > 23 || Number(min) > 59 || Number(s) > 59 ||
    (zone !== "Z" && (Number(zone.slice(1, 3)) > 23 || Number(zone.slice(4, 6)) > 59)) ||
    !Number.isFinite(Date.parse(value))
  ) {
    invalidPayload("recorded_at is not a valid calendar timestamp.");
  }
  return value;
}

const GPS_KEYS = ["fix", "lat", "lon", "speed_mps", "hdop", "age_ms"] as const;

export function validateGps(value: unknown): DeviceGps {
  const gps = requireObject(value, "gps");
  requireKeys(gps, "gps", GPS_KEYS);
  if (typeof gps.fix !== "boolean") invalidPayload("gps.fix must be a boolean.");
  const validated: DeviceGps = {
    fix: gps.fix,
    lat: nullableNumber(gps.lat, "gps.lat", -90, 90),
    lon: nullableNumber(gps.lon, "gps.lon", -180, 180),
    speed_mps: nullableNumber(gps.speed_mps, "gps.speed_mps", 0),
    hdop: nullableNumber(gps.hdop, "gps.hdop", 0),
    age_ms: nullableNumber(gps.age_ms, "gps.age_ms", 0, Number.MAX_SAFE_INTEGER),
  };
  if (validated.fix && (validated.lat === null || validated.lon === null)) {
    invalidPayload("A GPS fix requires both latitude and longitude.");
  }
  if (!validated.fix && (validated.lat !== null || validated.lon !== null || validated.speed_mps !== null)) {
    invalidPayload("Coordinates and speed must be null when there is no GPS fix.");
  }
  return validated;
}

const IDENTITY_KEYS = [
  "version", "device_id", "record_id", "recorded_at", "boot_id", "sequence", "uptime_ms",
] as const;

export function validateDevicePayload(value: unknown, kind: IngestKind): DevicePayload {
  if (kind !== "telemetry" && kind !== "sos") invalidPayload("Unsupported record kind.");
  const payload = requireObject(value, "payload");
  if (kind === "telemetry") {
    requireKeys(payload, "payload", [...IDENTITY_KEYS, "gps", "imu"]);
  } else {
    requireKeys(payload, "payload", [...IDENTITY_KEYS, "event"], ["gps"]);
  }
  if (payload.version !== 1) invalidPayload("Unsupported wire protocol version.");
  const identity: RecordIdentity = {
    version: 1,
    device_id: identifier(payload.device_id, "device_id"),
    record_id: identifier(payload.record_id, "record_id"),
    recorded_at: validateRecordedAt(payload.recorded_at),
    boot_id: identifier(payload.boot_id, "boot_id"),
    sequence: counter(payload.sequence, "sequence"),
    uptime_ms: counter(payload.uptime_ms, "uptime_ms"),
  };
  if (kind === "sos") {
    if (payload.event !== "sos") invalidPayload("SOS records require event: sos.");
    // An SOS must still be durable when GPS is absent. Normalize absence explicitly;
    // never invent coordinates or attach a previous location as a current fix.
    const gps = payload.gps === undefined || payload.gps === null
      ? { fix: false, lat: null, lon: null, speed_mps: null, hdop: null, age_ms: null }
      : validateGps(payload.gps);
    return { ...identity, event: "sos", gps };
  }
  let imu: TelemetryPayload["imu"] = null;
  if (payload.imu !== null) {
    const input = requireObject(payload.imu, "imu");
    requireKeys(input, "imu", ["accel_mps2", "gyro_dps"]);
    imu = {
      accel_mps2: nullableNumber(input.accel_mps2, "imu.accel_mps2"),
      gyro_dps: nullableNumber(input.gyro_dps, "imu.gyro_dps"),
    };
  }
  return { ...identity, gps: validateGps(payload.gps), imu };
}

/** CRC32 IEEE (reflected polynomial 0xEDB88320), over the exact UTF-8 string bytes. */
export function crc32Utf8(payload: string): string {
  let crc = 0xffffffff;
  for (const byte of Buffer.from(payload, "utf8")) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) !== 0 ? 0xedb88320 : 0);
    }
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, "0");
}

export function validateIngestEnvelope(envelope: unknown, kind: IngestKind): DevicePayload {
  if (
    !isObject(envelope) || Object.keys(envelope).length !== 2 ||
    typeof envelope.payload !== "string" || envelope.payload.length === 0 ||
    typeof envelope.crc32 !== "string" || !/^[a-f\d]{8}$/i.test(envelope.crc32) ||
    !isWellFormedUnicode(envelope.payload)
  ) {
    throw new IngestError(400, "invalid_envelope", "Expected a payload JSON string and an eight-digit CRC32.");
  }
  if (Buffer.byteLength(envelope.payload, "utf8") > MAX_INGEST_BODY_BYTES) {
    throw new IngestError(413, "body_too_large", "The ingestion body exceeds 32 KiB.");
  }
  if (crc32Utf8(envelope.payload) !== envelope.crc32.toLowerCase()) {
    throw new IngestError(400, "crc_mismatch", "Payload CRC32 does not match.");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(envelope.payload);
  } catch {
    throw new IngestError(400, "invalid_json", "Payload is not valid JSON.");
  }
  return validateDevicePayload(payload, kind);
}

export function parseDeviceBearer(authorization: string | null): string {
  const match = authorization !== null && authorization.length <= 1031
    ? /^Bearer ([A-Za-z\d._~+\/-]+=*)$/i.exec(authorization)
    : null;
  if (!match) {
    throw new IngestError(401, "unauthorized", "A device bearer token is required.");
  }
  return match[1];
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

async function readBoundedUtf8(body: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!body) throw new IngestError(400, "invalid_json", "A JSON body is required.");
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_INGEST_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new IngestError(413, "body_too_large", "The ingestion body exceeds 32 KiB.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof IngestError) throw error;
    throw new IngestError(400, "invalid_body", "The request body could not be read.");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new IngestError(400, "invalid_utf8", "The body must be valid UTF-8.");
  }
}

export async function readBoundedJsonBody(request: Request): Promise<unknown> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") {
    throw new IngestError(415, "unsupported_media_type", "Content-Type must be application/json.");
  }
  const encoding = request.headers.get("content-encoding");
  if (encoding !== null && encoding.toLowerCase() !== "identity") {
    throw new IngestError(415, "unsupported_encoding", "The JSON body must be uncompressed UTF-8.");
  }
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      throw new IngestError(400, "invalid_body", "Invalid Content-Length.");
    }
    if (Number(contentLength) > MAX_INGEST_BODY_BYTES) {
      void request.body?.cancel().catch(() => undefined);
      throw new IngestError(413, "body_too_large", "The ingestion body exceeds 32 KiB.");
    }
  }
  const text = await readBoundedUtf8(request.body);
  try {
    return JSON.parse(text);
  } catch {
    throw new IngestError(400, "invalid_json", "The body must be valid JSON.");
  }
}

interface IngestDependencies {
  env?: Readonly<Record<string, string | undefined>>;
  fetch?: typeof globalThis.fetch;
}

function databaseConfig(env: Readonly<Record<string, string | undefined>>): { url: string; key: string } {
  const input = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  try {
    if (!input || !key || key.length > 8192 || /\s/.test(key)) throw new Error("Missing configuration");
    const url = new URL(input);
    if (
      url.protocol !== "https:" || url.username || url.password ||
      url.search || url.hash || url.pathname !== "/"
    ) throw new Error("Invalid endpoint");
    return { url: `${url.origin}/rest/v1/rpc/ingest_device_record`, key };
  } catch {
    throw new IngestError(503, "ingest_unavailable", "Device ingestion is not configured.");
  }
}

function rpcFailure(status: number, result: unknown): IngestError {
  const code = isObject(result) ? result.code : undefined;
  if (code === "PT401" || code === "28000" || code === "28P01") {
    return new IngestError(401, "unauthorized", "Device credentials were rejected.");
  }
  if (code === "PT403" || code === "42501") {
    return new IngestError(403, "forbidden", "This device cannot submit records.");
  }
  if (code === "PT409" || code === "23505") {
    return new IngestError(409, "record_conflict", "The record conflicts with an existing record.");
  }
  if (code === "PT429" || status === 429) {
    return new IngestError(429, "rate_limited", "Device ingestion rate limit exceeded.");
  }
  if (code === "22023" || code === "22007" || code === "22008") {
    return new IngestError(422, "invalid_payload", "The database rejected the record payload.");
  }
  // A service-role credential failure is a backend outage, not proof the device token is bad.
  return new IngestError(503, "ingest_unavailable", "Device storage is unavailable.");
}

/** The database RPC alone authenticates ownership and commits/deduplicates the record. */
export async function handleDeviceIngest(
  request: Request,
  kind: IngestKind,
  dependencies: IngestDependencies = {},
): Promise<Response> {
  const headers: Record<string, string> = { "Cache-Control": "no-store", Vary: "Authorization" };
  try {
    if (request.method !== "POST") {
      headers.Allow = "POST";
      throw new IngestError(405, "method_not_allowed", "Use POST to submit a device record.");
    }
    const config = databaseConfig(dependencies.env ?? process.env);
    const token = parseDeviceBearer(request.headers.get("authorization"));
    const payload = validateIngestEnvelope(await readBoundedJsonBody(request), kind);
    let response: Response;
    try {
      response = await (dependencies.fetch ?? globalThis.fetch)(config.url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.key}`,
          apikey: config.key,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ p_token_hash: hashDeviceToken(token), p_payload: payload, p_kind: kind }),
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(RPC_TIMEOUT_MS),
      });
    } catch {
      throw new IngestError(503, "ingest_unavailable", "Device storage could not be reached.");
    }
    let result: unknown;
    try {
      result = JSON.parse(await readBoundedUtf8(response.body));
    } catch {
      if (!response.ok) throw rpcFailure(response.status, null);
      throw new IngestError(502, "invalid_receipt", "Device storage returned an invalid receipt.");
    }
    if (!response.ok) throw rpcFailure(response.status, result);
    if (
      !isObject(result) || result.accepted !== true ||
      result.record_id !== payload.record_id || typeof result.duplicate !== "boolean"
    ) {
      throw new IngestError(502, "invalid_receipt", "Device storage did not confirm this record.");
    }
    return Response.json(
      { accepted: true, record_id: payload.record_id, duplicate: result.duplicate },
      { status: 200, headers },
    );
  } catch (error) {
    const failure = error instanceof IngestError
      ? error
      : new IngestError(503, "ingest_unavailable", "Device ingestion is unavailable.");
    if (failure.status === 401) headers["WWW-Authenticate"] = "Bearer";
    return Response.json({ error: failure.code, message: failure.message }, { status: failure.status, headers });
  }
}
