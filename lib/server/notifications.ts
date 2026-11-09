import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { parseContactSession, type NotificationMode, type NotificationStatus, type ConnectedContact } from "@/lib/notifications";
import { assertSupabaseConfigured, HttpError, supabaseRequest } from "./supabase";

const headers = { "Cache-Control": "private, no-store", Vary: "Authorization" };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const equal = (a: string, b: string) => timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));
const reply = (value: unknown, status = 200) => Response.json(value, { status, headers });
const rpc = <T>(name: string, body: unknown) => supabaseRequest<T>(`rpc/${name}`, { method: "POST", serviceRole: true, body: JSON.stringify(body) });

export function notificationConfiguration() {
  const email = !!(process.env.RESEND_API_KEY && process.env.SMARTTRACK_EMAIL_FROM);
  const sms = !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
  return { email, sms, available: email && sms && (process.env.CRON_SECRET?.length ?? 0) >= 32 };
}

function viewerScope(request: Request) {
  const viewer = process.env.SMARTTRACK_VIEWER_SECRET;
  if (!viewer) throw new HttpError(503, "The device connection service needs setup.");
  const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{32,256})$/)?.[1];
  if (!token || !equal(token, viewer)) throw new HttpError(401, "Open your private device link to sync notifications.");
  return digest(viewer);
}

async function readBody(request: Request): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new HttpError(415, "JSON is required.");
  if (!request.body) throw new HttpError(400, "Contact details are required.");
  const reader = request.body.getReader();
  let size = 0, body = "";
  const decoder = new TextDecoder("utf-8", { fatal: true });
  try {
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
      if (size > 4096) { await reader.cancel(); throw new HttpError(413, "Contact details are too large."); }
      body += decoder.decode(part.value, { stream: true }); }
    return JSON.parse(body + decoder.decode());
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, "Invalid contact details."); }
  finally { reader.releaseLock(); }
}

export async function saveNotificationContact(request: Request): Promise<Response> {
  try {
    // The shared device capability grants scope, not a verified personal identity.
    const scope = viewerScope(request);
    const expected = process.env.APP_ORIGIN || new URL(request.url).origin;
    if (request.headers.get("origin") !== expected || ![null, "same-origin", "none"].includes(request.headers.get("sec-fetch-site"))) throw new HttpError(403, "Open SmartTrack directly to save your settings.");
    assertSupabaseConfigured(true);
    const raw = await readBody(request);
    let contact;
    try { contact = parseContactSession(raw); } catch (error) { throw new HttpError(400, error instanceof Error ? error.message : "Invalid contact."); }
    const state = raw as Record<string, unknown>;
    if (typeof state.clientRevision !== "number" || !Number.isSafeInteger(state.clientRevision) || state.clientRevision < 0 || state.clientRevision > Date.now() + 60_000) throw new HttpError(400, "Check your device clock and retry sync.");
    if (!["general", "journey"].includes(String(state.mode)) || typeof state.connected !== "boolean" || !["usb", "relay", "none"].includes(String(state.source))) throw new HttpError(400, "Invalid connection state.");
    const result = await rpc<{ next_due: string | null; mode: NotificationMode; contacts: ConnectedContact[]; deliveries: NotificationStatus["deliveries"] }>("smarttrack_save_contact", {
      p_scope: scope, p_id: contact.id, p_token_hash: digest(contact.token), p_profile: contact.profile,
      p_preferences: contact.preferences, p_mode: state.mode, p_connected: state.connected, p_source: state.source, p_client_revision: state.clientRevision,
    });
    return reply({ status: { ...notificationConfiguration(), nextDue: result.next_due, mode: result.mode, deliveries: result.deliveries }, contacts: result.contacts });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 503;
    return reply({ error: status === 503 || status === 404 ? "The device connection service needs database setup or is temporarily unavailable. Your last synced schedule may still be active." : error instanceof HttpError ? error.message : "Notification sync is unavailable." }, status);
  }
}

