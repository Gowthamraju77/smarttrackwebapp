"use client";

import { FeatureFlow } from "@/components/feature-flow";

import Link from "next/link";
import { Activity, ArrowUpRight, Clock3, Fingerprint, Gauge, Radio, Satellite, ShieldCheck } from "lucide-react";
import { TRUST_REASON_LABELS, type LiveSnapshot } from "@/lib/live/telemetry";
import { LiveMap } from "./live-map";
import { useLiveTelemetry } from "./live-telemetry-provider";
import { Disclosure } from "./signal-ui";
import { TrackingScene } from "./tracking-scene";
import { useSignalStability } from "./signal-filter";
import { ClimateCard } from "./climate-card";
import { HardwareStatus } from "./hardware-status";
import styles from "./live.module.css";

export function formatNumber(value: number | null | undefined, digits = 1) {
  return value === null || value === undefined || !Number.isFinite(value) ? "Unavailable" : value.toFixed(digits);
}

export function captureTime(value: number | null | undefined) {
  return value === null || value === undefined ? "No observation received" : new Date(value).toLocaleString();
}

function age(value: number | null | undefined) {
  if (value === null || value === undefined) return "Awaiting GPS";
  const seconds = Math.max(0, Math.floor(value / 1000));
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)}d ago`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ago`;
  return seconds < 60 ? `${seconds}s ago` : `${Math.floor(seconds / 60)}m ${seconds % 60}s ago`;
}

export function QualityCard({ snapshot, capturedSnapshot, connected, expanded = false }: {
  snapshot: LiveSnapshot | null; capturedSnapshot: LiveSnapshot | null; connected: boolean; expanded?: boolean;
}) {
  const current = connected && snapshot?.status === "live" && snapshot.trust.score !== null;
  const evidence = current ? snapshot : capturedSnapshot?.trust.score !== null && capturedSnapshot?.trust.score !== undefined ? capturedSnapshot : snapshot;
  const score = current ? snapshot.trust.score : capturedSnapshot?.trust.score ?? null;
  const factors = evidence?.trust.factors ?? [];
  const scoreAt = evidence?.receivedAt;
  const availableFactors = factors.filter((factor) => factor.value !== null).length;
  return <section className={`${styles.card} ${styles.qualityCard} ${expanded ? styles.expandedQuality : styles.compactQuality}`} aria-labelledby="live-trust-title" data-feature-surface><FeatureFlow tone="dark" />
    <div className={styles.cardHeader}>
      <h2 id="live-trust-title">Trust Score</h2>
      {expanded ? <span className={styles.qualityIcon}><ShieldCheck size={18} strokeWidth={1.6} aria-hidden="true" /></span> : <Link className={styles.qualityIcon} href="/insights" aria-label="Open Trust Score evidence"><ArrowUpRight size={18} strokeWidth={1.6} aria-hidden="true" /></Link>}
    </div>
    <div className={styles.scoreSummary}>
      <div className={styles.scoreRing}>
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r="57" className={styles.ringOrbit} />
          <circle cx="60" cy="60" r="50" className={styles.ringTrack} />
          <circle cx="60" cy="60" r="50" className={styles.ringValue} strokeDasharray={`${(score ?? 0) / 100 * 314.159} 314.159`} />
        </svg>
        <div><strong>{score === null ? "—" : Math.round(score)}</strong><span>{score === null ? "unavailable" : "out of 100"}</span></div>
      </div>
      <div className={styles.scoreCopy}>
        <span className={`${styles.pill} ${styles.scoreState}`}>{score === null ? "No scored observation" : current ? "Current estimate" : "At capture"}</span>
        <strong>{score === null ? "Waiting for usable evidence" : current ? "Current sensor quality" : "Last captured Trust Score"}</strong>
        <p>{score === null ? "A usable GPS observation is needed." : `Received ${captureTime(scoreAt)}.`}</p>
      </div>
    </div>
    {!current && score !== null && <p className={styles.scoreHistory}><Clock3 size={13} aria-hidden="true" /><span>Saved observation · not a current estimate.</span></p>}
    <div className={styles.methodNotice}>
      <span className={styles.methodDot} aria-hidden="true" />
      <strong>Heuristic estimate · ML unavailable</strong>
    </div>
    <Disclosure title="Explore score factors" summary={expanded ? factors.length ? `${availableFactors} available factors · transparent weighting` : "Awaiting sensor evidence" : undefined} defaultOpen={expanded} className={styles.cardDisclosure}>
      {factors.length > 0 && <div className={styles.factors} aria-label="Trust Score factors">{factors.map((factor) => <div className={styles.factor} key={factor.id}>
        <div><strong>{factor.label}</strong><span>{factor.value === null ? "Unavailable" : `${Math.round(factor.value * 100)}%`}<small>{factor.weight}% weight</small></span></div>
        <div className={styles.factorTrack}><span style={{ width: `${Math.max(0, Math.min(100, (factor.value ?? 0) * 100))}%` }} /></div>
        <p>{factor.detail}</p>
      </div>)}</div>}
      <p className={styles.cardNote}>The score is a sensor-quality heuristic. It is not a trained-model prediction, a calibrated position error, or a probability that a person is safe.</p>
      {evidence && evidence.trust.reasons.length > 0 && <ul className={styles.evidenceNotes}>{evidence.trust.reasons.map((reason) => <li key={reason}>{TRUST_REASON_LABELS[reason] ?? reason}</li>)}</ul>}
    </Disclosure>
  </section>;
}

