"use client";

import { useEffect, useId, useMemo, useReducer, useState, type KeyboardEvent } from "react";
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  CircleStop,
  Clock3,
  FileClock,
  Flag,
  Keyboard,
  MapPin,
  Navigation,
  Pause,
  Play,
  RotateCcw,
  Route,
  Search,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Truck,
  X,
} from "lucide-react";
import styles from "./journeys-view.module.css";

type JourneyStatus = "completed" | "interrupted";
type StatusFilter = "all" | JourneyStatus;
type SortOrder = "newest" | "oldest" | "distance";
type Point = readonly [number, number];
type JourneyEvent = { at: number; title: string; detail: string; pause?: boolean };
type Journey = {
  id: string;
  name: string;
  date: string;
  startMinute: number;
  duration: number;
  distance: number;
  device: string;
  mode: "Cycle" | "Drive" | "Walk";
  from: string;
  to: string;
  status: JourneyStatus;
  points: readonly Point[];
  events: readonly JourneyEvent[];
};

// These are local UI fixtures. Points are arbitrary SVG drawing units, not GPS coordinates.
const DEMO_JOURNEYS: readonly Journey[] = [
  {
    id: "JRN-D1048", name: "Harbor loop", date: "2026-10-10", startMinute: 490,
    duration: 42, distance: 8.6, device: "DEMO-01", mode: "Cycle",
    from: "Depot A", to: "Harbor checkpoint", status: "completed",
    points: [[48, 190], [116, 170], [170, 190], [238, 125], [310, 136], [379, 77], [459, 100], [548, 62]],
    events: [
      { at: 0, title: "Departure from Depot A", detail: "The synthetic journey begins at its first drawing point." },
      { at: 28, title: "Canal checkpoint", detail: "A sample check-in along the illustrative route." },
      { at: 48, title: "Short stop", detail: "A planned pause in this demo itinerary.", pause: true },
      { at: 62, title: "Journey resumed", detail: "The sample route continues toward the harbor." },
      { at: 100, title: "Harbor checkpoint reached", detail: "End of the completed fixture; no delivery receipt is implied." },
    ],
  },
  {
    id: "JRN-D1047", name: "North depot transfer", date: "2026-10-10", startMinute: 435,
    duration: 64, distance: 24.8, device: "DEMO-02", mode: "Drive",
    from: "Depot B", to: "North depot", status: "completed",
    points: [[48, 185], [100, 142], [183, 151], [237, 94], [324, 105], [390, 60], [467, 80], [548, 55]],
    events: [
      { at: 0, title: "Departure from Depot B", detail: "Start of the synthetic transfer itinerary." },
      { at: 34, title: "Mid-route checkpoint", detail: "A fixture waypoint for reviewing the journey timeline." },
      { at: 71, title: "North approach", detail: "The route enters its final illustrative segment." },
      { at: 100, title: "North depot reached", detail: "This completed sample ends here." },
    ],
  },
  {
    id: "JRN-D1046", name: "Garden district round", date: "2026-10-09", startMinute: 945,
    duration: 26, distance: 2.1, device: "DEMO-03", mode: "Walk",
    from: "Garden hub", to: "West checkpoint", status: "interrupted",
    points: [[48, 188], [115, 156], [170, 181], [237, 150], [275, 91], [370, 110], [430, 69], [548, 98]],
    events: [
      { at: 0, title: "Departure from Garden hub", detail: "Beginning of this synthetic walking itinerary." },
      { at: 39, title: "Garden checkpoint", detail: "A demo checkpoint included for timeline navigation." },
      { at: 74, title: "Journey paused", detail: "The fixture pauses before its intended destination.", pause: true },
      { at: 100, title: "Sample ended early", detail: "Only the available sample is replayed. Arrival is not recorded." },
    ],
  },
  {
    id: "JRN-D1045", name: "Riverside collection", date: "2026-10-09", startMinute: 670,
    duration: 38, distance: 7.4, device: "DEMO-01", mode: "Cycle",
    from: "Riverside hub", to: "Depot A", status: "completed",
    points: [[48, 187], [120, 200], [177, 141], [265, 158], [336, 95], [408, 126], [470, 65], [548, 76]],
    events: [
      { at: 0, title: "Departure from Riverside hub", detail: "First point of this local demo fixture." },
      { at: 32, title: "Riverside checkpoint", detail: "A synthetic check-in with no associated sensor readings." },
      { at: 67, title: "Depot approach", detail: "The illustrative route turns toward its endpoint." },
      { at: 100, title: "Depot A reached", detail: "End of this completed journey sample." },
    ],
  },
  {
    id: "JRN-D1044", name: "East hub connection", date: "2026-10-09", startMinute: 510,
    duration: 51, distance: 18.2, device: "DEMO-02", mode: "Drive",
    from: "North depot", to: "East hub", status: "completed",
    points: [[48, 184], [120, 123], [191, 143], [260, 92], [319, 119], [396, 74], [475, 111], [548, 57]],
    events: [
      { at: 0, title: "Departure from North depot", detail: "Start of the fictional connection between two demo hubs." },
      { at: 41, title: "Hub checkpoint", detail: "A sample waypoint on the schematic." },
      { at: 64, title: "Short stop", detail: "A pause included in this demo itinerary.", pause: true },
      { at: 78, title: "Journey resumed", detail: "The synthetic journey continues to East hub." },
      { at: 100, title: "East hub reached", detail: "Final point of the completed sample." },
    ],
  },
  {
    id: "JRN-D1043", name: "West checkpoint visit", date: "2026-10-08", startMinute: 880,
    duration: 33, distance: 2.7, device: "DEMO-03", mode: "Walk",
    from: "Garden hub", to: "West checkpoint", status: "completed",
    points: [[48, 181], [127, 185], [170, 126], [250, 144], [318, 88], [395, 114], [470, 82], [548, 66]],
    events: [
      { at: 0, title: "Departure from Garden hub", detail: "First point of this synthetic walking route." },
      { at: 46, title: "Garden crossing", detail: "An illustrative checkpoint, not a mapped road crossing." },
      { at: 100, title: "West checkpoint reached", detail: "The completed fixture ends at its destination." },
    ],
  },
  {
    id: "JRN-D1042", name: "South depot run", date: "2026-10-08", startMinute: 610,
    duration: 29, distance: 9.3, device: "DEMO-02", mode: "Drive",
    from: "East hub", to: "South depot", status: "interrupted",
    points: [[48, 187], [127, 169], [186, 184], [261, 113], [332, 141], [409, 89], [472, 102], [548, 60]],
    events: [
      { at: 0, title: "Departure from East hub", detail: "This demo itinerary was intended for South depot." },
      { at: 44, title: "Intermediate checkpoint", detail: "A synthetic point recorded before the sample ends." },
      { at: 100, title: "Sample ended early", detail: "The endpoint marks the end of the sample, not an arrival." },
    ],
  },
  {
    id: "JRN-D1041", name: "Morning depot loop", date: "2026-10-08", startMinute: 465,
    duration: 46, distance: 9.8, device: "DEMO-01", mode: "Cycle",
    from: "Depot A", to: "Depot B", status: "completed",
    points: [[48, 191], [113, 137], [193, 156], [263, 103], [339, 128], [401, 72], [477, 88], [548, 55]],
    events: [
      { at: 0, title: "Departure from Depot A", detail: "Start of the morning sample itinerary." },
      { at: 31, title: "First checkpoint", detail: "A fictional waypoint for reviewing route progress." },
      { at: 68, title: "Second checkpoint", detail: "The fixture continues toward Depot B." },
      { at: 100, title: "Depot B reached", detail: "Final point of this local demo journey." },
    ],
  },
];

