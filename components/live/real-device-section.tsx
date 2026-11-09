"use client";

import { FeatureFlow } from "@/components/feature-flow";

import Link from "next/link";
import { Activity, ArrowUpRight, Database, Radio, Satellite, ShieldCheck } from "lucide-react";
import { LiveMap } from "./live-map";
import { SignalAlerts } from "./signal-alerts";
import { HardwareStatus } from "./hardware-status";
import { Disclosure } from "./signal-ui";
import { useLiveTelemetry, type LivePoint } from "./live-telemetry-provider";
import { captureTime, formatNumber, MotionCard, QualityCard } from "./live-workspace";
import { ConnectedContacts, NotificationSettings } from "@/components/contacts/notification-settings";
import styles from "./live.module.css";

export type RealSection = "devices" | "analytics" | "activity" | "display" | "alerts" | "team" | "security" | "settings" | "help";

const sectionCopy: Record<RealSection, { title: string; description: string }> = {
  devices: { title: "Your ESP32", description: "The device observations actually received by this workspace." },
  analytics: { title: "Captured signal analytics", description: "Counts and signal measurements from the available device data." },
  activity: { title: "Observation history", description: "Capture timestamps and locations received from the ESP32." },
  display: { title: "Device readout", description: "A browser readout of the actual captured GPS and motion measurements." },
  alerts: { title: "Signals, in focus", description: "A precise view of the observations that need a closer look." },
  team: { title: "People & connections", description: "See who is using this device workspace." },
  security: { title: "Data provenance", description: "What is known about the observations displayed in this workspace." },
  settings: { title: "Make it your workspace", description: "Your contact details, update timing, and device feed preferences." },
  help: { title: "Device help", description: "Understand the captured readings, connection state, and device display." },
};

function PositionHistory({ points }: { points: readonly LivePoint[] }) {
  const shown = points.slice(-60).reverse();
  return <section className={styles.card} aria-labelledby="position-history-title" data-feature-surface><FeatureFlow />
    <div className={styles.cardHeader}><div><p className={styles.kicker}>Received GPS evidence</p><h2 id="position-history-title">Captured positions</h2></div><span className={styles.pill}>{points.length} observations</span></div>
    {shown.length ? <Disclosure title="Explore captured positions" summary={`${shown.length} recent positions · original timestamps`}><div className={styles.tableScroll} tabIndex={0} aria-label="Captured GPS positions"><table className={styles.dataTable}><thead><tr><th>Received</th><th>Latitude</th><th>Longitude</th></tr></thead><tbody>{shown.map((point, index) => <tr key={`${point.receivedAt}-${index}`}><td>{captureTime(point.receivedAt)}</td><td>{point.latitude.toFixed(6)}</td><td>{point.longitude.toFixed(6)}</td></tr>)}</tbody></table></div><p className={styles.cardNote}>Showing the latest {shown.length} captured positions. Capture timestamps are preserved; this table does not imply a current GPS fix.</p></Disclosure> : <p className={styles.cardNote}>No captured GPS positions are available yet. The track will populate when actual positions arrive.</p>}
  </section>;
}

function EmptyRecords({ title, children }: { title: string; children: string }) {
  return <section className={styles.card} data-feature-surface><FeatureFlow /><div className={styles.cardHeader}><div><p className={styles.kicker}>Data source unavailable</p><h2>{title}</h2></div><Database size={22} aria-hidden="true" /></div><Disclosure title="About this data source"><p className={styles.cardNote}>{children}</p></Disclosure></section>;
}