export function MotionCard({ snapshot, connected }: { snapshot: LiveSnapshot | null; connected: boolean }) {
  const { motionValues, motionReceivedAt } = useSignalStability();
  const raw = snapshot?.imu.raw;
  const available = connected && snapshot?.imu.available;
  const steady = !!raw && motionValues !== null && motionReceivedAt === snapshot?.imu.receivedAt;
  const preview = steady ? motionValues : raw;
  return <section className={`${styles.card} ${styles.motionCard}`} aria-labelledby="live-motion-title" data-feature-surface><FeatureFlow offset={1} />
    <div className={styles.cardHeader}>
      <h2 id="live-motion-title">Motion readings</h2>
      <span className={`${styles.pill} ${available ? styles.good : styles.muted}`}>{available ? "Receiving" : raw ? "Last captured sample" : "Waiting"}</span>
    </div>
    {raw ? <div className={styles.motionSummary}>
      <span className={styles.sensorTile} aria-hidden="true"><Activity size={23} strokeWidth={1.4} /></span>
      <div><span>MPU observation</span><p>Received {captureTime(snapshot?.imu.receivedAt)}</p></div>
    </div> : <div className={styles.motionNoData}><span className={styles.sensorTile} aria-hidden="true"><Activity size={23} strokeWidth={1.4} /></span><div><strong>Awaiting a motion sample</strong><p>The next received MPU sample appears here.</p></div></div>}
    {preview && <div className={styles.motionPreview} aria-label="Motion readings preview">
      <span className={styles.previewLabel}>Sensor counts</span>
      <div className={styles.motionVectors}>
        <div><span>Accelerometer · X / Y / Z</span><strong>{formatNumber(preview.ax, 0)} <i>/</i> {formatNumber(preview.ay, 0)} <i>/</i> {formatNumber(preview.az, 0)}</strong></div>
        <div><span>Gyroscope · X / Y / Z</span><strong>{formatNumber(preview.gx, 0)} <i>/</i> {formatNumber(preview.gy, 0)} <i>/</i> {formatNumber(preview.gz, 0)}</strong></div>
      </div>
    </div>}
    <Disclosure title="Inspect raw sensor readings" className={styles.cardDisclosure}>
      <div className={styles.axisGrid}>
        <div><span>Accelerometer · raw counts</span><dl>{(["ax", "ay", "az"] as const).map((axis) => <div key={axis}><dt>{axis.slice(1).toUpperCase()}</dt><dd>{formatNumber(raw?.[axis], 0)}</dd></div>)}</dl></div>
        <div><span>Gyroscope · raw counts</span><dl>{(["gx", "gy", "gz"] as const).map((axis) => <div key={axis}><dt>{axis.slice(1).toUpperCase()}</dt><dd>{formatNumber(raw?.[axis], 0)}</dd></div>)}</dl></div>
      </div>
      <dl className={styles.detailList}>
        <div><dt>Received</dt><dd>{captureTime(snapshot?.imu.receivedAt)}</dd></div>
        <div><dt>Sample sequence</dt><dd>{formatNumber(snapshot?.imu.sequence, 0)}</dd></div>
        <div><dt>Temperature register</dt><dd>{raw ? `${formatNumber(raw.temp, 0)} counts` : "Unavailable"}</dd></div>
      </dl>
      <p className={styles.cardNote}>These are the original sensor registers. Physical acceleration, rotation rate, and temperature require confirmed calibration and scale settings.</p>
    </Disclosure>
  </section>;
}

