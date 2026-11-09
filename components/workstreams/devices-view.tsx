"use client";

import { useId, useState } from "react";
import {
  Activity,
  ArrowRight,
  Battery,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Cpu,
  HardDrive,
  Info,
  Radio,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Truck,
  Wifi,
} from "lucide-react";
import styles from "./devices-view.module.css";

export type DeviceHealthRecord = {
  id: string;
  name: string;
  asset: string | null;
  model: string;
  firmware: string | null;
  receivedAt: string | null;
  recordedAt: string | null;
  batteryPercent: number | null;
  gps: {
    fix: boolean | null;
    ageMs: number | null;
    hdop: number | null;
    lastFixAt: string | null;
  };
  imu: {
    status: "available" | "fault" | "unavailable" | "unknown";
    accelerationMps2: number | null;
    gyroDps: number | null;
  };
  storage: {
    status: "ready" | "full" | "fault" | "unavailable" | "unknown";
    pendingRecords: number | null;
  };
  network: {
    transport: string | null;
    status: "connected" | "disconnected" | "unconfigured" | "unknown";
    signalDbm: number | null;
    tls: "verified" | "failed" | "unknown";
    lastUploadAt: string | null;
  };
};

/** Connected mode never falls back to fixtures. Supply the inventory's observation time. */
export type DevicesViewProps =
  | { mode?: "demo" }
  | {
      mode: "connected";
      devices?: readonly DeviceHealthRecord[];
      snapshotAt?: string | null;
      loading?: boolean;
      error?: string | null;
    };

type Tone = "good" | "warn" | "muted";
type Freshness = {
  status: "fresh" | "delayed" | "stale" | "unknown" | "never";
  label: string;
  age: string;
  tone: Tone;
};
type Filter = "all" | "attention" | "fresh" | "stale" | "unknown";

const DEMO_SNAPSHOT_AT = "2026-10-11T09:30:00.000Z";
const RECENT_MS = 2 * 60 * 1000;
const STALE_MS = 15 * 60 * 1000;

const DEMO_DEVICES: readonly DeviceHealthRecord[] = [
  {
    id: "DEMO-001", name: "Atlas 01", asset: "Demo asset A-01", model: "ESP32-S3 tracker",
    firmware: "Demo 0.8.2", receivedAt: "2026-10-11T09:29:25.000Z", recordedAt: "2026-10-11T09:29:22.000Z",
    batteryPercent: 86,
    gps: { fix: true, ageMs: 2000, hdop: 0.9, lastFixAt: "2026-10-11T09:29:20.000Z" },
    imu: { status: "available", accelerationMps2: 9.81, gyroDps: 0.03 },
    storage: { status: "ready", pendingRecords: 0 },
    network: { transport: "Demo Wi-Fi", status: "connected", signalDbm: -58, tls: "verified", lastUploadAt: "2026-10-11T09:29:25.000Z" },
  },
  {
    id: "DEMO-002", name: "Atlas 02", asset: "Demo asset A-02", model: "ESP32-S3 tracker",
    firmware: "Demo 0.8.2", receivedAt: "2026-10-11T09:29:06.000Z", recordedAt: "2026-10-11T09:29:02.000Z",
    batteryPercent: 62,
    gps: { fix: false, ageMs: null, hdop: null, lastFixAt: "2026-10-11T09:12:00.000Z" },
    imu: { status: "available", accelerationMps2: 9.77, gyroDps: 0.08 },
    storage: { status: "ready", pendingRecords: 3 },
    network: { transport: "Demo Wi-Fi", status: "connected", signalDbm: -71, tls: "verified", lastUploadAt: "2026-10-11T09:29:06.000Z" },
  },
  {
    id: "DEMO-003", name: "Harbor 03", asset: "Demo asset H-03", model: "ESP32-S3 tracker",
    firmware: "Demo 0.8.1", receivedAt: "2026-10-11T09:23:00.000Z", recordedAt: "2026-10-11T09:22:55.000Z",
    batteryPercent: 18,
    gps: { fix: true, ageMs: 9000, hdop: 2.4, lastFixAt: "2026-10-11T09:22:46.000Z" },
    imu: { status: "fault", accelerationMps2: null, gyroDps: null },
    storage: { status: "full", pendingRecords: 42 },
    network: { transport: "Demo Wi-Fi", status: "disconnected", signalDbm: -87, tls: "unknown", lastUploadAt: "2026-10-11T09:23:00.000Z" },
  },
  {
    id: "DEMO-004", name: "Relay 04", asset: "Demo asset R-04", model: "ESP32-S3 tracker",
    firmware: "Demo 0.8.1", receivedAt: "2026-10-10T22:42:00.000Z", recordedAt: null,
    batteryPercent: 34,
    gps: { fix: false, ageMs: null, hdop: null, lastFixAt: "2026-10-10T22:40:00.000Z" },
    imu: { status: "unavailable", accelerationMps2: null, gyroDps: null },
    storage: { status: "ready", pendingRecords: 18 },
    network: { transport: "Demo Wi-Fi", status: "disconnected", signalDbm: null, tls: "unknown", lastUploadAt: "2026-10-10T22:42:00.000Z" },
  },
  {
    id: "DEMO-005", name: "Bench 05", asset: null, model: "ESP32-S3 tracker",
    firmware: null, receivedAt: null, recordedAt: null, batteryPercent: null,
    gps: { fix: null, ageMs: null, hdop: null, lastFixAt: null },
    imu: { status: "unknown", accelerationMps2: null, gyroDps: null },
    storage: { status: "unknown", pendingRecords: null },
    network: { transport: null, status: "unknown", signalDbm: null, tls: "unknown", lastUploadAt: null },
  },
];