const STATUS_LABELS: Record<JourneyStatus, string> = { completed: "Completed", interrupted: "Ended early" };
const DEMO_DEVICES = Array.from(new Set(DEMO_JOURNEYS.map((journey) => journey.device)));
const PLAYBACK_DURATION_MS = 24_000;
const TICK_MS = 100;
type PlaybackState = { position: number; playing: boolean; rate: 1 | 2 | 4 };
type PlaybackAction =
  | { type: "toggle" }
  | { type: "tick" }
  | { type: "seek"; position: number }
  | { type: "rate"; rate: PlaybackState["rate"] }
  | { type: "reset" };
const INITIAL_PLAYBACK: PlaybackState = { position: 0, playing: false, rate: 1 };

function playbackReducer(state: PlaybackState, action: PlaybackAction): PlaybackState {
  switch (action.type) {
    case "toggle":
      return { ...state, position: state.position >= 100 ? 0 : state.position, playing: !state.playing };
    case "tick": {
      if (!state.playing) return state;
      const position = Math.min(100, state.position + (TICK_MS / PLAYBACK_DURATION_MS) * 100 * state.rate);
      return { ...state, position, playing: position < 100 };
    }
    case "seek":
      return { ...state, position: Math.max(0, Math.min(100, action.position)), playing: false };
    case "rate":
      return { ...state, rate: action.rate };
    case "reset":
      return INITIAL_PLAYBACK;
  }
}

