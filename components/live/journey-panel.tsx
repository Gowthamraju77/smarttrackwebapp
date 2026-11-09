"use client";

import { FeatureFlow } from "@/components/feature-flow";

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AlertCircle, ArrowUpRight, Check, Clock3, Crosshair, LoaderCircle, LocateFixed, MapPin, Play, Plus, RotateCcw, Route, Search, X } from "lucide-react";
import { useJourney } from "./journey-provider";
import { useSectionNavigation } from "../section-transitions";
import { Disclosure } from "./signal-ui";
import styles from "./journey-panel.module.css";

type Endpoint = "start" | "via" | "end";
const endpointNames = { start: "start", via: "via", end: "destination" };
const kilometres = (metres: number) => `${(metres / 1000).toFixed(metres >= 10_000 ? 1 : 2)} km`;
const estimate = (seconds: number) => { const minutes = Math.ceil(seconds / 60); return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} hr ${minutes % 60} min`; };

export function JourneyPanel() {
  const journey = useJourney();
  const navigate = useSectionNavigation();
  const id = useId();
  const [queries, setQueries] = useState({ start: "", via: "", end: "" });
  const [showResults, setShowResults] = useState({ start: false, via: false, end: false });
  const [viaOpen, setViaOpen] = useState(false);
  const viaInput = useRef<HTMLInputElement>(null);
  const viaVisible = viaOpen || journey.via !== null || journey.selecting === "via";
  const fields: Endpoint[] = viaVisible ? ["start", "via", "end"] : ["start", "end"];
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locked = journey.phase === "active" || journey.phase === "armed";
  const hasPlan = journey.start !== null || journey.via !== null || journey.end !== null;
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function lookup(kind: Endpoint, query: string) {
    if (timer.current) clearTimeout(timer.current);
    if (locked || query.trim().length < 3) return;
    setShowResults(previous => ({ ...previous, [kind]: true }));
    void journey.searchPlaces(kind, query);
  }
  function typePlace(kind: Endpoint, query: string) {
    setQueries(previous => ({ ...previous, [kind]: query }));
    setShowResults(previous => ({ ...previous, [kind]: false }));
    if (timer.current) clearTimeout(timer.current);
    if (query.trim().length >= 3) timer.current = setTimeout(() => lookup(kind, query), 500);
  }
  function submit(event: FormEvent, kind: Endpoint) { event.preventDefault(); lookup(kind, queries[kind]); }
  function reset() { if (timer.current) clearTimeout(timer.current); journey.clearPlan(); setQueries({ start: "", via: "", end: "" }); setShowResults({ start: false, via: false, end: false }); setViaOpen(false); }
  function removeVia() {
    if (timer.current) clearTimeout(timer.current);
    journey.clearVia(); setViaOpen(false);
    setQueries(previous => ({ ...previous, via: "" })); setShowResults(previous => ({ ...previous, via: false }));
    requestAnimationFrame(() => document.getElementById(`${id}-add-via`)?.focus());
  }

  return <section className={styles.panel} aria-labelledby={`${id}-title`} data-feature-surface><FeatureFlow offset={1} />
    <div className={styles.header}><span className={styles.headerIcon}><Route size={19} /></span><div className={styles.heading}><p className={styles.kicker}>Places first. Then the path.</p><h2 id={`${id}-title`}>Journey planner</h2></div><span className={styles.phase} data-phase={journey.phase} data-selected={journey.route !== null}>{locked ? "In progress" : journey.route ? "Route selected" : "Plan a route"}</span></div>
    <div className={styles.body}>
      <div className={styles.endpoints} data-via={viaVisible}>
        {fields.map(kind => {
          const point = journey[kind], picking = journey.selecting === kind;
          const results = journey.placeResults[kind], resultsVisible = showResults[kind] && journey.searching !== kind && !locked;
          return <div className={styles.endpointSlot} key={kind} id={`${id}-${kind}-field`}>
            <div className={styles.endpointHeading}><label className={styles.endpointLabel} htmlFor={`${id}-${kind}-search`}><span className={styles.pointBadge} data-end={kind === "end"} data-via={kind === "via"}>{kind === "start" ? "A" : kind === "via" ? "V" : "B"}</span>{kind === "start" ? "Start" : kind === "via" ? "Via (optional)" : "Destination"}</label>{kind === "via" && <button type="button" className={styles.removeVia} onClick={removeVia} disabled={locked}><X size={12} />Remove via</button>}</div>
            <form className={styles.placeSearch} onSubmit={event => submit(event, kind)}>
              <input ref={kind === "via" ? viaInput : undefined} id={`${id}-${kind}-search`} type="search" aria-label={`Search ${endpointNames[kind]} place`} value={queries[kind]} minLength={3} maxLength={120} disabled={locked} autoComplete="off" spellCheck={false}
                placeholder={kind === "start" ? "Where from? Search a place" : kind === "via" ? "Pass through a road or town" : "Where to? Search a place"} onChange={event => typePlace(kind, event.currentTarget.value)} />
              <button type="submit" disabled={locked || queries[kind].trim().length < 3} aria-label={`Search ${endpointNames[kind]}`}>{journey.searching === kind ? <LoaderCircle className={styles.spinner} size={14} /> : <Search size={14} />}</button>
            </form>
            {journey.searching === kind && <p className={styles.searchProgress} role="status">Searching online places…</p>}
            {resultsVisible && results.length > 0 && <ul className={styles.placeResults} aria-label={kind === "start" ? "Start place results" : kind === "via" ? "Via place results" : "Destination place results"}>{results.map(place => <li key={place.id}><button type="button" onClick={() => { if (timer.current) clearTimeout(timer.current); journey.selectPlace(kind, place); setShowResults(previous => ({ ...previous, [kind]: false })); setQueries(previous => ({ ...previous, [kind]: "" })); }}><MapPin size={14} /><span>{place.label}</span></button></li>)}</ul>}
            {resultsVisible && results.length === 0 && !journey.searchError && <p className={styles.searchProgress} role="status">No places found. Add a city or choose on the map.</p>}
            <button className={styles.pointButton} type="button" aria-pressed={picking} disabled={locked} aria-label={`Choose ${endpointNames[kind]} on map`}
              onClick={() => { journey.setSelecting(picking ? null : kind); if (!picking && window.innerWidth < 1051) requestAnimationFrame(() => document.querySelector('[data-map-mode="planning"]')?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "center" })); }}>
              <span className={styles.pointCopy}><span>{point ? "Selected place" : "Or select on map"}</span><strong title={point ? `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}` : undefined}>{point?.label ?? (point ? `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}` : picking ? "Choose a point on the map" : "Choose on map")}</strong></span><Crosshair size={16} />
            </button>
          </div>;
        })}
      </div>
      {!viaVisible && <button id={`${id}-add-via`} className={styles.addVia} type="button" disabled={locked} onClick={() => { setViaOpen(true); requestAnimationFrame(() => viaInput.current?.focus()); }}><Plus size={14} />Add a via place<span>Explore a different way</span></button>}
      <div className={styles.pointTools}><button className={styles.deviceStart} type="button" disabled={!journey.gpsReady || locked} onClick={journey.useDeviceStart}><LocateFixed size={13} />Use device as start</button>{journey.selecting && <button className={styles.deviceStart} type="button" onClick={() => journey.setSelecting(null)}><X size={13} />Cancel selection</button>}</div>
      <p className={styles.searchCredit}>Online place suggestions appear as you type · OpenStreetMap</p>
      {journey.searchError && <p className={styles.searchError} role="alert">{journey.searchError}</p>}
      {journey.routeStatus === "loading" && <div className={styles.routeStatus} role="status"><LoaderCircle className={styles.spinner} size={15} /><p>Finding road routes between your places…</p></div>}
      {journey.routeError && <div className={styles.routeStatus} data-state="error" role="alert"><AlertCircle size={15} /><div><p>{journey.routeError}</p><button className={styles.deviceStart} type="button" onClick={journey.retryRoutes}><RotateCcw size={13} />Retry routes</button></div></div>}
      {journey.routes.length > 0 && journey.start && journey.end && <fieldset className={styles.routeChoices} disabled={locked}>
        <legend>{journey.routes.length === 1 ? "Available road route" : "Choose a road route"}</legend>
        <div className={styles.routeOptions}>{journey.routes.map((option, index) => <label className={styles.routeChoice} key={index} data-selected={journey.selectedRouteIndex === index} data-locked={locked}>
          <input className={styles.routeRadio} type="radio" name={`${id}-route`} checked={journey.selectedRouteIndex === index} aria-label={`Choose route ${index + 1}`} onChange={() => journey.selectRoute(index)} />
          <span className={styles.routeChoiceHeading}><span className={styles.radioMark}>{journey.selectedRouteIndex === index && <Check size={10} />}</span><strong>Route {index + 1}</strong></span>
          <span className={styles.routeChoiceMetrics}><span>{kilometres(option.distanceM)}</span><small><Clock3 size={11} />{estimate(option.durationS)} estimated</small></span>
        </label>)}</div><p className={styles.routeEstimateNote}>{journey.routes.length} road {journey.routes.length === 1 ? "route" : "routes"} found{journey.via ? ` via ${journey.via.label ?? "your chosen point"}` : ""}. The routing service returns up to four suggestions, depending on the roads. {journey.via ? "Change your via place to explore another way." : "Add a via place to explore another way."} Estimated driving times exclude live traffic.</p>
        {!locked && <button type="button" className={styles.deviceStart} onClick={journey.refreshRoutes}><RotateCcw size={13} />Refresh routes</button>}
      </fieldset>}
      <div className={styles.actions}>{locked ? <Link className={styles.primary} href="/navigation">Continue to navigation<ArrowUpRight size={15} /></Link> : <button className={styles.primary} type="button" disabled={!journey.canStart} onClick={() => { journey.startJourney(); navigate("/navigation"); }}><Play size={14} />Start journey</button>}<button className={styles.reset} type="button" onClick={reset} disabled={!hasPlan || locked} aria-label="Reset journey"><RotateCcw size={16} /></button></div>
      <p className={styles.actionHint}>{locked ? "Your chosen route is being monitored in Navigation." : journey.route ? "Ready. Open navigation and begin timing at your start." : "Select both places, then choose one of the returned routes."}</p>
    </div>
    <Disclosure title="Route details" summary="Source and road access"><div className={styles.details}><p className={styles.detailNote}>Search: Photon / OpenStreetMap. Roads: {journey.route?.provider ?? "OSRM / OpenStreetMap"}. Roads are suggested after both places are selected.</p><p className={styles.detailNote}>The nearest accessible road can be up to 500 m from a selected point. Timing uses your start and destination; a via place shapes the road route.</p>{journey.route && <p className={styles.detailNote}>Gap to road: start {journey.route.startSnapDistanceM === undefined ? "unavailable" : `${Math.round(journey.route.startSnapDistanceM)} m`} · destination {journey.route.endSnapDistanceM === undefined ? "unavailable" : `${Math.round(journey.route.endSnapDistanceM)} m`}{journey.via && ` · via ${journey.route.viaSnapDistanceM === undefined ? "unavailable" : `${Math.round(journey.route.viaSnapDistanceM)} m`}`}.</p>}</div></Disclosure>
  </section>;
}