function timestamp(value: string | null | undefined) {
  return value ? Date.parse(value) : Number.NaN;
}

function formatTime(value: string | null | undefined) {
  const parsed = timestamp(value);
  if (!Number.isFinite(parsed)) return "Unavailable";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    second: "2-digit", hourCycle: "h23", timeZone: "UTC",
  }).format(parsed) + " UTC";
}

function duration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function freshness(device: DeviceHealthRecord, snapshotAt: string | null | undefined): Freshness {
  if (!device.receivedAt) return { status: "never", label: "No telemetry", age: "No receipt recorded", tone: "muted" };
  const age = timestamp(snapshotAt) - timestamp(device.receivedAt);
  if (!Number.isFinite(age) || age < 0) {
    return { status: "unknown", label: "Time unavailable", age: "Freshness cannot be determined", tone: "muted" };
  }
  const status = age <= RECENT_MS ? "fresh" : age <= STALE_MS ? "delayed" : "stale";
  return {
    status,
    label: status === "fresh" ? "Recent receipt" : status === "delayed" ? "Delayed receipt" : "Stale receipt",
    age: `${duration(age)} before snapshot`,
    tone: status === "fresh" ? "good" : "warn",
  };
}

function needsReview(device: DeviceHealthRecord, state: Freshness) {
  return state.status !== "fresh" || device.gps.fix !== true || device.imu.status !== "available"
    || device.storage.status !== "ready" || device.network.status !== "connected"
    || device.network.tls !== "verified"
    || (device.batteryPercent !== null && device.batteryPercent < 20);
}

function measurement(value: number | null, unit = "", min = -Infinity, max = Infinity) {
  return value !== null && Number.isFinite(value) && value >= min && value <= max
    ? `${value}${unit}` : "Unavailable";
}

function Badge({ children, tone = "muted" }: { children: React.ReactNode; tone?: Tone }) {
  return <span className={`${styles.badge} ${styles[tone]}`}><span aria-hidden="true" />{children}</span>;
}

function TimeValue({ value }: { value: string | null | undefined }) {
  return Number.isFinite(timestamp(value)) ? <time dateTime={value ?? undefined}>{formatTime(value)}</time> : <>Unavailable</>;
}