function formatTime(minutes: number): string {
  return `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
}

function formatDuration(minutes: number): string {
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${day} ${months[month - 1]} ${year}`;
}

function timeAt(journey: Journey, position: number): string {
  return formatTime(journey.startMinute + Math.round((journey.duration * position) / 100));
}

function getVisibleJourneys(query: string, status: StatusFilter, device: string, sort: SortOrder): Journey[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return DEMO_JOURNEYS.filter((journey) => {
    const text = `${journey.id} ${journey.name} ${journey.from} ${journey.to} ${journey.device} ${journey.mode} ${STATUS_LABELS[journey.status]} ${journey.date} ${formatDate(journey.date)}`.toLowerCase();
    return (status === "all" || journey.status === status)
      && (device === "all" || journey.device === device)
      && terms.every((term) => text.includes(term));
  }).sort((a, b) => {
    if (sort === "distance") return b.distance - a.distance;
    const chronological = a.date.localeCompare(b.date) || a.startMinute - b.startMinute;
    return sort === "oldest" ? chronological : -chronological;
  });
}

function pointAt(points: readonly Point[], position: number): Point {
  if (position <= 0) return points[0];
  if (position >= 100) return points[points.length - 1];
  const lengths = points.slice(1).map((point, index) => Math.hypot(point[0] - points[index][0], point[1] - points[index][1]));
  let remaining = lengths.reduce((sum, length) => sum + length, 0) * position / 100;
  for (let index = 0; index < lengths.length; index += 1) {
    if (remaining <= lengths[index] && lengths[index] > 0) {
      const fraction = remaining / lengths[index];
      return [points[index][0] + (points[index + 1][0] - points[index][0]) * fraction,
        points[index][1] + (points[index + 1][1] - points[index][1]) * fraction];
    }
    remaining -= lengths[index];
  }
  return points[points.length - 1];
}

function StatusBadge({ status }: { status: JourneyStatus }) {
  const Icon = status === "completed" ? CheckCircle2 : CircleStop;
  return <span className={`${styles.statusBadge} ${status === "completed" ? styles.completed : styles.interrupted}`}><Icon size={12} aria-hidden="true" />{STATUS_LABELS[status]}</span>;
}

