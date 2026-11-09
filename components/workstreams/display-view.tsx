"use client";

import { useId, useReducer, type KeyboardEvent } from "react";
import {
  Activity,
  Battery,
  BatteryLow,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Keyboard,
  Monitor,
  Pause,
  Play,
  RotateCcw,
  Route,
  Satellite,
  Settings2,
  Siren,
  Wifi,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import styles from "./display-view.module.css";

const pages = [
  { id: "status", label: "Device status", short: "Status", icon: Monitor, description: "A compact overview of the selected synthetic device conditions." },
  { id: "gps", label: "GPS", short: "GPS", icon: Satellite, description: "Compare a fixture fix, a missing fix, and a stale sample. Unusable positions stay hidden." },
  { id: "motion", label: "Motion", short: "Motion", icon: Activity, description: "Inspect a stationary or moving IMU fixture, including the missing-sensor state." },
  { id: "journey", label: "Journey", short: "Journey", icon: Route, description: "A fixed journey snapshot with a synthetic breadcrumb diagram. It is not a road map." },
  { id: "sos", label: "SOS", short: "SOS", icon: Siren, description: "Preview a local SOS event with or without GPS. No emergency service is contacted." },
  { id: "ack", label: "Acknowledgment", short: "Ack", icon: CheckCheck, description: "Acknowledgment and resolution are separate, manually simulated transitions." },
  { id: "diagnostics", label: "Diagnostics", short: "Diagnostics", icon: Settings2, description: "Inspect preview state. Hardware, server receipts, and ML remain unavailable." },
] as const;

type GpsMode = "fix" | "searching" | "stale";
type ToggleKey = "offline" | "missingImu" | "lowBattery" | "moving";
type DemoSos = {
  id: string;
  status: "queued" | "acknowledged" | "resolved";
  gpsAtTrigger: GpsMode;
  retries: number;
};
type PreviewState = {
  page: number;
  gps: GpsMode;
  offline: boolean;
  missingImu: boolean;
  lowBattery: boolean;
  moving: boolean;
  journeyPaused: boolean;
  sos: DemoSos | null;
  eventCount: number;
  notice: string;
};
type PreviewAction =
  | { type: "page"; page: number }
  | { type: "cycle"; direction: 1 | -1 }
  | { type: "toggle"; key: ToggleKey }
  | { type: "gps"; value: GpsMode }
  | { type: "journey" }
  | { type: "sos" }
  | { type: "retry" }
  | { type: "acknowledge" }
  | { type: "resolve" }
  | { type: "reset" };

const initialState: PreviewState = {
  page: 0,
  gps: "fix",
  offline: false,
  missingImu: false,
  lowBattery: false,
  moving: true,
  journeyPaused: false,
  sos: null,
  eventCount: 0,
  notice: "Demo ready. All readings are fixed synthetic samples.",
};

const gpsLabels: Record<GpsMode, string> = {
  fix: "Fixture fix",
  searching: "No fix",
  stale: "Stale sample",
};

function previewReducer(state: PreviewState, action: PreviewAction): PreviewState {
  switch (action.type) {
    case "page":
      return { ...state, page: action.page };
    case "cycle":
      return { ...state, page: (state.page + action.direction + pages.length) % pages.length };
    case "toggle":
      return { ...state, [action.key]: !state[action.key], notice: "Scenario updated in this browser preview only." };
    case "gps":
      return { ...state, gps: action.value, notice: `${gpsLabels[action.value]} selected. SOS remains available without a position.` };
    case "journey":
      return { ...state, journeyPaused: !state.journeyPaused, page: 3, notice: `Demo journey ${state.journeyPaused ? "resumed" : "paused"}. The sample time and distance are fixed.` };
    case "sos": {
      if (state.sos && state.sos.status !== "resolved") return state;
      const eventCount = state.eventCount + 1;
      const id = `DEMO-SOS-${String(eventCount).padStart(3, "0")}`;
      return { ...state, eventCount, page: 4, sos: { id, status: "queued", gpsAtTrigger: state.gps, retries: 0 }, notice: `${id} created locally. Nothing was sent.` };
    }
    case "retry":
      if (state.sos?.status !== "queued") return state;
      return { ...state, sos: { ...state.sos, retries: state.sos.retries + 1 }, notice: `Local retry ${state.sos.retries + 1} keeps ${state.sos.id}. No network request or receipt.` };
    case "acknowledge":
      if (state.sos?.status !== "queued") return state;
      return { ...state, page: 5, sos: { ...state.sos, status: "acknowledged" }, notice: `${state.sos.id}: acknowledgment simulated. This is not a server or responder receipt.` };
    case "resolve":
      if (state.sos?.status !== "acknowledged") return state;
      return { ...state, page: 5, sos: { ...state.sos, status: "resolved" }, notice: `${state.sos.id}: resolution simulated locally. No real incident was changed.` };
    case "reset":
      return { ...initialState, notice: "Preview reset. Local scenarios and demo events cleared." };
  }
}

function ScreenMetric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return <div className={styles.screenMetric}><span>{label}</span><strong>{value}{unit && <small> {unit}</small>}</strong></div>;
}