function DeviceDetails({ device, state, id, demo }: { device: DeviceHealthRecord; state: Freshness; id: string; demo: boolean }) {
  const hasSample = Number.isFinite(timestamp(device.receivedAt));
  const gpsLabel = !hasSample || device.gps.fix === null ? "Unavailable" : device.gps.fix ? "Fix reported" : "No fix";
  const imuLabel = !hasSample ? "Unavailable" : {
    available: "Sample available", fault: "Sensor fault", unavailable: "Unavailable", unknown: "Unknown",
  }[device.imu.status];
  const storageLabel = !hasSample ? "Unavailable" : {
    ready: "Ready at sample", full: "Storage full", fault: "Storage fault", unavailable: "Unavailable", unknown: "Unknown",
  }[device.storage.status];
  const networkLabel = !hasSample ? "Unavailable" : {
    connected: "Connected at sample", disconnected: "Disconnected at sample", unconfigured: "Not configured", unknown: "Unknown",
  }[device.network.status];
  const gpsAge = hasSample && device.gps.fix === true && device.gps.ageMs !== null
    && Number.isFinite(device.gps.ageMs) && device.gps.ageMs >= 0 ? duration(device.gps.ageMs) : "Unavailable";
  const pending = hasSample && device.storage.pendingRecords !== null
    && Number.isSafeInteger(device.storage.pendingRecords) && device.storage.pendingRecords >= 0
    ? `${device.storage.pendingRecords} records` : "Unavailable";

  return (
    <section className={styles.detailPanel} id={id} aria-labelledby={`${id}-title`}>
      <div className={styles.detailHeader}>
        <div className={styles.deviceAvatar}><Cpu size={23} aria-hidden="true" /></div>
        <div className={styles.detailIdentity}>
          <p className={styles.kicker}>Device health · {demo ? "synthetic snapshot" : "supplied snapshot"}</p>
          <h2 id={`${id}-title`}>{device.name}</h2>
          <p>{device.id} <span aria-hidden="true">/</span> {device.asset ?? "No asset assigned"}</p>
        </div>
        <span className={styles.smallTag}>{demo ? "DEMO" : "READ ONLY"}</span>
      </div>

      <div className={`${styles.freshnessBox} ${state.tone === "warn" ? styles.freshnessWarning : ""}`}>
        <Clock3 size={18} aria-hidden="true" />
        <div><strong>{state.label}</strong><span>{state.age}</span></div>
        <p>{state.status === "fresh" ? "A recent receipt is not a continuous connection." : "Current sensor and network health is unknown."}</p>
      </div>

      <dl className={styles.identityGrid}>
        <div><dt>Hardware</dt><dd>{device.model || "Unavailable"}</dd></div>
        <div><dt>Firmware reported</dt><dd>{device.firmware ?? "Unavailable"}</dd></div>
        <div><dt><Battery size={13} aria-hidden="true" /> Battery at sample</dt><dd>{hasSample ? measurement(device.batteryPercent, "%", 0, 100) : "Unavailable"}</dd></div>
        <div><dt>Server received</dt><dd><TimeValue value={device.receivedAt} /></dd></div>
      </dl>

      <div className={styles.sensorSectionHeading}>
        <h3>Reported signals</h3>
        <span>At the last stored sample</span>
      </div>
      <div className={styles.healthGrid}>
        <article className={styles.healthCard}>
          <h4><Radio size={16} aria-hidden="true" /> GPS receiver</h4>
          <Badge tone={!hasSample || device.gps.fix === null ? "muted" : device.gps.fix ? "good" : "warn"}>{gpsLabel}</Badge>
          <dl>
            <div><dt>Fix age at sample</dt><dd>{gpsAge}</dd></div>
            <div><dt>HDOP at sample</dt><dd>{hasSample && device.gps.fix === true ? measurement(device.gps.hdop, "", 0) : "Unavailable"}</dd></div>
            <div className={styles.wideFact}><dt>Last known fix</dt><dd><TimeValue value={hasSample ? device.gps.lastFixAt : null} /></dd></div>
          </dl>
          <p>A last-known fix is historical, not a current location.</p>
        </article>
        <article className={styles.healthCard}>
          <h4><Activity size={16} aria-hidden="true" /> Motion sensor</h4>
          <Badge tone={!hasSample ? "muted" : device.imu.status === "available" ? "good" : device.imu.status === "fault" ? "warn" : "muted"}>{imuLabel}</Badge>
          <dl>
            <div><dt>Acceleration</dt><dd>{hasSample && device.imu.status === "available" ? measurement(device.imu.accelerationMps2, " m/s²") : "Unavailable"}</dd></div>
            <div><dt>Gyroscope</dt><dd>{hasSample && device.imu.status === "available" ? measurement(device.imu.gyroDps, " °/s") : "Unavailable"}</dd></div>
          </dl>
          <p>Sample measurements only. Missing readings stay unavailable.</p>
        </article>
        <article className={styles.healthCard}>
          <h4><Wifi size={16} aria-hidden="true" /> Network & transport</h4>
          <Badge tone={!hasSample || device.network.status === "unknown" ? "muted" : device.network.status === "connected" ? "good" : "warn"}>{networkLabel}</Badge>
          <dl>
            <div><dt>Transport</dt><dd>{hasSample ? device.network.transport ?? "Unavailable" : "Unavailable"}</dd></div>
            <div><dt>Signal at sample</dt><dd>{hasSample ? measurement(device.network.signalDbm, " dBm", -150, -1) : "Unavailable"}</dd></div>
            <div><dt>TLS evidence</dt><dd>{!hasSample || device.network.tls === "unknown" ? "Unavailable" : device.network.tls === "verified" ? "Verified at sample" : "Verification failed"}</dd></div>
          </dl>
          <p>Signal strength alone does not confirm an upload.</p>
        </article>
        <article className={styles.healthCard}>
          <h4><HardDrive size={16} aria-hidden="true" /> SD & offline queue</h4>
          <Badge tone={!hasSample || device.storage.status === "unknown" ? "muted" : device.storage.status === "ready" ? "good" : "warn"}>{storageLabel}</Badge>
          <dl>
            <div><dt>Queued at sample</dt><dd>{pending}</dd></div>
            <div className={styles.wideFact}><dt>Last reported upload</dt><dd><TimeValue value={hasSample ? device.network.lastUploadAt : null} /></dd></div>
          </dl>
          <p>A reported queue count is not a delivery receipt.</p>
        </article>
      </div>

      <details className={styles.disclosure}>
        <summary><Clock3 size={15} aria-hidden="true" /><span>Sample timestamps & freshness rules</span><ChevronDown size={15} aria-hidden="true" /></summary>
        <div>
          <dl className={styles.timestampList}>
            <div><dt>Device recorded</dt><dd>{device.recordedAt ? <TimeValue value={device.recordedAt} /> : "Unavailable · clock may be unsynchronized"}</dd></div>
            <div><dt>Server received</dt><dd><TimeValue value={device.receivedAt} /></dd></div>
          </dl>
          <p>Receipt age is measured against the inventory snapshot: recent ≤ 2 minutes; delayed &gt; 2 to 15 minutes; stale &gt; 15 minutes. Missing, invalid, or future timestamps cannot establish freshness. Device time and server receipt time are separate observations.</p>
        </div>
      </details>
    </section>
  );
}