export function RealDeviceSection({ section }: { section: RealSection }) {
  const { snapshot, capturedSnapshot, points, status, source, feedStatus } = useLiveTelemetry();
  const observed = snapshot?.receivedAt !== null && snapshot?.receivedAt !== undefined ? snapshot : capturedSnapshot;
  const motion = snapshot?.imu.raw ? snapshot : capturedSnapshot ?? snapshot;
  const connected = status === "connected" && snapshot?.status === "live";
  const currentImu = connected && snapshot?.imu.available === true;
  const currentFix = connected && snapshot?.gps.fix === true;
  const positioned = currentFix ? snapshot : capturedSnapshot?.gps.latitude !== null && capturedSnapshot?.gps.latitude !== undefined ? capturedSnapshot : snapshot;
  const gps = positioned?.gps;
  const historicalGps = !currentFix && gps?.receivedAt !== null && gps?.receivedAt !== undefined;
  const historicalImu = !currentImu && !!motion?.imu.raw;
  const copy = sectionCopy[section];
  const sourceLabel = source === "relay" ? "ESP32 device feed" : source === "usb" ? "Direct USB serial" : "No source available";
  const capturedScore = capturedSnapshot?.trust.score ?? null;
  const currentScore = connected ? snapshot?.trust.score ?? null : null;
  const displayedScore = currentScore ?? capturedScore;
  const scoreReceivedAt = currentScore !== null ? snapshot?.receivedAt : capturedSnapshot?.receivedAt;

  const provenance = <section className={styles.card} data-feature-surface><FeatureFlow /><div className={styles.cardHeader}><div><p className={styles.kicker}>Received evidence</p><h2>Capture details</h2></div><Radio size={20} aria-hidden="true" /></div><p className={styles.cardNote}>{sourceLabel} · {observed ? connected ? "Receiving observations" : "Historical observations" : "Waiting for observations"}</p><Disclosure title="Inspect capture details" summary="Source, timestamps & device uptime"><dl className={styles.detailList}>
    <div><dt>Device</dt><dd>ESP32-S3</dd></div>
    <div><dt>Source</dt><dd>{sourceLabel}</dd></div>
    <div><dt>Latest sensor receipt</dt><dd>{captureTime(observed?.receivedAt)}</dd></div>
    <div><dt>GPS receipt</dt><dd>{captureTime(gps?.receivedAt)}</dd></div>
    <div><dt>GPS capture time</dt><dd>{gps?.recordedAt ? new Date(gps.recordedAt).toLocaleString() : "Not supplied"}</dd></div>
    <div><dt>Motion receipt</dt><dd>{captureTime(motion?.imu.receivedAt)}</dd></div>
    <div><dt>Device uptime at sample</dt><dd>{motion?.imu.uptimeMs !== null && motion?.imu.uptimeMs !== undefined ? `${formatNumber(motion.imu.uptimeMs / 1000)} seconds` : "Not supplied"}</dd></div>
  </dl><p className={styles.cardNote}>These values come from received device observations. A retained capture is labelled historical until fresh data arrives.</p></Disclosure></section>;

  let content;
  switch (section) {
    case "devices":
      content = <><HardwareStatus showEmpty /><div className={styles.bottomGrid}>{provenance}<MotionCard snapshot={motion} connected={currentImu} /></div><div className={styles.liveGrid}><LiveMap snapshot={positioned} points={points} connected={currentFix} /><QualityCard snapshot={snapshot} capturedSnapshot={capturedSnapshot} connected={connected} /></div></>;
      break;
    case "activity":
      content = <>{provenance}<PositionHistory points={points} /><EmptyRecords title="No administrative audit stream supplied">This page shows actual sensor observations. Account changes, SOS response actions, and other administrative events have not been supplied by a verified audit source.</EmptyRecords></>;
      break;
    case "analytics":
      content = <><section className={styles.metrics} aria-label="Captured signal counts">
        <article data-feature-surface><FeatureFlow offset={1} /><Database size={19} aria-hidden="true" /><span>Serial lines decoded</span><strong>{observed?.diagnostics.lines ?? "Unavailable"}</strong><small>From received device data</small></article>
        <article data-feature-surface><FeatureFlow offset={1} /><Satellite size={19} aria-hidden="true" /><span>GPS positions stored</span><strong>{observed ? points.length : "Unavailable"}</strong><small>Available captured trajectory</small></article>
        <article data-feature-surface><FeatureFlow offset={1} /><ShieldCheck size={19} aria-hidden="true" /><span>NMEA checksum errors</span><strong>{observed?.diagnostics.checksumErrors ?? "Unavailable"}</strong><small>Rejected corrupted sentences</small></article>
        <article data-feature-surface><FeatureFlow offset={1} /><Activity size={19} aria-hidden="true" /><span>Invalid serial lines</span><strong>{observed?.diagnostics.invalidLines ?? "Unavailable"}</strong><small>Reported by the stream decoder</small></article>
      </section><div className={styles.bottomGrid}><QualityCard snapshot={snapshot} capturedSnapshot={capturedSnapshot} connected={connected} expanded /><MotionCard snapshot={motion} connected={currentImu} /></div><PositionHistory points={points} /></>;
      break;
    case "display":
      content = <><div className={styles.bottomGrid}><section className={styles.card} data-feature-surface><FeatureFlow />
        <div className={styles.cardHeader}><div><p className={styles.kicker}>Actual captured values</p><h2>Screen readout</h2></div><span className={styles.pill}>{connected ? "Sensor feed active" : observed ? "At capture" : "Waiting for observations"}</span></div>
        <Disclosure title="Open device readout" summary="GPS, motion & capture times"><div className={styles.deviceReadout} aria-label="Captured device screen values">
          <div className={styles.readoutHeading}>SMARTTRACK <span>ESP32-S3</span></div>
          <dl>
            <div><dt>{historicalGps ? "GPS AT CAPTURE" : "GPS"}</dt><dd>{gps?.latitude !== null && gps?.latitude !== undefined && gps.longitude !== null ? `${gps.latitude.toFixed(6)}, ${gps.longitude.toFixed(6)}` : "NO POSITION"}</dd></div>
            <div><dt>{historicalGps ? "SAT / HDOP AT CAPTURE" : "SAT / HDOP"}</dt><dd>{formatNumber(gps?.satellites, 0)} / {formatNumber(gps?.hdop, 2)}</dd></div>
            <div><dt>{historicalGps ? "SPEED AT CAPTURE" : "SPEED"}</dt><dd>{gps?.speedMps !== null && gps?.speedMps !== undefined ? `${formatNumber(gps.speedMps * 3.6)} km/h` : "UNAVAILABLE"}</dd></div>
            <div><dt>GPS RECEIVED</dt><dd>{captureTime(gps?.receivedAt)}</dd></div>
            <div><dt>TRUST {currentScore !== null ? "CURRENT" : displayedScore !== null ? "AT CAPTURE" : "ESTIMATE"}</dt><dd>{displayedScore === null ? "UNAVAILABLE" : `${Math.round(displayedScore)} / 100`}</dd></div>
            <div><dt>TRUST RECEIVED</dt><dd>{captureTime(scoreReceivedAt)}</dd></div>
            <div><dt>{historicalImu ? "ACCEL RAW AT CAPTURE" : "ACCEL RAW"}</dt><dd>{motion?.imu.raw ? `${motion.imu.raw.ax} / ${motion.imu.raw.ay} / ${motion.imu.raw.az}` : "UNAVAILABLE"}</dd></div>
            <div><dt>{historicalImu ? "GYRO RAW AT CAPTURE" : "GYRO RAW"}</dt><dd>{motion?.imu.raw ? `${motion.imu.raw.gx} / ${motion.imu.raw.gy} / ${motion.imu.raw.gz}` : "UNAVAILABLE"}</dd></div>
            <div><dt>MOTION RECEIVED</dt><dd>{captureTime(motion?.imu.receivedAt)}</dd></div>
          </dl>
        </div>
        </Disclosure><p className={styles.cardNote}>Trust Score is a sensor-quality estimate. This browser readout uses received measurements; physical TFT power and rendering require a separate device check.</p>
      </section>{provenance}</div><MotionCard snapshot={motion} connected={currentImu} /></>;
      break;
    case "alerts":
      content = <SignalAlerts observed={observed} connected={connected} />;
      break;
    case "team":
      content = <><EmptyRecords title="No verified membership records">This device workspace has not loaded team memberships. No people or roles are listed without a verified source.</EmptyRecords><section className={styles.card} data-feature-surface><FeatureFlow /><div className={styles.cardHeader}><div><p className={styles.kicker}>Account access</p><h2>Workspace sign-in</h2></div></div><p className={styles.cardNote}>Account sign-in is separate from the captured device feed.</p><Link className={styles.cardLink} href="/login">Open sign-in <ArrowUpRight size={14} aria-hidden="true" /></Link></section></>;
      break;
    case "security":
      content = <>{provenance}<section className={styles.card} data-feature-surface><FeatureFlow /><div className={styles.cardHeader}><div><p className={styles.kicker}>Evidence boundaries</p><h2>What has been verified here?</h2></div></div><dl className={styles.detailList}><div><dt>Feed access</dt><dd>{feedStatus === "locked" ? "Private link required" : observed ? "Device observations received" : "No data received"}</dd></div><div><dt>GPS corruption checking</dt><dd>Checksum validation by decoder</dd></div><div><dt>Physical sensor calibration</dt><dd>Not supplied</dd></div><div><dt>Trained ML artifact</dt><dd>Not supplied</dd></div><div><dt>Security audit</dt><dd>Not supplied</dd></div></dl><p className={styles.cardNote}>A valid GPS checksum detects transmission corruption. It does not authenticate location or certify device security.</p></section></>;
      break;
    case "settings":
      content = <>{provenance}<section className={styles.card} data-feature-surface><FeatureFlow /><div className={styles.cardHeader}><div><p className={styles.kicker}>Display conventions</p><h2>How readings are displayed</h2></div></div><dl className={styles.detailList}><div><dt>Coordinates</dt><dd>Decimal degrees</dd></div><div><dt>GPS speed</dt><dd>Kilometers per hour</dd></div><div><dt>GPS altitude</dt><dd>Meters</dd></div><div><dt>Motion</dt><dd>Raw sensor counts</dd></div><div><dt>Capture timestamps</dt><dd>This browser’s local time</dd></div><div><dt>Trust Score</dt><dd>Current or explicitly labelled at capture</dd></div></dl><p className={styles.cardNote}>The connection panel shows the active source. Optional direct USB reading is available there; no device settings are changed by this page.</p></section></>;
      break;
    case "help":
      content = <section className={styles.card} data-feature-surface><FeatureFlow />
        <Disclosure title="Where do these readings come from?" defaultOpen><p className={styles.cardNote}>The workspace displays captured GPS NMEA observations and MPU motion samples from the ESP32. The device feed loads automatically through the private device link. USB reading is available as an optional connection.</p></Disclosure>
        <Disclosure title="Why does a reading say “At capture”?"><p className={styles.cardNote}>That measurement was received earlier. Its original timestamp and score are retained so you can inspect the evidence, while the interface keeps it separate from the device’s current condition.</p></Disclosure>
        <Disclosure title="Why is the GPS position missing?"><p className={styles.cardNote}>The receiver must provide a valid, checksum-checked position. A stale or lost fix remains historical. No replacement coordinates are generated when a fix is missing.</p></Disclosure>
        <Disclosure title="What is the Trust Score?"><p className={styles.cardNote}>It is an explained sensor-quality heuristic calculated from the received GPS and motion evidence. It is not trained ML and does not establish personal safety. The factors on Trust &amp; safety show how each observation contributed.</p></Disclosure>
        <Disclosure title="What do the motion values mean?"><p className={styles.cardNote}>Accelerometer, gyroscope, and temperature register values are raw counts. Converting them into physical units requires the confirmed sensor model, scale, and calibration.</p></Disclosure>
        <Disclosure title="The browser has data but the physical screen is blank"><p className={styles.cardNote}>Serial reception and TFT rendering are separate device functions. The browser readout confirms which sensor samples were received; physical display power, backlight, controller setup, and wiring need their own device-side check.</p></Disclosure>
        <Disclosure title="How do I connect over USB?"><p className={styles.cardNote}>Open Connection options above in Chrome or Edge, close other serial monitors using the ESP32, then choose Connect ESP32 and select the device. The reader uses 115200 baud and sends no serial commands.</p></Disclosure>
      </section>;
      break;
  }

  return <div className={styles.workspace}><header className={styles.pageHeader}><div><p className={styles.kicker}>ESP32-S3 · Captured observations</p><h1>{copy.title}</h1><p>{copy.description}</p></div><span className={`${styles.sourceBadge} ${connected ? styles.good : styles.muted}`}><Radio size={16} aria-hidden="true" />{connected ? "Current stream" : observed ? "At capture" : "No observations yet"}</span></header>{(section === "settings" || section === "alerts") && <NotificationSettings />}{(section === "devices" || section === "team") && <ConnectedContacts />}{content}</div>;
}
