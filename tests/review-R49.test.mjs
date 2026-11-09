import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

// Execute the actual source in memory. No generated files, framework build,
// real environment values, hosted service, or application edits are used.
const root = new URL("../", import.meta.url);
const sourcePath = "lib/server/ingest.ts";
const source = readFileSync(new URL(sourcePath, root), "utf8");
const require = createRequire(import.meta.url);
const exports = {};
vm.runInNewContext(
  ts.transpileModule(source, {
    fileName: sourcePath,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText,
  {
    exports,
    require(name) {
      assert.equal(name, "node:crypto", "Review loader must explicitly approve any new dependency");
      return require(name);
    },
    Buffer, URL, Request, Response, Headers, TextDecoder, TextEncoder, ReadableStream,
    AbortSignal,
    process: { env: {} },
    fetch() { throw new Error("R49 forbids live network access"); },
  },
  { filename: sourcePath },
);
const { handleDeviceIngest, crc32Utf8 } = exports;
const serviceKey = "R49_SYNTHETIC_SERVICE_KEY_ONLY";
const deviceKey = "R49_SYNTHETIC_DEVICE_TOKEN_ONLY";
const internalDetail = "R49_SYNTHETIC_INTERNAL_DATABASE_DETAIL";
const env = {
  SUPABASE_URL: "https://r49-review.invalid",
  SUPABASE_SERVICE_ROLE_KEY: serviceKey,
};
const recordId = "r49-synthetic-record";

function request(kind = "telemetry", overrides = {}) {
  const payload = JSON.stringify({
    version: 1,
    device_id: "r49-synthetic-device",
    record_id: recordId,
    recorded_at: null,
    boot_id: "r49-synthetic-boot",
    sequence: 1,
    uptime_ms: 1,
    gps: { fix: false, lat: null, lon: null, speed_mps: null, hdop: null, age_ms: null },
    ...(kind === "sos" ? { event: "sos" } : { imu: null }),
  });
  return new Request(`https://app.r49.invalid/api/${kind === "sos" ? "sos" : "ingest"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${deviceKey}` },
    body: JSON.stringify({ payload, crc32: crc32Utf8(payload) }),
    ...overrides,
  });
}

async function assertSafeResponse(response, status) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("vary"), "Authorization");
  const text = await response.text();
  const visible = text + JSON.stringify([...response.headers.entries()]);
  for (const marker of [serviceKey, deviceKey, internalDetail]) {
    assert.ok(!visible.includes(marker), `Response exposed synthetic marker ${marker}`);
  }
  const result = JSON.parse(text);
  if (status >= 400) {
    assert.deepEqual(Object.keys(result).sort(), ["error", "message"]);
    assert.equal(typeof result.error, "string");
    assert.equal(typeof result.message, "string");
  }
  return result;
}

function abortQuickly(t) {
  const requestedTimeouts = [];
  t.mock.method(AbortSignal, "timeout", (milliseconds) => {
    requestedTimeouts.push(milliseconds);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(internalDetail)), 10);
    t.after(() => clearTimeout(timer));
    return controller.signal;
  });
  t.after(() => assert.deepEqual(requestedTimeouts, [10_000]));
}

test("R49 snapshot identity", (t) => {
  assert.equal(typeof handleDeviceIngest, "function");
  t.diagnostic(`${sourcePath} SHA256 ${createHash("sha256").update(source).digest("hex")}`);
});

test("R49 missing configuration fails closed before network or authentication", async () => {
  let calls = 0;
  const missing = [
    {},
    { SUPABASE_URL: env.SUPABASE_URL },
    { SUPABASE_SERVICE_ROLE_KEY: serviceKey },
    { ...env, SUPABASE_SERVICE_ROLE_KEY: "" },
    { ...env, SUPABASE_SERVICE_ROLE_KEY: "   " },
  ];
  for (const kind of ["telemetry", "sos"]) {
    for (const configuration of missing) {
      const response = await handleDeviceIngest(request(kind, { headers: { "Content-Type": "application/json" } }), kind, {
        env: configuration,
        fetch: async () => { calls++; throw new Error(internalDetail); },
      });
      const result = await assertSafeResponse(response, 503);
      assert.equal(result.error, "ingest_unavailable");
    }
  }
  assert.equal(calls, 0);
});

test("R49 malformed environment fails closed without leaking credentials or making a request", async () => {
  let calls = 0;
  const invalidUrls = [
    "http://r49-review.invalid", "not a URL",
    `https://${deviceKey}:${serviceKey}@r49-review.invalid`,
    `https://r49-review.invalid?token=${serviceKey}`,
    `https://r49-review.invalid#${serviceKey}`,
    "https://r49-review.invalid/unexpected-path",
  ];
  const configurations = invalidUrls.map((SUPABASE_URL) => ({ ...env, SUPABASE_URL }));
  configurations.push({ ...env, SUPABASE_SERVICE_ROLE_KEY: "invalid key" });
  configurations.push({ ...env, SUPABASE_SERVICE_ROLE_KEY: "x".repeat(8193) });
  for (const configuration of configurations) {
    const response = await handleDeviceIngest(request(), "telemetry", {
      env: configuration,
      fetch: async () => { calls++; throw new Error(internalDetail); },
    });
    await assertSafeResponse(response, 503);
  }
  assert.equal(calls, 0);
});

test("R49 missing/invalid device bearer is redacted and prevents upstream access", async () => {
  let calls = 0;
  for (const authorization of [null, "", `Basic ${deviceKey}`, `Bearer ${deviceKey} invalid`]) {
    const headers = { "Content-Type": "application/json" };
    if (authorization !== null) headers.Authorization = authorization;
    const response = await handleDeviceIngest(request("telemetry", { headers }), "telemetry", {
      env,
      fetch: async () => { calls++; throw new Error(internalDetail); },
    });
    await assertSafeResponse(response, 401);
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
  }
  assert.equal(calls, 0);
});