export default function DevicesView(props: DevicesViewProps = {}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const demo = props.mode !== "connected";
  const devices = props.mode === "connected" ? props.devices ?? [] : DEMO_DEVICES;
  const snapshotAt = props.mode === "connected" ? props.snapshotAt : DEMO_SNAPSHOT_AT;
  const loading = props.mode === "connected" && Boolean(props.loading);
  const failed = props.mode === "connected" && Boolean(props.error);
  const available = demo || (props.mode === "connected" && props.devices !== undefined);
  const ready = available && !loading && !failed;
  const inventory = ready ? devices.map((device) => ({ device, state: freshness(device, snapshotAt) })) : [];
  const search = query.trim().toLocaleLowerCase("en");
  const visible = inventory.filter(({ device, state }) => {
    const matchesQuery = [device.id, device.name, device.asset, device.model, device.firmware, device.network.transport]
      .filter(Boolean).join(" ").toLocaleLowerCase("en").includes(search);
    const matchesFilter = filter === "all" || (filter === "attention" && needsReview(device, state))
      || (filter === "fresh" && state.status === "fresh") || (filter === "stale" && state.status === "stale")
      || (filter === "unknown" && (state.status === "never" || state.status === "unknown"));
    return matchesQuery && matchesFilter;
  });
  const selected = visible.find(({ device }) => device.id === selectedId) ?? visible[0];
  const recentCount = inventory.filter(({ state }) => state.status === "fresh").length;
  const reviewCount = inventory.filter(({ device, state }) => needsReview(device, state)).length;
  const missingCount = inventory.filter(({ state }) => state.status === "never").length;
  const resetFilters = () => { setQuery(""); setFilter("all"); };

  return (
    <div className={styles.view}>
      <header className={styles.pageHeader}>
        <div><p className={styles.kicker}>Manage / Hardware</p><h1>Devices</h1><p className={styles.subtitle}>Know what reported, what needs a look, and what is still unknown.</p></div>
        <span className={styles.readOnly}><ShieldCheck size={15} aria-hidden="true" /> Read-only inventory</span>
      </header>

      <div className={styles.sourceBanner}>
        <Info size={18} aria-hidden="true" />
        <div><strong>{demo ? "Demo inventory · synthetic data" : "Supplied inventory · snapshot data"}</strong><p>{demo ? "All devices, readings, and timestamps below are fictional. Search and selection are local to this view." : "Only supplied records are shown. Health describes the stored sample, not a live hardware connection."}</p></div>
        <div className={styles.snapshotTime}><span>Snapshot reference</span><strong><TimeValue value={snapshotAt} /></strong></div>
      </div>

      <section className={styles.metrics} aria-label="Inventory summary">
        <article className={styles.metric}><span className={styles.metricIcon}><Truck size={17} aria-hidden="true" /></span><span>Total devices</span><strong>{ready ? inventory.length : "—"}</strong><small>{demo ? "Synthetic inventory" : "Supplied inventory"}</small></article>
        <article className={styles.metric}><span className={`${styles.metricIcon} ${styles.good}`}><CheckCircle2 size={17} aria-hidden="true" /></span><span>Recent receipts</span><strong>{ready ? recentCount : "—"}</strong><small>Within 2m of snapshot</small></article>
        <article className={styles.metric}><span className={`${styles.metricIcon} ${styles.warn}`}><Activity size={17} aria-hidden="true" /></span><span>Needs review</span><strong>{ready ? reviewCount : "—"}</strong><small>Age, missing data, or signal issue</small></article>
        <article className={styles.metric}><span className={styles.metricIcon}><Clock3 size={17} aria-hidden="true" /></span><span>No telemetry</span><strong>{ready ? missingCount : "—"}</strong><small>No server receipt recorded</small></article>
      </section>

      <div className={styles.workspace}>
        <section className={styles.inventoryPanel} aria-labelledby={`${id}-inventory-title`}>
          <div className={styles.panelHeading}><div><p className={styles.kicker}>Inventory</p><h2 id={`${id}-inventory-title`}>Your devices</h2></div><span className={styles.smallTag}>{demo ? "DEMO" : "SNAPSHOT"}</span></div>
          <div className={styles.toolbar}>
            <label className={styles.searchLabel} htmlFor={`${id}-search`}>Search inventory</label>
            <div className={styles.searchField}><Search size={16} aria-hidden="true" /><input id={`${id}-search`} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, ID, asset, or firmware…" disabled={!ready} /></div>
            <label className={styles.filterLabel} htmlFor={`${id}-filter`}><SlidersHorizontal size={14} aria-hidden="true" /> Show</label>
            <select id={`${id}-filter`} className={styles.filterSelect} value={filter} onChange={(event) => setFilter(event.target.value as Filter)} disabled={!ready}>
              <option value="all">All devices</option><option value="attention">Needs review</option><option value="fresh">Recent receipts</option><option value="stale">Stale receipts</option><option value="unknown">Unknown / no telemetry</option>
            </select>
          </div>
          <div className={styles.resultsLine} role="status"><span>{loading ? "Loading inventory…" : !ready ? "Inventory unavailable" : `${visible.length} of ${inventory.length} devices`}</span>{ready && (query || filter !== "all") ? <button type="button" onClick={resetFilters}>Clear filters</button> : <span>Inspect a device <ArrowRight size={12} aria-hidden="true" /></span>}</div>

          {!ready ? (
            <div className={styles.emptyState} role={failed ? "alert" : undefined}><Cpu size={28} aria-hidden="true" /><h3>{loading ? "Loading device inventory" : failed ? "Device inventory could not be loaded" : "Device inventory unavailable"}</h3><p>{loading ? "Waiting for the supplied device records." : "An authenticated device-data source is required. No demo records are substituted in connected mode."}</p></div>
          ) : !visible.length ? (
            <div className={styles.emptyState}><Search size={28} aria-hidden="true" /><h3>{inventory.length ? "No matching devices" : "No devices in this inventory"}</h3><p>{inventory.length ? "Try a different name, ID, asset, or health filter." : "Device records will appear after they are registered through the authenticated backend."}</p>{inventory.length ? <button className={styles.clearButton} type="button" onClick={resetFilters}>Reset search and filters</button> : null}</div>
          ) : (
            <ul className={styles.deviceList}>
              {visible.map(({ device, state }) => (
                <li key={device.id}>
                  <button type="button" className={`${styles.deviceButton} ${selected?.device.id === device.id ? styles.deviceSelected : ""}`} aria-pressed={selected?.device.id === device.id} aria-controls={`${id}-details`} onClick={() => setSelectedId(device.id)}>
                    <span className={styles.rowTop}><span className={styles.rowIcon}><Cpu size={17} aria-hidden="true" /></span><span className={styles.rowIdentity}><strong>{device.name}</strong><span>{device.id} · {device.asset ?? "No asset assigned"}</span></span><ArrowRight className={styles.rowArrow} size={16} aria-hidden="true" /></span>
                    <span className={styles.rowBottom}><Badge tone={state.tone}>{state.label}</Badge><span>{state.age}</span></span>
                    {needsReview(device, state) && state.status === "fresh" ? <span className={styles.rowNote}>Recent receipt · reported signals need review</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className={styles.inventoryFootnote}>Receipt freshness and sensor health are different signals. “Recent” does not mean every sensor is healthy.</p>
        </section>

        {selected ? <DeviceDetails device={selected.device} state={selected.state} id={`${id}-details`} demo={demo} /> : <section className={`${styles.detailPanel} ${styles.noSelection}`} id={`${id}-details`} aria-label="Device health details"><Cpu size={32} aria-hidden="true" /><h2>Device health details</h2><p>{ready && inventory.length ? "Adjust the search or filter to inspect a matching device." : "Choose a device when inventory data is available."}</p></section>}
      </div>
      <span className={styles.srOnly} role="status">{selected ? `Showing health details for ${selected.device.name}.` : "No device selected."}</span>

      <details className={`${styles.disclosure} ${styles.connectionInfo}`}>
        <summary><ShieldCheck size={16} aria-hidden="true" /><span>Connecting real devices</span><ChevronDown size={15} aria-hidden="true" /></summary>
        <div><p>Device registration and credential issuance require an authenticated backend workflow. Hardware needs a configured HTTPS endpoint and validated telemetry ingestion before real observations can appear here. This inspection view provides no provisioning or delivery confirmation.</p></div>
      </details>
    </div>
  );
}