function JourneyDetails({ journey, detailId }: { journey: Journey; detailId: string }) {
  const id = useId();
  const [playback, dispatch] = useReducer(playbackReducer, INITIAL_PLAYBACK);
  const { position, playing, rate } = playback;
  const marker = pointAt(journey.points, position);
  const path = journey.points.map((point, index) => `${index ? "L" : "M"}${point[0]} ${point[1]}`).join(" ");
  const currentEventIndex = journey.events.reduce((current, event, index) => event.at <= position ? index : current, 0);
  const playbackLabel = playing ? "Playing" : position >= 100 ? "Replay finished" : position > 0 ? "Paused" : "Ready to replay";
  const startPoint = journey.points[0];
  const endPoint = journey.points[journey.points.length - 1];

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => dispatch({ type: "tick" }), TICK_MS);
    return () => window.clearInterval(timer);
  }, [playing]);

  function handlePlaybackKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    // Native controls retain their own keyboard behavior, including the range slider.
    if (target.closest("button, input, select, textarea, a") || target.isContentEditable) return;
    const key = event.key.toLowerCase();
    if (key === " " || key === "k") {
      event.preventDefault();
      if (!event.repeat) dispatch({ type: "toggle" });
    } else if (key === "arrowleft" || key === "arrowright") {
      event.preventDefault();
      dispatch({ type: "seek", position: position + (key === "arrowright" ? 5 : -5) });
    } else if (key === "home" || key === "end") {
      event.preventDefault();
      dispatch({ type: "seek", position: key === "home" ? 0 : 100 });
    } else if (key === "r") {
      event.preventDefault();
      dispatch({ type: "reset" });
    }
  }

  return (
    <section className={styles.detailPanel} id={detailId} aria-labelledby={`${id}-heading`}>
      <div className={styles.detailHeader}>
        <div><p className={styles.eyebrow}>Selected journey · {journey.id}</p><h2 id={`${id}-heading`}>{journey.name}</h2></div>
        <StatusBadge status={journey.status} />
      </div>
      <p className={styles.detailMeta}>{formatDate(journey.date)} <span>·</span> {formatTime(journey.startMinute)}–{timeAt(journey, 100)} UTC <span>·</span> {journey.device}</p>
      <div className={styles.routeEndpoints}>
        <span><span className={styles.originDot} />{journey.from}</span><ArrowRight size={16} aria-hidden="true" /><span><MapPin size={15} aria-hidden="true" />{journey.to}</span>
      </div>
      {journey.status === "interrupted" && <p className={styles.earlyNotice}>This sample ended before its destination. Playback stops at the last synthetic point.</p>}

      <div className={styles.playbackRegion} role="region" tabIndex={0} aria-label="Synthetic route playback" aria-describedby={`${id}-keys`} aria-keyshortcuts="Space K ArrowLeft ArrowRight Home End R" onKeyDown={handlePlaybackKey}>
        <figure className={styles.routeFigure}>
          <div className={styles.routeCanvas}>
            <div className={styles.canvasTop}><span className={styles.canvasBadge}><Route size={12} aria-hidden="true" /> Demo replay</span><span>Schematic · not to scale</span></div>
            <svg className={styles.routeSvg} viewBox="0 0 600 250" role="img" aria-labelledby={`${id}-route-title ${id}-route-desc`}>
              <title id={`${id}-route-title`}>{`Synthetic route for ${journey.name}`}</title>
              <desc id={`${id}-route-desc`}>An illustrative path in arbitrary drawing coordinates, not a geographic map. The replay marker follows the sample path.</desc>
              <defs><pattern id={`${id}-grid`} width="28" height="28" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" fill="currentColor" /></pattern></defs>
              <rect width="600" height="250" fill={`url(#${id}-grid)`} className={styles.diagramGrid} />
              <path d={path} className={styles.routeUnderlay} />
              <path d={path} className={styles.routeTrack} />
              {position > 0 && <path d={path} pathLength={100} strokeDasharray={`${position} 100`} className={styles.routeProgress} />}
              {journey.events.slice(1, -1).map((event) => {
                const point = pointAt(journey.points, event.at);
                return <circle key={event.at} cx={point[0]} cy={point[1]} r="4" className={event.at <= position ? styles.visitedPoint : styles.routePoint} />;
              })}
              <circle cx={startPoint[0]} cy={startPoint[1]} r="7" className={styles.endpoint} />
              <text x={startPoint[0]} y={startPoint[1] + 25} className={styles.diagramLabel}>Start</text>
              <circle cx={endPoint[0]} cy={endPoint[1]} r="7" className={styles.endpoint} />
              <text x={endPoint[0]} y={endPoint[1] - 20} textAnchor="end" className={styles.diagramLabel}>{journey.status === "completed" ? "Finish" : "Sample ends"}</text>
              <circle cx={marker[0]} cy={marker[1]} r="16" className={styles.markerHalo} />
              <circle cx={marker[0]} cy={marker[1]} r="8" className={styles.marker} />
            </svg>
            <div className={styles.canvasBottom}><span><i />Replayed path</span><span>{Math.floor(position)}% explored</span></div>
          </div>
          <figcaption>Synthetic route illustration, not a road map. All locations, times, and distances are demo fixtures.</figcaption>
        </figure>

        <div className={styles.playbackControls}>
          <div className={styles.scrubberLabels}><label htmlFor={`${id}-progress`}>Replay progress</label><span>{timeAt(journey, position)} <span className={styles.muted}>/ {timeAt(journey, 100)} UTC</span></span></div>
          <input className={styles.scrubber} id={`${id}-progress`} type="range" min={0} max={100} step={1} value={position} aria-valuetext={`${Math.floor(position)} percent, demo time ${timeAt(journey, position)} UTC`} onChange={(event) => dispatch({ type: "seek", position: Number(event.target.value) })} />
          <div className={styles.transportRow}>
            <div className={styles.transportButtons}>
              <button className={styles.iconButton} type="button" aria-label="Seek backward 10 percent" disabled={position <= 0} onClick={() => dispatch({ type: "seek", position: position - 10 })}><SkipBack size={16} aria-hidden="true" /></button>
              <button className={styles.playButton} type="button" onClick={() => dispatch({ type: "toggle" })}>{playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}{playing ? "Pause" : position >= 100 ? "Replay" : "Play route"}</button>
              <button className={styles.iconButton} type="button" aria-label="Seek forward 10 percent" disabled={position >= 100} onClick={() => dispatch({ type: "seek", position: position + 10 })}><SkipForward size={16} aria-hidden="true" /></button>
            </div>
            <div className={styles.playbackOptions}>
              <label className={styles.rateLabel}>Speed<select value={rate} onChange={(event) => dispatch({ type: "rate", rate: Number(event.target.value) as PlaybackState["rate"] })}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
              <button className={styles.resetButton} type="button" aria-label="Reset playback and speed" onClick={() => dispatch({ type: "reset" })}><RotateCcw size={14} aria-hidden="true" />Reset</button>
            </div>
          </div>
          <div className={styles.playbackStatus}><span role="status"><span className={playing ? styles.playingDot : styles.idleDot} />{playbackLabel}</span><span>24-second demo at 1×</span></div>
        </div>
        <p className={styles.keyboardHelp} id={`${id}-keys`}><Keyboard size={15} aria-hidden="true" /><span>Focus the replay area: <kbd>Space</kbd> play / pause, <kbd>←</kbd> <kbd>→</kbd> seek 5%, <kbd>Home</kbd> / <kbd>End</kbd> start / finish, <kbd>R</kbd> reset. Seeking pauses playback.</span></p>
      </div>

      <dl className={styles.detailMetrics}>
        <div><dt>Sample distance</dt><dd>{journey.distance.toFixed(1)} <small>km</small></dd></div>
        <div><dt>Sample duration</dt><dd>{formatDuration(journey.duration)}</dd></div>
        <div><dt>Journey mode</dt><dd>{journey.mode}</dd></div>
      </dl>

      <div className={styles.timelineHeader}><div><p className={styles.eyebrow}>Step by step</p><h3>Journey timeline</h3></div><span>{journey.events.length} demo events</span></div>
      <p className={styles.timelineHelp}>Select an event to pause and inspect that point in the replay.</p>
      <ol className={styles.timeline} aria-label="Demo journey events">
        {journey.events.map((event, index) => {
          const active = currentEventIndex === index;
          const reached = event.at <= position;
          const Icon = index === 0 ? Navigation : index === journey.events.length - 1 ? Flag : event.pause ? Pause : MapPin;
          return <li key={event.at} className={reached ? styles.timelineReached : undefined}>
            <button className={`${styles.timelineEvent} ${active ? styles.timelineActive : ""}`} type="button" aria-current={active ? "step" : undefined} onClick={() => dispatch({ type: "seek", position: event.at })}>
              <span className={styles.timelineIcon}><Icon size={15} aria-hidden="true" /></span>
              <span className={styles.eventCopy}><strong>{event.title}</strong><span>{event.detail}</span>{active && <em>Current replay point</em>}</span>
              <time dateTime={`${journey.date}T${timeAt(journey, event.at)}:00Z`}>{timeAt(journey, event.at)}</time>
            </button>
          </li>;
        })}
      </ol>
      <p className={styles.localNote}>Demo / local only · Playback and selection stay in this view. No device connection or server changes.</p>
    </section>
  );
}