test("R49 network/TLS exceptions cannot expose upstream diagnostic details", async () => {
  for (const kind of ["telemetry", "sos"]) {
    const response = await handleDeviceIngest(request(kind), kind, {
      env,
      fetch: async () => { throw new Error(`${internalDetail} ${serviceKey} ${deviceKey}`); },
    });
    const result = await assertSafeResponse(response, 503);
    assert.equal(result.error, "ingest_unavailable");
  }
});

test("R49 hanging upstream connection observes a bounded abort and returns a redacted failure", async (t) => {
  abortQuickly(t);
  const response = await handleDeviceIngest(request(), "telemetry", {
    env,
    fetch: async (_url, options) => new Promise((resolve, reject) => {
      assert.ok(options.signal instanceof AbortSignal);
      options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true });
    }),
  });
  await assertSafeResponse(response, 503);
});

test("R49 abort while reading upstream response body cannot become an accepted receipt", async (t) => {
  abortQuickly(t);
  const response = await handleDeviceIngest(request(), "telemetry", {
    env,
    fetch: async (_url, options) => new Response(new ReadableStream({
      start(controller) {
        options.signal.addEventListener("abort", () => controller.error(new Error(internalDetail)), { once: true });
      },
    }), { status: 200 }),
  });
  const result = await assertSafeResponse(response, 502);
  assert.equal(result.error, "invalid_receipt");
});

test("R49 known upstream error codes map to public messages, with no body/header passthrough", async () => {
  const mappings = [
    ["PT401", 401], ["28000", 401], ["28P01", 401],
    ["PT403", 403], ["42501", 403],
    ["PT409", 409], ["23505", 409], ["PT429", 429],
    ["22023", 422], ["22007", 422], ["22008", 422],
    ["XX000", 503],
  ];
  for (const [code, expectedStatus] of mappings) {
    const response = await handleDeviceIngest(request(), "telemetry", {
      env,
      fetch: async () => Response.json({ code, message: internalDetail, details: serviceKey, hint: deviceKey }, {
        status: 400,
        headers: { "x-debug-detail": internalDetail, "set-cookie": serviceKey },
      }),
    });
    await assertSafeResponse(response, expectedStatus);
    assert.equal(response.headers.get("x-debug-detail"), null);
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("R49 service-role rejection and rate limiting remain closed and sanitized", async () => {
  for (const [status, expected] of [[401, 503], [403, 503], [429, 429], [500, 503], [503, 503]]) {
    const response = await handleDeviceIngest(request(), "telemetry", {
      env,
      fetch: async () => Response.json({ message: internalDetail, secret: serviceKey, token: deviceKey }, { status }),
    });
    await assertSafeResponse(response, expected);
  }
});

test("R49 malformed and oversized upstream bodies are rejected without echo", async () => {
  for (const status of [200, 500]) {
    for (const text of [`<html>${internalDetail} ${serviceKey} ${deviceKey}</html>`, "x".repeat(32 * 1024 + 1)]) {
      const response = await handleDeviceIngest(request(), "telemetry", {
        env,
        fetch: async () => new Response(text, { status }),
      });
      await assertSafeResponse(response, status === 200 ? 502 : 503);
    }
  }
});

test("R49 successful receipt allowlists fields and the device token is only sent as a hash", async () => {
  for (const kind of ["telemetry", "sos"]) {
    let called = false;
    const response = await handleDeviceIngest(request(kind), kind, {
      env,
      fetch: async (url, options) => {
        called = true;
        assert.equal(url, `${env.SUPABASE_URL}/rest/v1/rpc/ingest_device_record`);
        assert.equal(options.redirect, "error");
        assert.equal(options.cache, "no-store");
        assert.equal(options.headers.apikey, serviceKey);
        assert.equal(options.headers.Authorization, `Bearer ${serviceKey}`);
        assert.ok(!options.body.includes(deviceKey));
        assert.equal(JSON.parse(options.body).p_token_hash, createHash("sha256").update(deviceKey).digest("hex"));
        return Response.json({ accepted: true, record_id: recordId, duplicate: false, debug: internalDetail, service_key: serviceKey, device_token: deviceKey });
      },
    });
    assert.equal(called, true);
    assert.deepEqual(await assertSafeResponse(response, 200), { accepted: true, record_id: recordId, duplicate: false });
  }
});

test("R49 malformed incoming JSON and request-body read errors are redacted", async () => {
  let calls = 0;
  const bodies = [
    { body: `not-json ${internalDetail} ${serviceKey} ${deviceKey}` },
    { body: new ReadableStream({ start(controller) { controller.error(new Error(internalDetail)); } }), duplex: "half" },
  ];
  for (const overrides of bodies) {
    const response = await handleDeviceIngest(request("telemetry", overrides), "telemetry", {
      env,
      fetch: async () => { calls++; throw new Error(internalDetail); },
    });
    await assertSafeResponse(response, 400);
  }
  assert.equal(calls, 0);
});

test("R49 remaining shared-helper/operations behavioral review", (t) => {
  const pending = [
    "lib/server/security.ts", "lib/server/supabase.ts", "lib/server/operations.ts",
    "app/api/devices/route.ts", "app/api/journeys/route.ts", "app/api/alerts/route.ts", "app/api/sos/[id]/route.ts",
  ];
  const missing = pending.filter((path) => !existsSync(new URL(path, root)));
  t.skip(missing.length
    ? `BLOCKED: implementation not present: ${missing.join(", ")}`
    : "BLOCKED: newly available shared helpers/operations require source-specific behavioral review; file presence is not a security pass");
});