function ScreenContent({ state }: { state: PreviewState }) {
  const { gps, missingImu, moving, sos } = state;
  const page = pages[state.page].id;

  if (page === "status") {
    return <>
      <div className={styles.deviceIdentity}><span className={styles.deviceGlyph}><Cpu size={22} aria-hidden="true" /></span><div><strong>DEMO-001</strong><span>Synthetic device snapshot</span></div></div>
      <dl className={styles.screenRows}>
        <div><dt>Network scenario</dt><dd className={state.offline ? styles.screenAmber : styles.screenMint}>{state.offline ? "Offline" : "Online"}</dd></div>
        <div><dt>GPS</dt><dd className={gps === "fix" ? styles.screenMint : styles.screenAmber}>{gpsLabels[gps]}</dd></div>
        <div><dt>Motion sample</dt><dd>{missingImu ? "Unavailable" : moving ? "Moving" : "Stationary"}</dd></div>
        <div><dt>Battery fixture</dt><dd className={state.lowBattery ? styles.screenAmber : undefined}>{state.lowBattery ? "12% · Low" : "82%"}</dd></div>
      </dl>
    </>;
  }

  if (page === "gps") {
    return <>
      <div className={`${styles.screenCallout} ${gps === "fix" ? styles.calloutMint : styles.calloutAmber}`}><Satellite size={17} aria-hidden="true" /><strong>{gps === "fix" ? "Synthetic fix available" : gps === "stale" ? "Stale · position hidden" : "Searching · no position"}</strong></div>
      <dl className={styles.coordinateRows}>
        <div><dt>LAT</dt><dd>{gps === "fix" ? "+00.00000°" : "—"}</dd></div>
        <div><dt>LON</dt><dd>{gps === "fix" ? "+000.00000°" : "—"}</dd></div>
      </dl>
      <div className={styles.screenMetricGrid}>
        <ScreenMetric label="Speed" value={gps === "fix" ? moving ? "1.4" : "0.0" : "—"} unit="m/s" />
        <ScreenMetric label="HDOP" value={gps === "fix" ? "0.9" : "—"} />
        <ScreenMetric label="Sample age" value={gps === "fix" ? "1s" : gps === "stale" ? "120s" : "—"} />
      </div>
      <p className={styles.screenHint}>{gps === "fix" ? "Fixture origin · not a tracked location" : "No usable location · SOS still available"}</p>
    </>;
  }

  if (page === "motion") {
    return <>
      <div className={styles.motionHeading}><strong>{missingImu ? "No IMU sample" : moving ? "Moving fixture" : "Stationary fixture"}</strong><span>{missingImu ? "UNAVAILABLE" : "SYNTHETIC"}</span></div>
      <div className={styles.waveform} aria-hidden="true">
        {(missingImu ? [4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4] : moving ? [12, 20, 13, 31, 43, 21, 11, 26, 38, 47, 24, 14, 32, 20, 12, 26] : [6, 7, 6, 8, 7, 6, 7, 8, 6, 7, 6, 8, 7, 6, 7, 6]).map((height, index) => <span key={index} style={{ height }} className={missingImu ? styles.noSampleBar : undefined} />)}
      </div>
      <div className={styles.screenMetricGrid}>
        <ScreenMetric label="Accel. magnitude" value={missingImu ? "—" : moving ? "10.24" : "9.81"} unit="m/s²" />
        <ScreenMetric label="Gyro magnitude" value={missingImu ? "—" : moving ? "3.6" : "0.2"} unit="°/s" />
      </div>
      <p className={styles.screenHint}>{missingImu ? "Missing input is not a zero reading" : "Fixed example samples · no live sensor"}</p>
    </>;
  }

  if (page === "journey") {
    return <>
      <div className={styles.motionHeading}><strong>DEMO-JOURNEY-01</strong><span className={state.journeyPaused ? styles.screenAmber : styles.screenMint}>{state.journeyPaused ? "PAUSED" : "ACTIVE"}</span></div>
      <div className={styles.journeyDiagram}>
        <svg viewBox="0 0 284 54" aria-hidden="true"><path d="M14 39 L52 39 L88 15 L124 25 L158 13 L198 31 L236 14 L270 14" /><circle cx="14" cy="39" r="4" /><circle cx="270" cy="14" r="5" /></svg>
        <span>Synthetic breadcrumb · not a road map</span>
      </div>
      <div className={styles.screenMetricGrid}>
        <ScreenMetric label="Sample distance" value="1.24" unit="km" />
        <ScreenMetric label="Sample duration" value="18:42" />
      </div>
      <p className={styles.screenHint}>Fixed snapshot · {gps === "fix" ? "fixture GPS" : "current position unavailable"}</p>
    </>;
  }

  if (page === "sos") {
    return <>
      <div className={`${styles.screenCallout} ${styles.calloutRed}`}><Siren size={18} aria-hidden="true" /><strong>{!sos ? "SOS preview only" : sos.status === "queued" ? "Simulated SOS queued" : sos.status === "acknowledged" ? "Simulated SOS acknowledged" : "Simulated SOS resolved"}</strong></div>
      <dl className={styles.screenRows}>
        <div><dt>Local event</dt><dd>{sos?.id ?? "None"}</dd></div>
        <div><dt>GPS at trigger</dt><dd>{sos ? gpsLabels[sos.gpsAtTrigger] : "—"}</dd></div>
        <div><dt>Retry simulations</dt><dd>{sos?.retries ?? 0}</dd></div>
        <div><dt>Actual transmission</dt><dd>None</dd></div>
      </dl>
      <p className={`${styles.screenHint} ${styles.screenRose}`}>LOCAL DEMO · no emergency dispatched</p>
    </>;
  }

  if (page === "ack") {
    const acknowledged = sos?.status === "acknowledged" || sos?.status === "resolved";
    const resolved = sos?.status === "resolved";
    return <>
      <p className={styles.eventId}>{sos?.id ?? "No local demo event"}</p>
      <ol className={styles.ackSteps}>
        <li data-complete={Boolean(sos)}><span>1</span><div><strong>Queued locally</strong><small>{sos ? "Simulated event created" : "Create a demo SOS first"}</small></div></li>
        <li data-complete={acknowledged}><span>2</span><div><strong>Acknowledgment</strong><small>{acknowledged ? "Manually simulated" : "Not simulated"}</small></div></li>
        <li data-complete={resolved}><span>3</span><div><strong>Resolution</strong><small>{resolved ? "Manually simulated" : "Separate from acknowledgment"}</small></div></li>
      </ol>
      <p className={styles.screenHint}>No server receipt or responder confirmation</p>
    </>;
  }

  return <>
    <dl className={`${styles.screenRows} ${styles.diagnosticRows}`}>
      <div><dt>Display viewport</dt><dd>320 × 240</dd></div>
      <div><dt>Hardware / transport</dt><dd>Not connected</dd></div>
      <div><dt>ML inference</dt><dd className={styles.screenAmber}>Unavailable</dd></div>
      <div><dt>Actual server receipts</dt><dd>0</dd></div>
      <div><dt>State storage</dt><dd>Browser memory</dd></div>
      <div><dt>Demo SOS retries</dt><dd>{sos?.retries ?? 0}</dd></div>
    </dl>
    <p className={styles.screenHint}>Browser UI preview · not firmware validation</p>
  </>;
}

