"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { BellRing, CheckCircle2, X } from "lucide-react";
import Link from "next/link";
import { advanceJourney, emptyJourney, MAX_PLANNED_ROUTES, ROUTE_CORRIDOR_M, validJourneyPoint, validPlannedRoute, type JourneyPoint, type JourneyState, type Place, type PlannedRoute } from "@/lib/live/journey";
import { currentClimatePoint } from "@/lib/live/climate";
import { useLiveTelemetry } from "./live-telemetry-provider";
import styles from "./journey-provider.module.css";

type Endpoint = "start" | "via" | "end";
type Plan = { start: JourneyPoint | null; via: JourneyPoint | null; end: JourneyPoint | null; routes: PlannedRoute[]; selectedRouteIndex: number | null };
type RouteStatus = "idle" | "loading" | "ready" | "error";
type Permission = NotificationPermission | "unsupported";
const EMPTY_PLAN: Plan = { start: null, via: null, end: null, routes: [], selectedRouteIndex: null };
const STORAGE = "smarttrack.journey.tab.v1";
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const finiteTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Date.now() + 2000;
const planKey = (plan: Plan) => JSON.stringify([plan.start, plan.via, plan.end]);

function restore(): { plan: Plan; state: JourneyState } | null {
  try {
    const stored = sessionStorage.getItem(STORAGE);
    if (!stored || stored.length > 2_000_000) return null;
    const raw: unknown = JSON.parse(stored);
    if (!object(raw) || raw.version !== 1 || !object(raw.plan) || !object(raw.state)) return null;
    const p: Record<string, unknown> = { ...raw.plan, via: raw.plan.via ?? null }, s = raw.state;
    if ((p.start !== null && !validJourneyPoint(p.start)) || (p.end !== null && !validJourneyPoint(p.end))
      || (p.via !== null && !validJourneyPoint(p.via))
      || !Array.isArray(p.routes) || p.routes.length > MAX_PLANNED_ROUTES || !p.routes.every(validPlannedRoute)
      || (p.selectedRouteIndex !== null && !(Number.isInteger(p.selectedRouteIndex) && Number(p.selectedRouteIndex) >= 0 && Number(p.selectedRouteIndex) < p.routes.length))) return null;
    if (!["idle", "armed", "active", "finished"].includes(String(s.phase))) return null;
    if (p.routes.length && (!p.start || !p.end)) return null;
    if (s.phase !== "idle" && (!p.start || !p.end || p.selectedRouteIndex === null)) return null;
    if (["active", "finished"].includes(String(s.phase)) && !finiteTime(s.startedAt)) return null;
    if (s.phase === "finished" && (!finiteTime(s.finishedAt) || Number(s.finishedAt) < Number(s.startedAt))) return null;
    return { plan: p as Plan, state: { ...emptyJourney(), phase: s.phase as JourneyState["phase"],
      startedAt: finiteTime(s.startedAt) ? s.startedAt : null, finishedAt: s.phase === "finished" ? Number(s.finishedAt) : null,
      lastGpsAt: finiteTime(s.lastGpsAt) ? s.lastGpsAt : null } };
  } catch { return null; }
}