export type DeliveryJob = {
  id: string; channel: "email" | "sms"; mode: NotificationMode; name: string;
  email: string; phone: string; due_at: string; last_seen_at: string; connected: boolean; source: string;
};
type DeliveryResult = { status: "accepted" | "failed" | "uncertain"; provider_id: string | null };

/** One provider attempt per durable job. Ambiguous network outcomes are not retried. */
export async function deliverNotification(job: DeliveryJob): Promise<DeliveryResult> {
  const text = `SmartTrack ${job.mode === "journey" ? "journey" : "general"} check-in for ${job.name}. Scheduled: ${job.due_at}. Last browser report: ${job.last_seen_at} (${job.connected ? "device connected" : "device not connected"}). This is the last reported state, not a current GPS reading. Open SmartTrack for live signals or to change update timing.`;
  let url: string, body: string, requestHeaders: Record<string, string>;
  if (job.channel === "email") {
    url = "https://api.resend.com/emails";
    requestHeaders = { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `smarttrack-${job.id}` };
    body = JSON.stringify({ from: process.env.SMARTTRACK_EMAIL_FROM, to: [job.email], subject: `SmartTrack · ${job.mode === "journey" ? "Journey" : "General"} update`, text });
  } else {
    const account = process.env.TWILIO_ACCOUNT_SID;
    if (!account || !/^AC[a-fA-F0-9]{32}$/.test(account)) return { status: "failed", provider_id: null };
    url = `https://api.twilio.com/2010-04-01/Accounts/${account}/Messages.json`;
    requestHeaders = { Authorization: `Basic ${Buffer.from(`${account}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" };
    body = new URLSearchParams({ From: process.env.TWILIO_FROM_NUMBER ?? "", To: job.phone, Body: text }).toString();
  }
  try {
    const response = await fetch(url, { method: "POST", headers: requestHeaders, body, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000) });
    if (!response.ok) { await response.body?.cancel(); return { status: response.status >= 500 ? "uncertain" : "failed", provider_id: null }; }
    const data = await response.json();
    const id = job.channel === "email" ? data.id : data.sid;
    if (typeof id !== "string" || !id || id.length > 200) return { status: "uncertain", provider_id: null };
    return { status: "accepted", provider_id: id };
  } catch { return { status: "uncertain", provider_id: null }; }
}

export async function dispatchNotifications(request: Request): Promise<Response> {
  try {
    const cron = process.env.CRON_SECRET;
    if (!cron || cron.length < 32) throw new HttpError(503, "Notification scheduler needs setup.");
    const token = request.headers.get("authorization")?.match(/^Bearer (\S{32,256})$/)?.[1];
    if (!token || !equal(token, cron)) throw new HttpError(401, "Scheduler authentication required.");
    const config = notificationConfiguration();
    if (!config.available || !process.env.SMARTTRACK_VIEWER_SECRET) throw new HttpError(503, "Email and SMS delivery need setup.");
    assertSupabaseConfigured(true);
    const jobs = await rpc<DeliveryJob[]>("smarttrack_claim_notifications", { p_scope: digest(process.env.SMARTTRACK_VIEWER_SECRET) });
    const results = await Promise.all(jobs.map(async job => {
      // Recheck cancellation/profile changes just before the external side effect.
      const current = await rpc<boolean>("smarttrack_notification_current", { p_id: job.id });
      if (!current) return "cancelled";
      const result = await deliverNotification(job);
      await rpc("smarttrack_finish_notification", { p_id: job.id, p_status: result.status, p_provider_id: result.provider_id });
      return result.status;
    }));
    return reply({ processed: results.length, accepted: results.filter(status => status === "accepted").length,
      failed: results.filter(status => status === "failed").length, uncertain: results.filter(status => status === "uncertain").length });
  } catch (error) { return reply({ error: error instanceof HttpError ? error.message : "Notification processing is unavailable." }, error instanceof HttpError ? error.status : 503); }
}
