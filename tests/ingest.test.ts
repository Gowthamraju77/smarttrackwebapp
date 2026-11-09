import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IngestError,
  MAX_INGEST_BODY_BYTES,
  crc32Utf8,
  handleDeviceIngest,
  hashDeviceToken,
  parseDeviceBearer,
  readBoundedJsonBody,
  validateDevicePayload,
  validateGps,
  validateIngestEnvelope,
  validateRecordedAt,
} from "../lib/server/ingest.js";

// All identities, credentials, positions, and HTTP responses in these tests are synthetic.
const fixture = {
  version: 1,
  device_id: "00000000-0000-4000-8000-000000000001",
  record_id: "boot-test:42",
  recorded_at: null,
  boot_id: "boot-test",
  sequence: 42,
  uptime_ms: 1000,
  gps: { fix: true, lat: 0, lon: 0, speed_mps: 0, hdop: null, age_ms: 0 },
  imu: null,
};
const env = { SUPABASE_URL: "https://supabase.example.invalid", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-role" };
const token = "synthetic-device-secret";

function envelope(payload: unknown = fixture): { payload: string; crc32: string } {
  const text = JSON.stringify(payload);
  return { payload: text, crc32: crc32Utf8(text) };
}

function request(value: unknown = envelope()): Request {
  return new Request("https://smarttrack.example.invalid/api/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(value),
  });
}

function streamedRequest(chunks: Uint8Array[], headers: Record<string, string> = {}, onCancel?: () => void): Request {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) controller.enqueue(chunks[index++]);
      else controller.close();
    },
    cancel() { onCancel?.(); },
  });
  const init: RequestInit & { duplex: "half" } = {
    method: "POST", body, duplex: "half",
    headers: { "Content-Type": "application/json", ...headers },
  };
  return new Request("https://smarttrack.example.invalid/api/ingest", init);
}

function hasCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof IngestError && error.code === code;
}

test("CRC32 matches IEEE reference vectors, and token hashing is SHA256", () => {
  assert.equal(crc32Utf8(""), "00000000");
  assert.equal(crc32Utf8("123456789"), "cbf43926");
  assert.equal(crc32Utf8("é"), "0e048d3e");
  assert.equal(hashDeviceToken("secret"), "2bb80d537b1da3e38bd30361aa855686bde0eacd7162fef6a25fe97bf527a25b");
});

test("CRC covers the original UTF-8 payload, including whitespace, and accepts uppercase hex", () => {
  const payload = JSON.stringify({ ...fixture, record_id: "test-é" }, null, 2);
  const result = validateIngestEnvelope({ payload, crc32: crc32Utf8(payload).toUpperCase() }, "telemetry");
  assert.equal(result.record_id, "test-é");
  assert.throws(() => validateIngestEnvelope({ payload, crc32: crc32Utf8(JSON.stringify(JSON.parse(payload))) }, "telemetry"), hasCode("crc_mismatch"));
});

test("malformed envelopes, malformed JSON, and lone Unicode surrogates are rejected", () => {
  for (const value of [null, [], {}, { payload: fixture, crc32: "00000000" }, { ...envelope(), extra: true }, { ...envelope(), crc32: "123" }, { payload: "\ud800", crc32: "00000000" }]) {
    assert.throws(() => validateIngestEnvelope(value, "telemetry"), hasCode("invalid_envelope"));
  }
  assert.throws(() => validateIngestEnvelope({ payload: "{", crc32: crc32Utf8("{") }, "telemetry"), hasCode("invalid_json"));
});

test("coordinates and sensor numbers must be finite and GPS must not fabricate a fix", () => {
  for (const gps of [
    { ...fixture.gps, lat: 90.1 }, { ...fixture.gps, lon: -180.1 },
    { ...fixture.gps, lat: Number.NaN }, { ...fixture.gps, lon: Infinity },
    { ...fixture.gps, speed_mps: -1 }, { ...fixture.gps, hdop: Infinity },
    { ...fixture.gps, age_ms: -1 }, { ...fixture.gps, fix: "true" },
    { ...fixture.gps, lat: null }, { ...fixture.gps, fix: false },
  ]) {
    assert.throws(() => validateGps(gps), hasCode("invalid_payload"));
  }
  assert.equal(validateGps({ ...fixture.gps, lat: 90, lon: -180 }).fix, true);
  assert.throws(() => validateDevicePayload({ ...fixture, imu: { accel_mps2: Infinity, gyro_dps: null } }, "telemetry"), hasCode("invalid_payload"));
  const overflow = JSON.stringify(fixture).replace('"lat":0', '"lat":1e400');
  assert.throws(() => validateIngestEnvelope({ payload: overflow, crc32: crc32Utf8(overflow) }, "telemetry"), hasCode("invalid_payload"));
});