async function requestJson(url: string, controller: AbortController, body?: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(url, { method: body === undefined ? "GET" : "POST", cache: "no-store", signal: controller.signal,
    credentials: "omit", headers: body === undefined ? {} : { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  if (!response.body) throw new Error("The planning service returned no response.");
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let text = "", size = 0;
  try {
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength;
      if (size > 3_000_000) { await reader.cancel(); throw new Error("This route is too large. Choose a shorter journey."); }
      text += decoder.decode(chunk.value, { stream: true }); }
  } finally { reader.releaseLock(); }
  const raw: unknown = JSON.parse(text + decoder.decode());
  if (!object(raw)) throw new Error("The planning service returned an invalid response.");
  if (!response.ok) throw new Error(typeof raw.error === "string" && raw.error.length < 250 ? raw.error : "Planning is unavailable. Please try again.");
  return raw;
}

function useJourneyState() {
  const { snapshot, status, source, captureEpoch } = useLiveTelemetry();
  const [plan, setPlan] = useState<Plan>(EMPTY_PLAN);
  const [state, setState] = useState<JourneyState>(emptyJourney);
  const [hydrated, setHydrated] = useState(false);
  const [now, setNow] = useState(0);
  const [selecting, pick] = useState<Endpoint | null>(null);
  const [routeStatus, setRouteStatus] = useState<RouteStatus>("idle");
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeAttempt, setRouteAttempt] = useState(0);
  const [placeResults, setPlaceResults] = useState<Record<Endpoint, Place[]>>({ start: [], via: [], end: [] });
  const [searching, setSearching] = useState<Endpoint | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [notificationPermission, setPermission] = useState<Permission>("default");
  const routeRequest = useRef<AbortController | null>(null);
  const searchRequest = useRef<AbortController | null>(null);
  const loadedPlan = useRef<string | null>(null);
  const notified = useRef<string | null>(null);
  const epoch = `${source}:${captureEpoch}`;
  const previousEpoch = useRef(epoch);
  const locked = state.phase === "armed" || state.phase === "active";
  const point = currentClimatePoint(snapshot, status === "connected", hydrated ? Date.now() : 0);
  const receivedAt = point ? snapshot?.gps.receivedAt ?? null : null;
  const route = plan.selectedRouteIndex === null ? null : plan.routes[plan.selectedRouteIndex] ?? null;

  useEffect(() => {
    const saved = restore();
    if (saved) { setPlan(saved.plan); setState(saved.state); if (saved.plan.routes.length) { loadedPlan.current = planKey(saved.plan); setRouteStatus("ready"); } }
    setNow(Date.now()); setPermission("Notification" in window ? Notification.permission : "unsupported"); setHydrated(true);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(timer); routeRequest.current?.abort(); searchRequest.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try { const text = JSON.stringify({ version: 1, plan, state }); if (text.length <= 2_000_000) sessionStorage.setItem(STORAGE, text); else sessionStorage.removeItem(STORAGE); } catch { /* Timing remains available in memory. */ }
  }, [hydrated, plan, state]);

  useEffect(() => {
    if (!hydrated || !plan.start || !plan.end) return;
    const key = planKey(plan); if (loadedPlan.current === key) return;
    const controller = new AbortController(); routeRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    setRouteStatus("loading"); setRouteError(null);
    const coordinates = (p: JourneyPoint) => ({ latitude: p.latitude, longitude: p.longitude });
    void requestJson("/api/journey/routes", controller, { start: coordinates(plan.start), end: coordinates(plan.end), ...(plan.via ? { via: coordinates(plan.via) } : {}) }).then(raw => {
      if (controller.signal.aborted || routeRequest.current !== controller) return;
      if (!Array.isArray(raw.routes) || raw.routes.length < 1 || raw.routes.length > MAX_PLANNED_ROUTES || !raw.routes.every(validPlannedRoute)) throw new Error("The service returned no usable road routes.");
      loadedPlan.current = key;
      setPlan(previous => ({ ...previous, routes: raw.routes as PlannedRoute[], selectedRouteIndex: null })); setRouteStatus("ready");
    }).catch(error => {
      if (routeRequest.current !== controller) return;
      setRouteStatus("error"); setRouteError(controller.signal.aborted ? "The route request timed out. Please retry." : error instanceof Error ? error.message : "Road routing is unavailable.");
    }).finally(() => clearTimeout(timeout));
    return () => { routeRequest.current = null; clearTimeout(timeout); controller.abort(); };
  // Route selection does not trigger another road request.
  }, [hydrated, plan.start, plan.via, plan.end, routeAttempt]);

  useEffect(() => {
    if (!route || !plan.start || !plan.end) return;
    const changed = previousEpoch.current !== epoch; previousEpoch.current = epoch;
    setState(previous => advanceJourney(changed ? advanceJourney(previous, null, route, plan.start!, plan.end!) : previous,
      point && receivedAt !== null ? { point, receivedAt } : null, route, plan.start!, plan.end!));
  }, [route, plan.start, plan.end, point?.latitude, point?.longitude, receivedAt, epoch]);

  useEffect(() => {
    if (!state.notice || state.notice.id === notified.current) return;
    notified.current = state.notice.id;
    if (notificationPermission === "granted" && "Notification" in window) {
      try { new Notification(state.notice.title, { body: state.notice.body, tag: "smarttrack-journey" }); } catch { /* In-page notice remains visible. */ }
    }
  }, [state.notice, notificationPermission]);

  function editPoint(kind: Endpoint, next: JourneyPoint | null) {
    if (locked || (next === null ? kind !== "via" : !validJourneyPoint(next))) return;
    routeRequest.current?.abort(); searchRequest.current?.abort(); searchRequest.current = null;
    setSearching(null); setSearchError(null); loadedPlan.current = null;
    setPlan(previous => ({ ...previous, [kind]: next ? { latitude: next.latitude, longitude: next.longitude, ...(next.label ? { label: next.label } : {}) } : null, routes: [], selectedRouteIndex: null }));
    setState(emptyJourney()); setRouteStatus("idle"); setRouteError(null); pick(null);
  }

  async function searchPlaces(kind: Endpoint, query: string) {
    if (locked) return;
    const value = query.trim();
    if (value.length < 3 || value.length > 120) { setSearchError("Enter a place name with 3 to 120 characters."); return; }
    searchRequest.current?.abort(); const controller = new AbortController(); searchRequest.current = controller;
    const timeout = setTimeout(() => controller.abort(), 13_000);
    setSearching(kind); setSearchError(null); setPlaceResults(previous => ({ ...previous, [kind]: [] }));
    try {
      const raw = await requestJson(`/api/journey/places?q=${encodeURIComponent(value)}`, controller);
      if (controller.signal.aborted || searchRequest.current !== controller) return;
      if (!Array.isArray(raw.places) || raw.places.length > 5 || !raw.places.every(p => object(p) && typeof p.label === "string" && p.label.length <= 700 && typeof p.id === "string" && p.id.length <= 100 && validJourneyPoint(p))) throw new Error("The service returned invalid places.");
      setPlaceResults(previous => ({ ...previous, [kind]: raw.places as Place[] }));
    } catch (error) { if (searchRequest.current === controller) setSearchError(controller.signal.aborted ? "Place search timed out. Please try again." : error instanceof Error ? error.message : "Place search is unavailable."); }
    finally { clearTimeout(timeout); if (searchRequest.current === controller) { searchRequest.current = null; setSearching(null); } }
  }

  return {
    ...plan, hydrated, selecting, setSelecting: (kind: Endpoint | null) => { if (!locked || kind === null) pick(kind); },
    choosePoint: (next: JourneyPoint) => { if (selecting) editPoint(selecting, next); },
    useDeviceStart: () => { const fresh = currentClimatePoint(snapshot, status === "connected", Date.now()); if (fresh) editPoint("start", fresh); },
    selectPlace: (kind: Endpoint, place: Place) => editPoint(kind, place), searchPlaces, placeResults, searching, searchError,
    clearVia: () => {
      if (locked) return;
      if (plan.via) editPoint("via", null);
      else { searchRequest.current?.abort(); searchRequest.current = null; setSearching(null); setSearchError(null); if (selecting === "via") pick(null); }
      setPlaceResults(previous => ({ ...previous, via: [] }));
    },
    selectRoute: (index: number) => { if (!locked && Number.isInteger(index) && plan.routes[index]) { setPlan(previous => ({ ...previous, selectedRouteIndex: index })); setState(emptyJourney()); } },
    route, routeStatus, routeError, phase: state.phase, gpsReady: point !== null, canStart: !!route && routeStatus === "ready" && !locked,
    retryRoutes: () => { if (!locked && plan.start && plan.end && routeStatus === "error") { loadedPlan.current = null; setRouteAttempt(previous => previous + 1); } },
    refreshRoutes: () => { if (!locked && plan.start && plan.end && routeStatus === "ready") { loadedPlan.current = null; setPlan(previous => ({ ...previous, routes: [], selectedRouteIndex: null })); setState(emptyJourney()); setRouteAttempt(previous => previous + 1); } },
    startJourney: () => { if (!locked && route && plan.start && plan.end && routeStatus === "ready") { const fresh = currentClimatePoint(snapshot, status === "connected", Date.now()); pick(null); setState(advanceJourney({ ...emptyJourney(), phase: "armed" }, fresh && snapshot?.gps.receivedAt !== null && snapshot?.gps.receivedAt !== undefined ? { point: fresh, receivedAt: snapshot.gps.receivedAt } : null, route, plan.start, plan.end)); } },
    finishJourney: () => { if (state.phase === "active") setState(previous => ({ ...previous, phase: "finished", finishedAt: Date.now() })); },
    clearPlan: () => { if (state.phase === "active") return; routeRequest.current?.abort(); routeRequest.current = null; searchRequest.current?.abort(); searchRequest.current = null;
      loadedPlan.current = null; setPlan(EMPTY_PLAN); setState(emptyJourney()); pick(null); setRouteStatus("idle"); setRouteError(null); setSearching(null); setSearchError(null); setPlaceResults({ start: [], via: [], end: [] }); },
    elapsedMs: state.startedAt === null ? 0 : Math.max(0, (state.finishedAt ?? now) - state.startedAt),
    deviation: { status: state.deviation, distanceM: state.distanceM, corridorM: ROUTE_CORRIDOR_M }, notice: state.notice,
    notificationPermission, requestNotifications: async () => { if ("Notification" in window) setPermission(await Notification.requestPermission()); else setPermission("unsupported"); },
  };
}

const Context = createContext<ReturnType<typeof useJourneyState> | null>(null);
export function JourneyProvider({ children }: { children: ReactNode }) {
  const journey = useJourneyState();
  const [dismissed, dismiss] = useState<string | null>(null);
  const notice = journey.notice;
  return <Context.Provider value={journey}>{children}
    {notice && notice.id !== dismissed && <aside className={styles.notice} role={notice.kind === "off-route" ? "alert" : "status"} aria-label="Journey notification" data-kind={notice.kind}>
      <span className={styles.icon}>{notice.kind === "arrival" ? <CheckCircle2 size={22} /> : <BellRing size={22} />}</span>
      <div><strong>{notice.title}</strong><p>{notice.body}</p><Link href="/navigation">Open navigation</Link></div>
      <button type="button" aria-label="Dismiss journey notification" onClick={() => dismiss(notice.id)}><X size={17} /></button>
    </aside>}
  </Context.Provider>;
}
export function useJourney() { const value = useContext(Context); if (!value) throw new Error("JourneyProvider is required"); return value; }
