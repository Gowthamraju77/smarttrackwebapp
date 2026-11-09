import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
const compile = path => ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const model = { exports: {} };
new Function("exports", "module", compile("lib/notifications.ts"))(model.exports, model);
const { parseProfile, parsePreferences, parseContactSession, defaultPreferences, NOTIFICATION_INTERVALS } = model.exports;
const profile = { name: "Synthetic Visitor", email: "visitor@example.com", phone: "+12025550123" };
const contact = { id: "11111111-1111-4111-8111-111111111111", token: "a".repeat(64), profile, preferences: defaultPreferences() };
const viewer = "synthetic_viewer_" + "x".repeat(40), cron = "synthetic_cron_" + "x".repeat(40);
class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const environment = { SMARTTRACK_VIEWER_SECRET: viewer, CRON_SECRET: cron, APP_ORIGIN: "https://smarttrack.example", RESEND_API_KEY: "synthetic-resend", SMARTTRACK_EMAIL_FROM: "SmartTrack <updates@example.com>", TWILIO_ACCOUNT_SID: "AC" + "a".repeat(32), TWILIO_AUTH_TOKEN: "synthetic-twilio", TWILIO_FROM_NUMBER: "+12025550100" };
function server({ env = environment, fetch = async () => { throw Error("unexpected provider call"); }, rpc = async () => { throw Error("unexpected database call"); }, configured = true } = {}) {
  const loaded = { exports: {} };
  new Function("exports", "module", "require", "process", "fetch", compile("lib/server/notifications.ts"))(loaded.exports, loaded, name => {
    if (name === "server-only") return {};
    if (name === "@/lib/notifications") return model.exports;
    if (name === "./supabase") return { HttpError, assertSupabaseConfigured: () => { if (!configured) throw new HttpError(503, "missing config"); }, supabaseRequest: rpc };
    return require(name);
  }, { env }, fetch);
  return loaded.exports;
}
function request(body = { ...contact, mode: "general", source: "relay", connected: true, clientRevision: Date.now() }, overrides = {}) {
  return new Request("https://smarttrack.example/api/notifications/contact", { method: "POST", headers: { Origin: "https://smarttrack.example", Authorization: `Bearer ${viewer}`, "Content-Type": "application/json", ...overrides }, body: JSON.stringify(body) });
}
test("normalizes contacts without verification and rejects malformed input", () => {
  assert.deepEqual(parseProfile({ ...profile, name: "  Synthetic   Visitor ", phone: "+1 (202) 555-0123" }), profile);
  for (const value of [{ ...profile, name: " " }, { ...profile, phone: "2025550123" }, { ...profile, email: "x\r\n@example.com" }, { ...profile, name: "x\ny" }]) assert.throws(() => parseProfile(value));
  assert.deepEqual(parseContactSession(contact), contact);
  assert.throws(() => parseContactSession({ ...contact, token: "short" }));
});
test("accepts exactly the seven requested intervals in both independent modes", () => {
  assert.deepEqual(NOTIFICATION_INTERVALS, [20, 30, 60, 180, 300, 600, 1440]);
  for (const minutes of NOTIFICATION_INTERVALS) assert.equal(parsePreferences({ general: { enabled: true, minutes }, journey: { enabled: false, minutes: 30 } }).general.minutes, minutes);
  for (const minutes of [0, -1, 19, 21, 1441, "30", null, 20.1]) assert.throws(() => parsePreferences({ general: { enabled: true, minutes }, journey: { enabled: false, minutes: 30 } }));
});
test("contact endpoint enforces device scope, same origin, content bounds and configuration", async () => {
  const api = server();
  assert.equal((await api.saveNotificationContact(request(undefined, { Authorization: "Bearer bad" }))).status, 401);
  assert.equal((await api.saveNotificationContact(request(undefined, { Origin: "https://other.example" }))).status, 403);
  assert.equal((await api.saveNotificationContact(request(undefined, { "Sec-Fetch-Site": "cross-site" }))).status, 403);
  assert.equal((await api.saveNotificationContact(request({ ...contact, token: "bad" }))).status, 400);
  assert.equal((await api.saveNotificationContact(request({ ...contact, padding: "x".repeat(5000) }))).status, 413);
  assert.equal((await server({ configured: false }).saveNotificationContact(request())).status, 503);
});
test("contact sync hashes capabilities and returns only own delivery state plus sanitized roster", async () => {
  let call;
  const api = server({ rpc: async (path, options) => {
    call = { path, ...options, parsed: JSON.parse(options.body) };
    return { next_due: null, mode: "general", contacts: [{ id: contact.id, name: profile.name }], deliveries: [] };
  } });
  const response = await api.saveNotificationContact(request());
  assert.equal(response.status, 200);
  assert.equal(call.serviceRole, true);
  assert.equal(call.parsed.p_token_hash.length, 64);
  assert.notEqual(call.parsed.p_token_hash, contact.token);
  assert.notEqual(call.parsed.p_scope, viewer);
  const text = await response.text();
  assert.ok(!text.includes(profile.email) && !text.includes(profile.phone) && !text.includes(contact.token));
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
const job = { id: "job-test", channel: "email", mode: "journey", ...profile, due_at: "2026-11-05T12:30:00Z", last_seen_at: "2026-11-05T12:00:00Z", connected: false, source: "none" };
test("email and SMS address the supplied contact and distinguish provider acceptance", async () => {
  const calls = [];
  const api = server({ fetch: async (url, options) => { calls.push({ url, ...options }); return Response.json({ id: "mail-id", sid: "SM-test" }); } });
  assert.equal((await api.deliverNotification(job)).status, "accepted");
  assert.equal((await api.deliverNotification({ ...job, channel: "sms" })).status, "accepted");
  assert.deepEqual(JSON.parse(calls[0].body).to, [profile.email]);
  assert.equal(calls[0].headers["Idempotency-Key"], "smarttrack-job-test");
  assert.equal(new URLSearchParams(calls[1].body).get("To"), profile.phone);
  assert.match(JSON.parse(calls[0].body).text, /last reported state, not a current GPS reading/);
  assert.match(calls[1].url, /^https:\/\/api.twilio.com\//);
});
test("network ambiguity and malformed acceptance are never reported as successful delivery", async () => {
  assert.equal((await server({ fetch: async () => { throw Error("timeout"); } }).deliverNotification(job)).status, "uncertain");
  assert.equal((await server({ fetch: async () => Response.json({}) }).deliverNotification(job)).status, "uncertain");
  assert.equal((await server({ fetch: async () => new Response(null, { status: 400 }) }).deliverNotification(job)).status, "failed");
  assert.equal((await server({ fetch: async () => new Response(null, { status: 503 }) }).deliverNotification(job)).status, "uncertain");
});
test("scheduler requires its own credential and never claims jobs with missing providers", async () => {
  assert.equal((await server().dispatchNotifications(new Request("https://smarttrack.example/api/notifications/dispatch", { headers: { Authorization: `Bearer ${viewer}` } }))).status, 401);
  const response = await server({ env: { ...environment, TWILIO_AUTH_TOKEN: "" } }).dispatchNotifications(new Request("https://smarttrack.example/api/notifications/dispatch", { headers: { Authorization: `Bearer ${cron}` } }));
  assert.equal(response.status, 503);
});
test("scheduler rechecks cancellation and records each actual provider result", async () => {
  const finished = [], providerCalls = [];
  const api = server({ rpc: async (path, options) => {
    const body = JSON.parse(options.body);
    if (path.endsWith("smarttrack_claim_notifications")) return [job, { ...job, id: "cancelled" }];
    if (path.endsWith("smarttrack_notification_current")) return body.p_id !== "cancelled";
    finished.push(body); return null;
  }, fetch: async (...args) => { providerCalls.push(args); return Response.json({ id: "mail-id" }); } });
  const response = await api.dispatchNotifications(new Request("https://smarttrack.example/api/notifications/dispatch", { headers: { Authorization: `Bearer ${cron}` } }));
  assert.equal(response.status, 200);
  assert.equal(providerCalls.length, 1);
  assert.deepEqual(finished, [{ p_id: job.id, p_status: "accepted", p_provider_id: "mail-id" }]);
});