test("timestamps allow unsynced null and real zoned calendar times", () => {
  assert.equal(validateRecordedAt(null), null);
  for (const value of ["2024-02-29T23:59:59.123456Z", "2026-01-01T00:00:00+05:30"]) {
    assert.equal(validateRecordedAt(value), value);
  }
  for (const value of [undefined, 42, "", "2025-02-29T12:00:00Z", "2026-02-30T00:00:00Z", "2026-01-01", "2026-01-01T00:00:00", "2026-01-01T24:00:00Z", "2026-01-01T12:00:00+99:00"]) {
    assert.throws(() => validateRecordedAt(value), hasCode("invalid_payload"));
  }
});

test("identifiers are bounded by UTF-8 bytes and counters are safe nonnegative integers", () => {
  assert.equal(validateDevicePayload({ ...fixture, record_id: "é".repeat(64) }, "telemetry").record_id.length, 64);
  for (const record_id of ["", " ", " id", "a".repeat(129), "é".repeat(65), "id\u0000bad", "\ud800"]) {
    assert.throws(() => validateDevicePayload({ ...fixture, record_id }, "telemetry"), hasCode("invalid_payload"));
  }
  for (const field of ["sequence", "uptime_ms"]) {
    for (const value of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1, "42"]) {
      assert.throws(() => validateDevicePayload({ ...fixture, [field]: value }, "telemetry"), hasCode("invalid_payload"));
    }
  }
  const { recorded_at: _unused, ...missingTime } = fixture;
  assert.throws(() => validateDevicePayload(missingTime, "telemetry"), hasCode("invalid_payload"));
  assert.throws(() => validateDevicePayload({ ...fixture, version: 2 }, "telemetry"), hasCode("invalid_payload"));
});

test("SOS works without GPS, timestamps, IMU, or ML evidence", () => {
  const { gps: _gps, imu: _imu, ...identity } = fixture;
  for (const payload of [{ ...identity, event: "sos" }, { ...identity, event: "sos", gps: null }]) {
    const validated = validateIngestEnvelope(envelope(payload), "sos");
    assert.equal(validated.recorded_at, null);
    assert.deepEqual(validated.gps, { fix: false, lat: null, lon: null, speed_mps: null, hdop: null, age_ms: null });
    assert.equal("imu" in validated, false);
  }
  assert.throws(() => validateDevicePayload({ ...identity, event: "alert" }, "sos"), hasCode("invalid_payload"));
  assert.throws(() => validateDevicePayload({ ...identity, event: "sos", gps: { fix: false } }, "sos"), hasCode("invalid_payload"));
});

test("32 KiB is an inclusive streamed-byte limit and oversized streams are cancelled", async () => {
  const exact = Buffer.from(" ".repeat(MAX_INGEST_BODY_BYTES - 2) + "{}");
  assert.deepEqual(await readBoundedJsonBody(streamedRequest([exact.subarray(0, 100), exact.subarray(100)])), {});
  let cancelled = false;
  await assert.rejects(
    readBoundedJsonBody(streamedRequest([exact, Buffer.from(" "), Buffer.from("remaining")], { "Content-Length": "1" }, () => { cancelled = true; })),
    hasCode("body_too_large"),
  );
  assert.equal(cancelled, true);
  // Fewer than 32K characters still exceeds the byte limit when encoded as UTF-8.
  await assert.rejects(readBoundedJsonBody(streamedRequest([Buffer.from(JSON.stringify("é".repeat(17_000)))])), hasCode("body_too_large"));
});

test("body reader rejects malformed UTF-8/JSON, compression, media types, and declared oversize", async () => {
  await assert.rejects(readBoundedJsonBody(streamedRequest([new Uint8Array([0x22, 0xc3, 0x28, 0x22])])), hasCode("invalid_utf8"));
  await assert.rejects(readBoundedJsonBody(streamedRequest([Buffer.from("{")])), hasCode("invalid_json"));
  await assert.rejects(readBoundedJsonBody(streamedRequest([], { "Content-Length": String(MAX_INGEST_BODY_BYTES + 1) })), hasCode("body_too_large"));
  await assert.rejects(readBoundedJsonBody(streamedRequest([], { "Content-Length": "invalid" })), hasCode("invalid_body"));
  await assert.rejects(readBoundedJsonBody(streamedRequest([], { "Content-Type": "text/plain" })), hasCode("unsupported_media_type"));
  await assert.rejects(readBoundedJsonBody(streamedRequest([], { "Content-Encoding": "gzip" })), hasCode("unsupported_encoding"));
  // A multibyte character may be split across transport chunks.
  assert.equal(await readBoundedJsonBody(streamedRequest([new Uint8Array([0x22, 0xc3]), new Uint8Array([0xa9, 0x22])])), "é");
});

test("bearer parser rejects missing, combined, or unbounded credentials", () => {
  assert.equal(parseDeviceBearer("bearer synthetic.token-123_abc"), "synthetic.token-123_abc");
  for (const value of [null, "", "Basic abc", "Bearer ", "Bearer first,Bearer second", "Bearer a b", `Bearer ${"a".repeat(1025)}`]) {
    assert.throws(() => parseDeviceBearer(value), hasCode("unauthorized"));
  }
});