export default function JourneysView() {
  const id = useId();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [device, setDevice] = useState("all");
  const [sort, setSort] = useState<SortOrder>("newest");
  const [selectedId, setSelectedId] = useState(DEMO_JOURNEYS[0].id);
  const journeys = useMemo(() => getVisibleJourneys(query, status, device, sort), [query, status, device, sort]);
  const selectedJourney = journeys.find((journey) => journey.id === selectedId) ?? journeys[0];
  const filtersChanged = query.length > 0 || status !== "all" || device !== "all" || sort !== "newest";
  const totalDistance = DEMO_JOURNEYS.reduce((sum, journey) => sum + journey.distance, 0);
  const totalMinutes = DEMO_JOURNEYS.reduce((sum, journey) => sum + journey.duration, 0);

  function resetFilters() {
    setQuery("");
    setStatus("all");
    setDevice("all");
    setSort("newest");
  }

  return (
    <div className={styles.view}>
      <header className={styles.pageHeader}>
        <div><p className={styles.eyebrow}>Operations / Journey log</p><h1>Every journey, in perspective.</h1><p>Revisit the route, follow each checkpoint, and find the details that matter.</p></div>
        <span className={styles.demoBadge}><span />Synthetic demo</span>
      </header>
      <div className={styles.demoNotice}><FileClock size={18} aria-hidden="true" /><p><strong>A journey history to explore.</strong> These eight fictional journeys are local demo data. Replay illustrates the experience without real location data or a connected device.</p></div>

      <section className={styles.summaryGrid} aria-label="Synthetic journey totals">
        <div className={styles.summaryCard}><span className={`${styles.summaryIcon} ${styles.teal}`}><Route size={18} aria-hidden="true" /></span><div><span>Demo journeys</span><strong>{DEMO_JOURNEYS.length.toString().padStart(2, "0")}</strong><small>8–10 October 2026</small></div></div>
        <div className={styles.summaryCard}><span className={`${styles.summaryIcon} ${styles.blue}`}><Navigation size={18} aria-hidden="true" /></span><div><span>Sample distance</span><strong>{totalDistance.toFixed(1)} <small>km</small></strong><small>Across all demo journeys</small></div></div>
        <div className={styles.summaryCard}><span className={`${styles.summaryIcon} ${styles.purple}`}><Clock3 size={18} aria-hidden="true" /></span><div><span>Sample journey time</span><strong>{formatDuration(totalMinutes)}</strong><small>Combined fixture duration</small></div></div>
        <div className={styles.summaryCard}><span className={`${styles.summaryIcon} ${styles.orange}`}><Truck size={18} aria-hidden="true" /></span><div><span>Demo devices</span><strong>{DEMO_DEVICES.length.toString().padStart(2, "0")}</strong><small>Cycle, drive, and walk</small></div></div>
      </section>

      <section className={styles.filterPanel} aria-label="Filter journey history">
        <div className={styles.searchField}>
          <Search size={17} aria-hidden="true" /><label className={styles.srOnly} htmlFor={`${id}-search`}>Search journeys by route, ID, device, or date</label>
          <input id={`${id}-search`} type="search" placeholder="Search route, journey ID, device…" value={query} onChange={(event) => setQuery(event.target.value)} />
          {query && <button className={styles.clearSearch} type="button" aria-label="Clear journey search" onClick={() => setQuery("")}><X size={14} aria-hidden="true" /></button>}
        </div>
        <div className={styles.filterControls}>
          <SlidersHorizontal size={16} className={styles.filterIcon} aria-hidden="true" />
          <label>Status<select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)}><option value="all">All statuses</option><option value="completed">Completed</option><option value="interrupted">Ended early</option></select></label>
          <label>Device<select value={device} onChange={(event) => setDevice(event.target.value)}><option value="all">All devices</option>{DEMO_DEVICES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <label>Sort by<select value={sort} onChange={(event) => setSort(event.target.value as SortOrder)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option><option value="distance">Longest distance</option></select></label>
          <button className={styles.resetFilters} type="button" disabled={!filtersChanged} onClick={resetFilters}>Reset filters</button>
        </div>
      </section>

      <div className={styles.workspace}>
        <section className={styles.historyPanel} aria-labelledby={`${id}-history`}>
          <div className={styles.historyHeader}><h2 id={`${id}-history`}>Journey history</h2><span role="status">{journeys.length} of {DEMO_JOURNEYS.length}</span></div>
          <p className={styles.historyHint}>Fixture dates in UTC · Select a journey to explore</p>
          {journeys.length > 0 ? <ul className={styles.journeyList}>
            {journeys.map((journey) => {
              const selected = selectedJourney?.id === journey.id;
              return <li key={journey.id}><button type="button" className={`${styles.journeyCard} ${selected ? styles.selectedCard : ""}`} aria-pressed={selected} aria-controls={`${id}-details`} onClick={() => setSelectedId(journey.id)}>
                <span className={styles.cardTop}><span className={styles.journeyId}>{journey.id}</span><StatusBadge status={journey.status} /></span>
                <span className={styles.journeyName}>{journey.name}<ChevronRight size={17} aria-hidden="true" /></span>
                <span className={styles.cardRoute}>{journey.from}<ArrowRight size={12} aria-hidden="true" />{journey.to}</span>
                <span className={styles.cardStats}><span><Route size={12} aria-hidden="true" />{journey.distance.toFixed(1)} km</span><span><Clock3 size={12} aria-hidden="true" />{formatDuration(journey.duration)}</span><span>{journey.mode}</span></span>
                <span className={styles.cardBottom}><time dateTime={`${journey.date}T${formatTime(journey.startMinute)}:00Z`}>{formatDate(journey.date).replace(" 2026", "")} · {formatTime(journey.startMinute)}</time><span>{journey.device}</span>{selected && <span className={styles.selectedLabel}>Selected</span>}</span>
              </button></li>;
            })}
          </ul> : <div className={styles.emptyState}><Search size={25} aria-hidden="true" /><h3>No journeys found</h3><p>Try a different route, device, or status. Clear the filters to see all eight demo journeys.</p><button className={styles.emptyReset} type="button" onClick={resetFilters}><RotateCcw size={14} aria-hidden="true" />Reset filters</button></div>}
        </section>
        {selectedJourney ? <JourneyDetails key={selectedJourney.id} journey={selectedJourney} detailId={`${id}-details`} /> : <section className={`${styles.detailPanel} ${styles.emptyDetails}`} id={`${id}-details`} aria-label="Journey details"><Route size={34} aria-hidden="true" /><h2>A little more room to explore</h2><p>Matching journeys and their replay details will appear when you update the filters.</p></section>}
      </div>
      <p className={styles.srOnly} role="status">{selectedJourney ? `Selected demo journey: ${selectedJourney.name}, ${selectedJourney.id}.` : "No journey selected."}</p>
    </div>
  );
}