function ScenarioToggle({ id, label, detail, checked, icon: Icon, onChange }: { id: string; label: string; detail: string; checked: boolean; icon: LucideIcon; onChange: () => void }) {
  return <label className={styles.toggle} htmlFor={id}>
    <span className={styles.toggleIcon}><Icon size={17} aria-hidden="true" /></span>
    <span className={styles.toggleCopy}><strong>{label}</strong><small>{detail}</small></span>
    <span className={styles.toggleControl}><input id={id} type="checkbox" checked={checked} onChange={onChange} /><span className={styles.toggleTrack} aria-hidden="true" /></span>
  </label>;
}

export default function DisplayView() {
  const [state, dispatch] = useReducer(previewReducer, initialState);
  const id = useId();
  const page = pages[state.page];
  const PageIcon = page.icon;
  const NetworkIcon = state.offline ? WifiOff : Wifi;
  const BatteryIcon = state.lowBattery ? BatteryLow : Battery;
  const pending = state.sos?.status === "queued";
  const canCreateSos = !state.sos || state.sos.status === "resolved";

  function handleScreenKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.target !== event.currentTarget) return;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      dispatch({ type: "cycle", direction: 1 });
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      dispatch({ type: "cycle", direction: -1 });
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      dispatch({ type: "page", page: event.key === "Home" ? 0 : pages.length - 1 });
    }
  }

  return <section className={styles.view} aria-labelledby={`${id}-title`}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>Hardware lab</p><h1 id={`${id}-title`}>Device display</h1><p className={styles.subtitle}>Small screen. Every important state.</p></div>
      <button type="button" className={styles.secondaryButton} onClick={() => dispatch({ type: "reset" })}><RotateCcw size={15} aria-hidden="true" />Reset preview</button>
    </header>

    <div className={styles.demoBanner}><span className={styles.bannerIcon}><Monitor size={19} aria-hidden="true" /></span><div><strong>Browser simulation · local only</strong><p>All readings are synthetic. Controls change this preview only. No hardware connection, outgoing messages, or real SOS.</p></div><span className={styles.demoBadge}>DEMO</span></div>

    <div className={styles.workspace}>
      <section className={styles.previewPanel} aria-labelledby={`${id}-preview-title`}>
        <div className={styles.panelHeader}><div><p className={styles.eyebrow}>On-device experience</p><h2 id={`${id}-preview-title`}>Display preview</h2></div><span className={styles.resolution}>320 × 240 px</span></div>

        <div className={styles.previewScroll}>
          <div className={styles.previewStage}>
            <div className={styles.deviceFrame}>
              <div className={styles.bezelHeader}><span><span className={styles.bezelDot} />SMARTTRACK</span><span>DISPLAY LAB</span></div>
              <div id={`${id}-screen`} className={styles.screen} tabIndex={0} role="region" aria-label={`${page.label}, page ${state.page + 1} of ${pages.length}, simulated device display`} aria-describedby={`${id}-keyboard`} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Home End" onKeyDown={handleScreenKey}>
                <div className={styles.screenStatus}><span>SIM · LOCAL</span><span className={state.lowBattery ? styles.screenAmber : undefined}><NetworkIcon size={11} aria-hidden="true" />{state.offline ? "OFFLINE" : "ONLINE"}<BatteryIcon size={14} aria-hidden="true" />{state.lowBattery ? "12" : "82"}%</span></div>
                <div className={styles.screenBody}><h3 className={styles.screenTitle}><PageIcon size={15} aria-hidden="true" />{page.label}</h3><ScreenContent state={state} /></div>
                <div className={styles.screenFooter}><span>UI PREVIEW</span><span className={styles.pageDots} aria-hidden="true">{pages.map((item, index) => <i key={item.id} data-active={state.page === index} />)}</span><span>{String(state.page + 1).padStart(2, "0")} / 07</span></div>
              </div>
              <div className={styles.bezelFooter}><span>ESP32-S3 · TFT PREVIEW</span><span className={styles.bezelMark}>S / T</span></div>
            </div>
          </div>
        </div>

        <div className={styles.pagingControls}>
          <button type="button" className={styles.pageArrow} aria-label="Previous display page" aria-controls={`${id}-screen`} onClick={() => dispatch({ type: "cycle", direction: -1 })}><ChevronLeft size={20} aria-hidden="true" /></button>
          <div><strong>{page.label}</strong><span>Page {state.page + 1} of {pages.length}</span></div>
          <button type="button" className={styles.pageArrow} aria-label="Next display page" aria-controls={`${id}-screen`} onClick={() => dispatch({ type: "cycle", direction: 1 })}><ChevronRight size={20} aria-hidden="true" /></button>
        </div>
        <p id={`${id}-keyboard`} className={styles.keyboardHint}><Keyboard size={15} aria-hidden="true" /><span>Focus the screen, then use arrow keys to cycle. Home / End jump to the first / last page.</span></p>
        <div className={styles.pageDescription}><span className={styles.descriptionIcon}><PageIcon size={18} aria-hidden="true" /></span><p>{page.description}</p></div>
      </section>

      <section className={styles.scenarioPanel} aria-labelledby={`${id}-scenarios`}>
        <div className={styles.panelHeader}><div><p className={styles.eyebrow}>Try a different state</p><h2 id={`${id}-scenarios`}>Scenario controls</h2></div><Settings2 size={18} className={styles.mutedIcon} aria-hidden="true" /></div>
        <div className={styles.toggles}>
          <ScenarioToggle id={`${id}-offline`} label="Offline network" detail={state.offline ? "Simulate an unavailable connection" : "Simulate an available connection"} checked={state.offline} icon={WifiOff} onChange={() => dispatch({ type: "toggle", key: "offline" })} />
          <ScenarioToggle id={`${id}-imu`} label="Missing IMU" detail="Show missing values, never zero-fill" checked={state.missingImu} icon={Cpu} onChange={() => dispatch({ type: "toggle", key: "missingImu" })} />
          <ScenarioToggle id={`${id}-moving`} label="Moving sample" detail={state.moving ? "Use the moving synthetic fixture" : "Use the stationary synthetic fixture"} checked={state.moving} icon={Activity} onChange={() => dispatch({ type: "toggle", key: "moving" })} />
          <ScenarioToggle id={`${id}-battery`} label="Low battery" detail={state.lowBattery ? "12% synthetic battery level" : "82% synthetic battery level"} checked={state.lowBattery} icon={BatteryLow} onChange={() => dispatch({ type: "toggle", key: "lowBattery" })} />
        </div>

        <fieldset className={styles.gpsOptions}><legend>GPS sample</legend><div>{(["fix", "searching", "stale"] as const).map((mode) => <label key={mode}><input type="radio" name={`${id}-gps`} value={mode} checked={state.gps === mode} onChange={() => dispatch({ type: "gps", value: mode })} /><span>{gpsLabels[mode]}</span></label>)}</div></fieldset>

        <div className={styles.demoActions}>
          <h3>Local demo actions</h3>
          <button type="button" className={styles.journeyButton} onClick={() => dispatch({ type: "journey" })}>{state.journeyPaused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}{state.journeyPaused ? "Resume" : "Pause"} demo journey</button>
          <div className={styles.actionGrid}>
            <button type="button" className={styles.sosButton} disabled={!canCreateSos} onClick={() => dispatch({ type: "sos" })}><Siren size={14} aria-hidden="true" />Simulate SOS</button>
            <button type="button" className={styles.actionButton} disabled={!pending} onClick={() => dispatch({ type: "retry" })}><RotateCcw size={14} aria-hidden="true" />Simulate retry</button>
            <button type="button" className={styles.actionButton} disabled={!pending} onClick={() => dispatch({ type: "acknowledge" })}><CheckCheck size={14} aria-hidden="true" />Simulate ack</button>
            <button type="button" className={styles.actionButton} disabled={state.sos?.status !== "acknowledged"} onClick={() => dispatch({ type: "resolve" })}>Simulate resolve</button>
          </div>
          <p className={styles.actionHint}>SOS works without GPS or ML in this demo. Retries retain the local event ID. A simulated ack is not a delivery receipt.</p>
        </div>
      </section>
    </div>

    <nav className={styles.pageCatalog} aria-label="Choose a device display page">
      {pages.map((item, index) => { const Icon = item.icon; return <button key={item.id} type="button" className={styles.catalogButton} aria-pressed={state.page === index} aria-controls={`${id}-screen`} onClick={() => dispatch({ type: "page", page: index })}><span className={styles.catalogNumber}>{String(index + 1).padStart(2, "0")}</span><Icon size={18} aria-hidden="true" /><span>{item.short}</span></button>; })}
    </nav>

    <p className={styles.feedback} role="status" aria-live="polite" aria-atomic="true"><span className={styles.feedbackDot} aria-hidden="true" /><span><strong>{page.label} · {state.page + 1}/{pages.length}.</strong> {state.notice}</span></p>
    <p className={styles.footnote}>A browser layout preview, not a hardware test. Sample clocks do not advance. Refreshing or resetting clears the in-memory simulation.</p>
  </section>;
}