function EvidenceCard({ snapshot, gps, sourceLabel, insights = false }: {
  snapshot: LiveSnapshot | null; gps: LiveSnapshot["gps"] | undefined; sourceLabel: string; insights?: boolean;
}) {
  return <section className={`${styles.card} ${styles.evidenceCard}`} aria-labelledby="connection-evidence-title" data-feature-surface><FeatureFlow offset={2} />
    <div className={styles.cardHeader}>
      <div><p className={styles.kicker}>Trace it to the source</p><h2 id="connection-evidence-title">{insights ? "What supports this estimate?" : "Captured device data"}</h2></div>
      <span className={styles.cardIcon}><Fingerprint size={22} strokeWidth={1.5} aria-hidden="true" /></span>
    </div>
    <div className={styles.evidenceSummary}>
      <span className={styles.evidenceSource}><Radio size={14} aria-hidden="true" />{sourceLabel}</span>
      <p>{snapshot ? `Latest sensor receipt · ${captureTime(snapshot.receivedAt)}` : "Ready for your first device observation."}</p>
    </div>
    <Disclosure title="View capture details" summary="Source, timestamps & message integrity" className={styles.cardDisclosure}>
      <dl className={styles.detailList}>
        <div><dt>Source</dt><dd>{sourceLabel}</dd></div>
        <div><dt>GPS message source</dt><dd>{gps?.source ?? "Waiting"}</dd></div>
        <div><dt>GPS observation time</dt><dd>{gps?.recordedAt ? new Date(gps.recordedAt).toLocaleString() : "Not supplied"}</dd></div>
        <div><dt>GPS receipt time</dt><dd>{captureTime(gps?.receivedAt)}</dd></div>
        <div><dt>Satellites at observation</dt><dd>{formatNumber(gps?.satellites, 0)}</dd></div>
        <div><dt>GPS HDOP</dt><dd>{formatNumber(gps?.hdop, 2)}</dd></div>
        <div><dt>Altitude at capture</dt><dd>{gps?.altitudeM !== null && gps?.altitudeM !== undefined ? `${formatNumber(gps.altitudeM)} m` : "Unavailable"}</dd></div>
        <div><dt>Lines received</dt><dd>{snapshot?.diagnostics.lines ?? "Unavailable"}</dd></div>
        <div><dt>GPS checksum errors</dt><dd>{snapshot?.diagnostics.checksumErrors ?? "Unavailable"}</dd></div>
        <div><dt>Model artifact</dt><dd>None · heuristic only</dd></div>
      </dl>
      <p className={styles.cardNote}>Only received measurements are shown. Original timestamps identify historical observations. Sensor availability and GPS plausibility do not establish personal safety or certify accuracy.</p>
    </Disclosure>
  </section>;
}

