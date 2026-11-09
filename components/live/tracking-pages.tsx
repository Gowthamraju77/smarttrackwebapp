"use client";

import { FeatureFlow } from "@/components/feature-flow";

import Link from "next/link";
import { ArrowUpRight, Bell, Compass, Flag, MapPin, Navigation2, Play, Route, Timer } from "lucide-react";
import { LiveMap } from "./live-map";
import { useLiveTelemetry } from "./live-telemetry-provider";
import { useJourney } from "./journey-provider";
import { JourneyPanel } from "./journey-panel";
import { NotificationSettings } from "@/components/contacts/notification-settings";
import { Disclosure } from "./signal-ui";
import styles from "./tracking-pages.module.css";

function usePosition() {
  const live = useLiveTelemetry();
  const current = live.status === "connected" && live.snapshot?.status === "live" && live.snapshot.gps.fix;
  const positioned = current ? live.snapshot : live.capturedSnapshot?.gps.latitude !== null && live.capturedSnapshot?.gps.latitude !== undefined ? live.capturedSnapshot : live.snapshot;
  return { ...live, positioned, current: !!current };
}
function clock(ms: number) { const seconds = Math.max(0, Math.floor(ms / 1000)); return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(n => String(n).padStart(2, "0")).join(":"); }

export function LiveTrackingPage() {
  const { positioned, points, current } = usePosition();
  return <div className={`${styles.page} ${styles.livePage}`} data-tracking-section="live">
    <header className={styles.heading}><div><p>01 / Live tracking</p><h1>Live map</h1></div><span className={styles.subtle}><Navigation2 size={15} />Position & direction</span></header>
    <div className={styles.liveStage}><LiveMap snapshot={positioned} points={points} connected={current} mode="tracking" showEvidence={false} /></div>
  </div>;
}

export function JourneyPage() {
  const { positioned, points, current } = usePosition();
  const journey = useJourney();
  const stage = !journey.start || !journey.end ? 0 : journey.route === null ? 1 : 2;
  return <div className={styles.page} data-tracking-section="journey">
    <header className={styles.heading}><div><p>02 / Shape your journey</p><h1>Where to next?</h1><span>Find two places. Choose the way between them.</span></div><Link className={styles.sectionLink} href="/navigation">Open navigation<ArrowUpRight size={15} /></Link></header>
    <ol className={styles.flow} aria-label="Journey planning steps">{["Choose places", "Compare routes", "Ready to navigate"].map((label, index) => <li key={label} aria-current={stage === index ? "step" : undefined} data-done={stage > index} data-feature-surface><FeatureFlow /><span>{index === 0 ? <MapPin size={19} /> : index === 1 ? <Route size={19} /> : <Navigation2 size={19} />}</span><div><small>0{index + 1}</small><strong>{label}</strong></div></li>)}</ol>
    <div className={styles.journeyLayout}><JourneyPanel /><div className={styles.planningMap}><LiveMap snapshot={positioned} points={points} connected={current} mode="planning" showEvidence={false} /></div></div>
    <NotificationSettings only="journey" />
  </div>;
}

export function NavigationPage() {
  const { positioned, points, current, snapshot } = usePosition();
  const journey = useJourney();
  const { route, phase, deviation, elapsedMs, gpsReady } = journey;
  const active = phase === "active", armed = phase === "armed", finished = phase === "finished";
  const condition = finished ? "Journey complete" : !gpsReady ? "Waiting for fresh GPS" : armed ? "Approach your starting point" : active && deviation.status === "off-route" ? "Outside the selected route" : active ? "Following your selected route" : "Your route is ready";
  return <div className={styles.page} data-tracking-section="navigation">
    <header className={styles.heading}><div><p>03 / Stay on course</p><h1>Navigation</h1><span>Your chosen route. Your progress, in focus.</span></div><Link className={styles.sectionLink} href="/journeys">{route ? "View journey plan" : "Plan a journey"}<ArrowUpRight size={15} /></Link></header>
    {!route ? <section className={styles.empty} aria-label="Navigation awaiting a route" data-feature-surface><FeatureFlow offset={2} /><div className={styles.emptyCompass} aria-hidden="true"><Compass size={66} strokeWidth={1} /><Navigation2 size={28} /></div><p>Every journey starts with a choice.</p><h2>Choose a route first</h2><span>Set your start and destination in Journey, then select one of the available road routes.</span><Link className={styles.primary} href="/journeys">Plan a journey<ArrowUpRight size={16} /></Link></section>
      : <>
        <section className={styles.guidance} aria-label="Journey navigation" data-phase={phase} data-deviation={deviation.status} data-feature-surface><FeatureFlow offset={1} />
          <div className={styles.guidanceMain}><span className={styles.directionTile}><Navigation2 size={30} strokeWidth={1.5} /></span><div><p>{finished ? "Arrived" : active ? "Journey in progress" : armed ? "Ready when you are" : "Selected road route"}</p><h2 role="status">{condition}</h2><span>{journey.start?.label ?? "Selected start"}{journey.via && <><i>→</i>{journey.via.label ?? "Via point"}</>}<i>→</i>{journey.end?.label ?? "Selected destination"}</span></div></div>
          <div className={styles.navigationMetrics}>
            <div><span><Timer size={13} />Elapsed time</span><output role="timer" aria-label="Journey elapsed time" aria-live="off">{active || finished ? clock(elapsedMs) : armed ? "Waiting" : "Not started"}</output></div>
            <div><span>Route distance</span><strong>{(route.distanceM / 1000).toFixed(2)}<small> km</small></strong></div>
            <div><span>Estimated drive</span><strong>{Math.ceil(route.durationS / 60)}<small> min</small></strong></div>
            <div><span>Live speed</span><strong>{current && snapshot?.gps.speedMps !== null && snapshot?.gps.speedMps !== undefined ? (snapshot.gps.speedMps * 3.6).toFixed(1) : "—"}<small> km/h</small></strong></div>
          </div>
        </section>
        <div className={styles.navigationStage}><LiveMap snapshot={positioned} points={points} connected={current} mode="navigation" showEvidence={false} /></div>
        <div className={styles.navigationActions}><p>{finished ? "Your final journey time is saved in this tab." : !gpsReady && active ? "Timing continues during a GPS interruption. Route checks resume with a fresh fix." : active ? "A sustained route departure triggers an alert." : "Timing begins when fresh GPS reaches your chosen start."}</p>
          {active ? <button className={styles.primary} onClick={journey.finishJourney}><Flag size={15} />Finish journey</button> : armed ? <button className={styles.secondary} onClick={journey.clearPlan}>Cancel waiting</button> : <button className={styles.primary} disabled={!journey.canStart} onClick={journey.startJourney}><Play size={15} />{finished ? "Start again" : "Start journey"}</button>}
        </div>
        <Disclosure title="Navigation details & notifications" summary="Route monitoring and browser alerts"><div className={styles.details}><p>Checks use fresh device GPS with a {deviation.corridorM} m route corridor. Keep this tab open for route monitoring. Drive estimates exclude live traffic.</p><p>{route.provider} · {journey.start?.label ?? "Map start"} → {journey.end?.label ?? "Map destination"}</p>{journey.notificationPermission === "default" ? <button className={styles.secondary} onClick={() => void journey.requestNotifications()}><Bell size={14} />Enable browser notifications</button> : <span>In-page alerts are active. Browser notifications: {journey.notificationPermission === "granted" ? "allowed" : journey.notificationPermission === "denied" ? "blocked in site settings" : "unavailable"}.</span>}</div></Disclosure>
      </>}
    <NotificationSettings only="journey" />
  </div>;
}