test("unconfigured or non-HTTPS ingestion fails closed without a network call", async () => {
  const neverFetch: typeof fetch = async () => { assert.fail("Unconfigured ingestion must not call the network"); };
  for (const config of [{}, { SUPABASE_URL: env.SUPABASE_URL }, { ...env, SUPABASE_URL: "http://supabase.example.invalid" }, { ...env, SUPABASE_URL: "https://user:password@supabase.example.invalid" }, { ...env, SUPABASE_URL: "https://supabase.example.invalid/path" }]) {
    const response = await handleDeviceIngest(request(), "telemetry", { env: config, fetch: neverFetch });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, "ingest_unavailable");
  }
});

test("invalid authentication or checksum cannot reach storage", async () => {
  let calls = 0;
  const neverFetch: typeof fetch = async () => { calls += 1; throw new Error("Unexpected RPC"); };
  const noAuth = request();
  noAuth.headers.delete("Authorization");
  const unauthorized = await handleDeviceIngest(noAuth, "telemetry", { env, fetch: neverFetch });
  assert.equal(unauthorized.status, 401);
  assert.equal(unauthorized.headers.get("WWW-Authenticate"), "Bearer");
  const corrupt = await handleDeviceIngest(request({ ...envelope(), crc32: "00000000" }), "telemetry", { env, fetch: neverFetch });
  assert.equal(corrupt.status, 400);
  assert.equal(calls, 0);
});

test("real handler sends only the device hash with the service-role RPC and confirms its receipt", async () => {
  let calls = 0;
  const rpc: typeof fetch = async (url, init) => {
    calls += 1;
    assert.equal(String(url), `${env.SUPABASE_URL}/rest/v1/rpc/ingest_device_record`);
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
    assert.equal(headers.get("apikey"), env.SUPABASE_SERVICE_ROLE_KEY);
    assert.deepEqual(JSON.parse(String(init?.body)), { p_token_hash: hashDeviceToken(token), p_payload: fixture, p_kind: "telemetry" });
    assert.equal(String(init?.body).includes(token), false);
    return Response.json({ accepted: true, record_id: fixture.record_id, duplicate: calls > 1, private_field: "not-for-clients" });
  };
  for (const duplicate of [false, true]) {
    const response = await handleDeviceIngest(request(), "telemetry", { env, fetch: rpc });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { accepted: true, record_id: fixture.record_id, duplicate });
  }
  assert.equal(calls, 2, "Every retry must reach the transactional RPC; no in-memory deduplication");
});

test("SOS RPC retains its identity and succeeds with explicitly absent GPS", async () => {
  const { gps: _gps, imu: _imu, ...identity } = fixture;
  const rpc: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.p_kind, "sos");
    assert.equal(body.p_payload.event, "sos");
    assert.equal(body.p_payload.record_id, fixture.record_id);
    assert.equal(body.p_payload.gps.fix, false);
    assert.equal(body.p_payload.gps.lat, null);
    return Response.json({ accepted: true, record_id: fixture.record_id, duplicate: false });
  };
  const response = await handleDeviceIngest(request(envelope({ ...identity, event: "sos" })), "sos", { env, fetch: rpc });
  assert.equal(response.status, 200);
});

test("missing, mismatched, or fabricated storage receipts never acknowledge a record", async () => {
  for (const receipt of [null, [], { accepted: false, record_id: fixture.record_id, duplicate: false }, { accepted: true, record_id: "another-record", duplicate: false }, { accepted: true, record_id: fixture.record_id }, { accepted: true, record_id: fixture.record_id, duplicate: "false" }]) {
    const response = await handleDeviceIngest(request(), "telemetry", { env, fetch: async () => Response.json(receipt) });
    assert.equal(response.status, 502);
    assert.equal("accepted" in await response.json(), false);
  }
  const response = await handleDeviceIngest(request(), "telemetry", { env, fetch: async () => new Response("not-json") });
  assert.equal(response.status, 502);
});

test("RPC rejection, throttling, and outages return retry-safe errors without database details", async () => {
  for (const [code, upstreamStatus, expected] of [["PT401", 401, 401], ["28000", 400, 401], ["PT403", 403, 403], ["PT409", 409, 409], ["PT429", 429, 429], ["PGRST301", 401, 503], ["XX000", 500, 503]] as const) {
    const response = await handleDeviceIngest(request(), "telemetry", {
      env, fetch: async () => Response.json({ code, message: "private database detail" }, { status: upstreamStatus }),
    });
    assert.equal(response.status, expected);
    const text = await response.text();
    assert.equal(text.includes("private database detail"), false);
    assert.equal(text.includes('"accepted":true'), false);
  }
  let calls = 0;
  const response = await handleDeviceIngest(request(), "telemetry", { env, fetch: async () => { calls += 1; throw new Error("synthetic outage"); } });
  assert.equal(response.status, 503);
  assert.equal(calls, 1, "Do not retry an RPC whose commit outcome is unknown");
});