export function LiveWorkspace({ variant = "dashboard" }: { variant?: "dashboard" | "insights" }) {
  const { snapshot, capturedSnapshot, points, status, source } = useLiveTelemetry();
  const observed = snapshot?.receivedAt !== null && snapshot?.receivedAt !== undefined ? snapshot : capturedSnapshot;
  const connected = status === "connected" && snapshot?.status === "live";
  const currentFix = connected && snapshot?.gps.fix === true;
  const positionSnapshot = currentFix ? snapshot : capturedSnapshot?.gps.latitude !== null && capturedSnapshot?.gps.latitude !== undefined ? capturedSnapshot : snapshot;
  const motionSnapshot = snapshot?.imu.raw ? snapshot : capturedSnapshot ?? snapshot;
  const gps = positionSnapshot?.gps;
  const currentImu = connected && snapshot?.imu.available === true;
  const hasPosition = gps?.latitude !== null && gps?.latitude !== undefined && gps.longitude !== null;
  const sourceLabel = source === "relay" ? "ESP32 device feed" : source === "usb" ? "Direct USB connection" : "Waiting for device feed";
  const gpsAge = snapshot?.gps.ageMs ?? (gps?.receivedAt !== null && gps?.receivedAt !== undefined ? Math.max(0, Date.now() - gps.receivedAt) : null);
  const copy = variant === "insights"
      ? { eyebrow: "Signal intelligence", title: "Confidence, explained.", description: "Follow the evidence behind your device’s sensor-quality estimate." }
      : { eyebrow: "Tracking instrument / ESP32-S3", title: "Your device, in focus.", description: "One receiver. Every signal in its place." };
  const quality = <QualityCard snapshot={snapshot} capturedSnapshot={capturedSnapshot} connected={connected} expanded={variant === "insights"} />;
  const motion = <MotionCard snapshot={motionSnapshot} connected={currentImu} />;
  const evidence = <EvidenceCard snapshot={observed} gps={gps} sourceLabel={sourceLabel} insights={variant === "insights"} />;
  const heading = <div><p className={styles.kicker}><span className={styles.eyebrowMark} aria-hidden="true" />{copy.eyebrow}</p><h1>{copy.title}</h1><p className={styles.heroDescription}>{copy.description}</p></div>;
  const headerTools = <div className={styles.headerTools}>
    <span className={`${styles.sourceBadge} ${connected ? styles.good : styles.muted}`}><span className={styles.statusDot} aria-hidden="true" />{connected ? "Device stream active" : observed ? "Last captured observations" : "Waiting for observations"}</span>
    <Link className={styles.headerLink} href="/map">Explore live map<ArrowUpRight size={15} aria-hidden="true" /></Link>
  </div>;
  return <div className={styles.workspace}>
    <div className={variant === "dashboard" ? styles.overviewInstrument : styles.overviewCompact}>
      {variant === "dashboard" ? <header className={`${styles.pageHeader} ${styles.instrumentHeader}`}><div className={styles.instrumentCopy}>{heading}{headerTools}</div><TrackingScene gps={currentFix ? "live" : hasPosition ? "captured" : "waiting"} motion={currentImu ? "live" : motionSnapshot?.imu.raw ? "captured" : "waiting"} connected={connected} /></header>
        : <header className={styles.pageHeader}>{heading}{headerTools}</header>}
      <section className={styles.signalStrip} aria-label="Captured device observations" data-feature-surface><FeatureFlow offset={1} />
      <article><span className={styles.metricIcon}><Satellite size={18} strokeWidth={1.6} aria-hidden="true" /></span><div><span>GPS fix</span><strong>{currentFix ? "Valid position" : hasPosition ? "Last captured" : "Awaiting fix"}</strong></div></article>
      <article><span className={styles.metricIcon}><Gauge size={18} strokeWidth={1.6} aria-hidden="true" /></span><div><span>{currentFix ? "Ground speed" : "Speed at capture"}</span><strong>{gps?.speedMps !== null && gps?.speedMps !== undefined ? `${formatNumber(gps.speedMps * 3.6)} km/h` : "Unavailable"}</strong></div></article>
      <article><span className={styles.metricIcon}><Activity size={18} strokeWidth={1.6} aria-hidden="true" /></span><div><span>Motion sensor</span><strong>{currentImu ? "Receiving" : motionSnapshot?.imu.raw ? "At capture" : "Awaiting sample"}</strong></div></article>
      <article><span className={styles.metricIcon}><Clock3 size={18} strokeWidth={1.6} aria-hidden="true" /></span><div><span>GPS observation age</span><strong>{age(gpsAge)}</strong></div></article>
      </section>
    </div>
    {!connected && observed && <div className={styles.staleNotice} role="status"><Clock3 size={15} aria-hidden="true" /><p><strong>Historical observations.</strong> Original timestamps are preserved; these are saved measurements.</p></div>}
    {variant === "insights" ? <div className={styles.insightsGrid}>{quality}<div className={styles.sideStack}>{evidence}{motion}<ClimateCard /></div></div>
      : <><div className={styles.dashboardLayout}><div className={styles.dashboardMap}><LiveMap snapshot={positionSnapshot} points={points} connected={currentFix} /></div><div className={styles.instrumentStack}>{quality}{motion}</div></div><ClimateCard /><HardwareStatus />{evidence}</>}
  </div>;
}
