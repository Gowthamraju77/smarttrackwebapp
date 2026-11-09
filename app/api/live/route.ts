import { createHash, timingSafeEqual } from "node:crypto";
import { isLiveFeed } from "@/lib/live/feed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
const reply = (status: number, error: string) => Response.json({ error }, { status, headers });
const digest = (value: string) => createHash("sha256").update(value).digest();

/** Explicitly shared read-only feed or scoped private access; relay credentials stay server-side. */
export async function GET(request: Request): Promise<Response> {
  const publicFeed = process.env.SMARTTRACK_PUBLIC_LIVE === "1";
  const viewer = process.env.SMARTTRACK_VIEWER_SECRET;
  const relaySecret = process.env.SMARTTRACK_RELAY_SECRET;
  const configuredUrl = process.env.SMARTTRACK_LIVE_RELAY_URL;
  if ((!publicFeed && !viewer) || !relaySecret || !configuredUrl) return reply(503, "The captured-device feed is not configured.");
  const token = request.headers.get("authorization")?.match(/^Bearer ([a-zA-Z0-9_-]{32,256})$/)?.[1];
  if (!publicFeed && (!token || !timingSafeEqual(digest(token), digest(viewer!)))) return reply(401, "Open the private device link to load captured signals.");
  let target: URL;
  try {
    target = new URL(configuredUrl);
    if (target.protocol !== "https:" || target.username || target.password || target.search || target.hash || target.pathname !== "/") throw new Error("Invalid relay");
    target.pathname = "/snapshot";
  } catch { return reply(503, "The captured-device feed is not configured."); }
  try {
    const upstream = await fetch(target, { headers: { Authorization: `Bearer ${relaySecret}`, Accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(7000) });
    if (!upstream.ok || !upstream.body) return reply(503, "The device computer is not currently reachable.");
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let bytes = 0;
    let text = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 512 * 1024) { await reader.cancel(); return reply(502, "The device feed returned an invalid response."); }
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally { reader.releaseLock(); }
    const value: unknown = JSON.parse(text);
    if (!isLiveFeed(value)) return reply(502, "The device feed returned an invalid response.");
    return Response.json(value, { headers });
  } catch { return reply(503, "The device computer is not currently reachable. Last-captured readings remain historical."); }
}
