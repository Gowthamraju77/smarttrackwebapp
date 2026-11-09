"use client";

import { useEffect, useId, useState } from "react";
import {
  Activity,
  BellOff,
  Check,
  ChevronRight,
  Clock3,
  FileClock,
  FlaskConical,
  Info,
  ListFilter,
  MapPinOff,
  Radio,
  RotateCcw,
  Search,
  ShieldAlert,
  Siren,
} from "lucide-react";
import styles from "./alerts-view.module.css";

type Severity = "urgent" | "high" | "medium" | "low";
type Evidence = { label: string; value: string; note: string };
type Incident = {
  id: string;
  kind: "sos" | "anomaly";
  title: string;
  device: string;
  severity: Severity;
  recordedAt: string;
  summary: string;
  evidence: Evidence[];
};
type HistoryEntry = {
  id: string;
  at: string;
  title: string;
  detail: string;
  origin: "Fixture" | "This session";
};
type ReviewFilter = "all" | "attention" | "acknowledged";

// Standalone synthetic fixtures. This view has no production data or delivery path.
const INCIDENTS: readonly Incident[] = [
  {
    id: "SOS-0081",
    kind: "sos",
    title: "Manual SOS activated",
    device: "DEMO-07",
    severity: "urgent",
    recordedAt: "2026-10-11T09:42:00Z",
    summary: "A synthetic SOS-button event. Review it independently of automated anomaly detection.",
    evidence: [
      { label: "Trigger", value: "Manual SOS button · fixture", note: "An SOS does not require an anomaly or an ML score." },
      { label: "Location", value: "GPS fix unavailable", note: "No coordinates are shown. Missing GPS does not block SOS." },
      { label: "Delivery evidence", value: "No provider receipt", note: "No emergency contact or responder has been notified by this demo." },
    ],
  },
  {
    id: "ALT-1044",
    kind: "anomaly",
    title: "Location fix unavailable",
    device: "DEMO-12",
    severity: "medium",
    recordedAt: "2026-10-11T09:40:00Z",
    summary: "This rule fixture has no usable GPS fix. A previous location must not be presented as current.",
    evidence: [
      { label: "Rule", value: "Location quality · fixture", note: "Synthetic missing-fix scenario, not a live device reading." },
      { label: "Location", value: "Current position unavailable", note: "No last-known coordinates are substituted for a current fix." },
      { label: "Review next", value: "Check GPS availability", note: "Inspect authenticated device telemetry before taking operational action." },
    ],
  },
  {
    id: "ALT-1043",
    kind: "anomaly",
    title: "Check-in gap",
    device: "DEMO-03",
    severity: "high",
    recordedAt: "2026-10-11T09:36:00Z",
    summary: "A synthetic continuity rule is flagged for review. A reporting gap alone does not establish an emergency.",
    evidence: [
      { label: "Rule", value: "Check-in continuity · fixture", note: "This is a demonstration of a missing-check-in event, not measured downtime." },
      { label: "Cause", value: "Not established", note: "Connectivity, device power, or delayed upload would need investigation." },
      { label: "Review next", value: "Inspect the device queue", note: "Queued records may arrive later; preserve their original identities." },
    ],
  },
  {
    id: "ALT-1042",
    kind: "anomaly",
    title: "Device clock unsynced",
    device: "DEMO-09",
    severity: "low",
    recordedAt: "2026-10-11T09:28:00Z",
    summary: "This fixture represents an unsynchronized device clock. The scenario timestamp below is not a device recording time.",
    evidence: [
      { label: "Rule", value: "Time quality · fixture", note: "The device recording time is unavailable in this scenario." },
      { label: "Record ordering", value: "Boot ID and sequence required", note: "Do not infer a precise journey timeline from receipt time alone." },
      { label: "Review next", value: "Verify time synchronization", note: "Acknowledging the example does not repair the device clock." },
    ],
  },
  {
    id: "ALT-1041",
    kind: "anomaly",
    title: "Out-of-order record",
    device: "DEMO-05",
    severity: "medium",
    recordedAt: "2026-10-11T09:21:00Z",
    summary: "A synthetic ordering rule is flagged. Late-arriving data should be examined before interpreting the journey.",
    evidence: [
      { label: "Rule", value: "Record ordering · fixture", note: "No real telemetry sequence is asserted by this example." },
      { label: "Possible explanation", value: "Delayed queue upload", note: "This is a review hypothesis, not a confirmed cause." },
      { label: "Review next", value: "Compare record identities", note: "Use device ID, record ID, boot ID, and sequence from authenticated records." },
    ],
  },
];

const SOS_INCIDENTS = INCIDENTS.filter((incident) => incident.kind === "sos");
const ANOMALIES = INCIDENTS.filter((incident) => incident.kind === "anomaly");
const INITIAL_ACKNOWLEDGED = "ALT-1042";
const INITIAL_COOLDOWN = "ALT-1044";
const COOLDOWN_SECONDS = 300;

const severityLabels: Record<Severity, string> = {
  urgent: "SOS",
  high: "High",
  medium: "Medium",
  low: "Low",
};

function formatTime(value: string) {
  return `${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(new Date(value))} UTC`;
}

function formatCountdown(seconds: number) {
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

function IncidentIcon({ incident }: { incident: Incident }) {
  const Icon = incident.kind === "sos" ? Siren : incident.id === "ALT-1044" ? MapPinOff : incident.id === "ALT-1042" ? Clock3 : Radio;
  return <Icon size={19} aria-hidden="true" />;
}

export default function AlertsView() {
  const id = useId();
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("all");
  const [reviewState, setReviewState] = useState<ReviewFilter>("all");
  const [selectedId, setSelectedId] = useState(INCIDENTS[0].id);
  const [detailSection, setDetailSection] = useState<"evidence" | "history">("evidence");
  const [acknowledged, setAcknowledged] = useState(() => new Set([INITIAL_ACKNOWLEDGED]));
  const [clockSeconds, setClockSeconds] = useState(0);
  const [cooldownEnds, setCooldownEnds] = useState<Record<string, number>>({ [INITIAL_COOLDOWN]: 180 });
  const [localHistory, setLocalHistory] = useState<Record<string, HistoryEntry[]>>({});
  const [notice, setNotice] = useState("");

  const cooldownCount = ANOMALIES.filter((incident) => (cooldownEnds[incident.id] ?? 0) > clockSeconds).length;
  const hasActiveCooldown = cooldownCount > 0;

  useEffect(() => {
    if (!hasActiveCooldown) return;
    let previousTick = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - previousTick) / 1000);
      if (elapsed > 0) {
        previousTick += elapsed * 1000;
        setClockSeconds((current) => current + elapsed);
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [hasActiveCooldown]);

  useEffect(() => {
    const expired = ANOMALIES.filter((incident) => cooldownEnds[incident.id] !== undefined && cooldownEnds[incident.id] <= clockSeconds);
    if (expired.length === 0) return;
    const at = new Date().toISOString();
    setCooldownEnds((current) => {
      const next = { ...current };
      expired.forEach((incident) => { delete next[incident.id]; });
      return next;
    });
    setLocalHistory((current) => {
      const next = { ...current };
      expired.forEach((incident) => {
        next[incident.id] = [...(current[incident.id] ?? []), {
          id: `${incident.id}-expired-${clockSeconds}`,
          at,
          title: "Cooldown preview elapsed locally",
          detail: "The demo grouping window ended. No production notification state changed.",
          origin: "This session",
        }];
      });
      return next;
    });
    setNotice(`${expired.map((incident) => incident.id).join(", ")}: cooldown preview elapsed. SOS is unaffected.`);
  }, [clockSeconds, cooldownEnds]);

  const normalizedQuery = query.trim().toLowerCase();
  const filteredAnomalies = ANOMALIES.filter((incident) => {
    const matchesQuery = `${incident.id} ${incident.device} ${incident.title}`.toLowerCase().includes(normalizedQuery);
    const matchesSeverity = severity === "all" || incident.severity === severity;
    const matchesReview = reviewState === "all" || (reviewState === "acknowledged" ? acknowledged.has(incident.id) : !acknowledged.has(incident.id));
    return matchesQuery && matchesSeverity && matchesReview;
  });
  const selectedIncident = [...SOS_INCIDENTS, ...filteredAnomalies].find((incident) => incident.id === selectedId) ?? null;
  const activeFilters = query !== "" || severity !== "all" || reviewState !== "all";
  const remainingCooldown = selectedIncident ? Math.max(0, (cooldownEnds[selectedIncident.id] ?? 0) - clockSeconds) : 0;
  const selectedAcknowledged = selectedIncident ? acknowledged.has(selectedIncident.id) : false;
  const history: HistoryEntry[] = selectedIncident ? [
    {
      id: `${selectedIncident.id}-fixture`,
      at: selectedIncident.recordedAt,
      title: selectedIncident.kind === "sos" ? "Manual SOS scenario created" : "Rule scenario created",
      detail: "Synthetic evidence only. No production event or notification was created.",
      origin: "Fixture",
    },
    ...(selectedIncident.id === INITIAL_ACKNOWLEDGED ? [{
      id: `${selectedIncident.id}-fixture-ack`,
      at: selectedIncident.recordedAt,
      title: "Demo acknowledgment included in fixture",
      detail: "Review is marked in this example. The incident remains open.",
      origin: "Fixture" as const,
    }] : []),
    ...(selectedIncident.id === INITIAL_COOLDOWN ? [{
      id: `${selectedIncident.id}-fixture-cooldown`,
      at: selectedIncident.recordedAt,
      title: "Cooldown preview included in fixture",
      detail: "The example begins with three minutes remaining in a five-minute grouping window.",
      origin: "Fixture" as const,
    }] : []),
    ...(localHistory[selectedIncident.id] ?? []),
  ] : [];

  function clearFilters() {
    setQuery("");
    setSeverity("all");
    setReviewState("all");
  }

  function selectIncident(incident: Incident) {
    setSelectedId(incident.id);
    setDetailSection("evidence");
    setNotice(`${incident.id} selected. Evidence is available in the incident detail panel.`);
  }

  function addHistory(incidentId: string, title: string, detail: string) {
    const at = new Date().toISOString();
    setLocalHistory((current) => ({
      ...current,
      [incidentId]: [...(current[incidentId] ?? []), {
        id: `${incidentId}-local-${(current[incidentId] ?? []).length}`,
        at,
        title,
        detail,
        origin: "This session",
      }],
    }));
  }

  function acknowledgeSelected() {
    if (!selectedIncident || acknowledged.has(selectedIncident.id)) return;
    setAcknowledged((current) => new Set([...current, selectedIncident.id]));
    addHistory(selectedIncident.id, "Acknowledged locally in demo", "Review marker only. No server write, delivery, or resolution occurred.");
    setNotice(`${selectedIncident.id} acknowledged in this demo only. The incident remains open; no responder was notified.`);
  }

  function toggleCooldown() {
    if (!selectedIncident || selectedIncident.kind === "sos") return;
    const ending = remainingCooldown > 0;
    setCooldownEnds((current) => {
      const next = { ...current };
      if (ending) delete next[selectedIncident.id];
      else next[selectedIncident.id] = clockSeconds + COOLDOWN_SECONDS;
      return next;
    });
    addHistory(selectedIncident.id, ending ? "Cooldown preview ended locally" : "Five-minute cooldown preview started", "Local demonstration of repeat-anomaly grouping. No notifications were sent or suppressed.");
    setNotice(`${selectedIncident.id}: cooldown preview ${ending ? "ended" : "started"}. SOS is unaffected.`);
  }

  function resetDemo() {
    clearFilters();
    setSelectedId(INCIDENTS[0].id);
    setDetailSection("evidence");
    setAcknowledged(new Set([INITIAL_ACKNOWLEDGED]));
    setClockSeconds(0);
    setCooldownEnds({ [INITIAL_COOLDOWN]: 180 });
    setLocalHistory({});
    setNotice("Demo reset to its synthetic snapshot. Local review markers and history were cleared.");
  }

  function incidentRow(incident: Incident) {
    const isSelected = selectedIncident?.id === incident.id;
    const isAcknowledged = acknowledged.has(incident.id);
    const cooldown = Math.max(0, (cooldownEnds[incident.id] ?? 0) - clockSeconds);
    return (
      <li key={incident.id}>
        <button
          type="button"
          className={`${styles.incidentRow} ${isSelected ? styles.selectedRow : ""}`}
          aria-pressed={isSelected}
          aria-controls={`${id}-detail`}
          aria-label={`Review ${incident.id}: ${incident.title}, ${incident.device}, ${severityLabels[incident.severity]} priority, ${isAcknowledged ? "acknowledged in demo" : "needs review"}${cooldown > 0 ? ", cooldown preview active" : ""}`}
          onClick={() => selectIncident(incident)}
        >
          <span className={`${styles.incidentIcon} ${incident.kind === "sos" ? styles.sosIcon : ""}`}><IncidentIcon incident={incident} /></span>
          <span className={styles.incidentCopy}>
            <strong>{incident.title}</strong>
            <span className={styles.incidentMeta}>{incident.device} <span aria-hidden="true">·</span> {incident.id}</span>
            <span className={styles.rowBadges}>
              <span className={`${styles.badge} ${styles[incident.severity]}`}>{severityLabels[incident.severity]}</span>
              <span className={isAcknowledged ? styles.acknowledgedLabel : styles.reviewLabel}>{isAcknowledged ? <Check size={12} aria-hidden="true" /> : null}{isAcknowledged ? "Acknowledged · demo" : "Needs review"}</span>
              {cooldown > 0 && incident.kind === "anomaly" ? <span className={styles.cooldownLabel}><Clock3 size={12} aria-hidden="true" />{formatCountdown(cooldown)} preview</span> : null}
            </span>
          </span>
          <span className={styles.rowEnd}><time dateTime={incident.recordedAt}>{formatTime(incident.recordedAt)}</time><ChevronRight size={16} aria-hidden="true" /><span className={styles.selectionLabel}>{isSelected ? "Selected" : "Review"}</span></span>
        </button>
      </li>
    );
  }

  return (
    <div className={styles.view}>
      <header className={styles.intro}>
        <div><p className={styles.eyebrow}>Response center</p><h1>Alerts</h1><p className={styles.subtitle}>A clearer view of the signals that need your attention.</p></div>
        <button type="button" className={styles.secondaryButton} onClick={resetDemo}><RotateCcw size={15} aria-hidden="true" />Reset demo</button>
      </header>

      <div className={styles.demoBanner}>
        <FlaskConical size={19} aria-hidden="true" />
        <div><strong>Synthetic scenario · local interaction only</strong><p>Acknowledgments and cooldowns last only while this view is open. Nothing is delivered to responders, saved to a server, or resolved.</p></div>
        <span className={styles.demoTag}>DEMO</span>
      </div>

      <section className={styles.metrics} aria-label="Synthetic incident summary">
        <article className={styles.metric}><span className={`${styles.metricIcon} ${styles.sosIcon}`}><Siren size={19} aria-hidden="true" /></span><div><span>Open SOS</span><strong>{String(SOS_INCIDENTS.length).padStart(2, "0")}</strong><small>Acknowledgment does not close it</small></div></article>
        <article className={styles.metric}><span className={styles.metricIcon}><ListFilter size={19} aria-hidden="true" /></span><div><span>Anomalies to review</span><strong>{String(ANOMALIES.filter((incident) => !acknowledged.has(incident.id)).length).padStart(2, "0")}</strong><small>Rule fixtures, not ML predictions</small></div></article>
        <article className={styles.metric}><span className={`${styles.metricIcon} ${styles.cooldownIcon}`}><Clock3 size={19} aria-hidden="true" /></span><div><span>Cooldown previews</span><strong>{String(cooldownCount).padStart(2, "0")}</strong><small>Applies to anomalies only</small></div></article>
      </section>

      <p className={notice ? styles.notice : styles.srOnly} role="status" aria-atomic="true">{notice}</p>

      <div className={styles.workspace}>
        <div className={styles.queueColumn}>
          <section className={styles.sosPanel} aria-labelledby={`${id}-sos-heading`}>
            <div className={styles.panelHeading}>
              <div><p className={styles.sosEyebrow}><Siren size={13} aria-hidden="true" />Manual emergency signals</p><h2 id={`${id}-sos-heading`}>SOS priority queue</h2></div>
              <span className={`${styles.badge} ${styles.urgent}`}>{SOS_INCIDENTS.length} open</span>
            </div>
            <ul className={styles.incidentList}>{SOS_INCIDENTS.map(incidentRow)}</ul>
            <p className={styles.sosNote}><ShieldAlert size={15} aria-hidden="true" /><span>SOS works independently of GPS and ML. Anomaly filters and cooldowns never hide or delay this queue.</span></p>
          </section>

          <section className={styles.inbox} aria-labelledby={`${id}-anomaly-heading`}>
            <div className={styles.panelHeading}><div><p className={styles.eyebrow}>Automated signals</p><h2 id={`${id}-anomaly-heading`}>Anomaly inbox</h2></div><span className={styles.quietLabel}>Newest first</span></div>
            <div className={styles.filters}>
              <label><span>Search anomalies</span><span className={styles.searchField}><Search size={16} aria-hidden="true" /><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Incident, device, or signal…" /></span></label>
              <div className={styles.filterRow}>
                <label><span>Severity</span><select value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="all">All severities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></label>
                <label><span>Review state</span><select value={reviewState} onChange={(event) => setReviewState(event.target.value as ReviewFilter)}><option value="all">All review states</option><option value="attention">Needs review</option><option value="acknowledged">Acknowledged · demo</option></select></label>
              </div>
            </div>
            <div className={styles.resultsBar}><span role="status" aria-atomic="true">{filteredAnomalies.length} of {ANOMALIES.length} anomalies</span><button type="button" className={styles.textButton} onClick={clearFilters} disabled={!activeFilters}>Clear filters</button></div>
            {filteredAnomalies.length > 0 ? <ul className={styles.incidentList}>{filteredAnomalies.map(incidentRow)}</ul> : <div className={styles.emptyState}><Search size={24} aria-hidden="true" /><h3>No matching anomalies</h3><p>Try another device, severity, or review state. SOS stays in its separate queue above.</p><button type="button" className={styles.secondaryButton} onClick={clearFilters}>Clear all filters</button></div>}
            <p className={styles.snapshotNote}>Synthetic snapshot · 11 October 2026 · UTC</p>
          </section>
        </div>

        <aside className={styles.detailPanel} id={`${id}-detail`} aria-label="Selected incident detail">
          {selectedIncident ? <>
            <header className={styles.detailHeading}>
              <p className={styles.eyebrow}>Incident detail · synthetic</p>
              <div className={styles.detailTitleRow}><span className={`${styles.badge} ${styles[selectedIncident.severity]}`}>{selectedIncident.kind === "sos" ? "Manual SOS" : `${severityLabels[selectedIncident.severity]} · rule fixture`}</span><span className={styles.openLabel}>Open incident</span></div>
              <h2>{selectedIncident.title}</h2>
              <p>{selectedIncident.summary}</p>
              <dl className={styles.metadata}><div><dt>Incident</dt><dd>{selectedIncident.id}</dd></div><div><dt>Device</dt><dd>{selectedIncident.device}</dd></div><div><dt>Scenario time</dt><dd><time dateTime={selectedIncident.recordedAt}>{formatTime(selectedIncident.recordedAt)}</time></dd></div><div><dt>Review marker</dt><dd>{selectedAcknowledged ? "Acknowledged · demo" : "Needs review"}</dd></div></dl>
            </header>

            <div className={styles.detailSwitch} role="group" aria-label="Incident detail section">
              <button type="button" aria-pressed={detailSection === "evidence"} aria-controls={`${id}-detail-content`} onClick={() => setDetailSection("evidence")}><Activity size={15} aria-hidden="true" />Evidence</button>
              <button type="button" aria-pressed={detailSection === "history"} aria-controls={`${id}-detail-content`} onClick={() => setDetailSection("history")}><FileClock size={15} aria-hidden="true" />History <span>{history.length}</span></button>
            </div>

            <div className={styles.detailContent} id={`${id}-detail-content`}>
              {detailSection === "evidence" ? <>
                <h3>What the scenario shows</h3>
                <dl className={styles.evidenceList}>{selectedIncident.evidence.map((evidence) => <div key={evidence.label}><dt>{evidence.label}</dt><dd><strong>{evidence.value}</strong><span>{evidence.note}</span></dd></div>)}</dl>
                <div className={styles.unavailable}><Info size={16} aria-hidden="true" /><div><strong>ML unavailable</strong><p>No promoted model is connected to this demo. No reliability score or safety probability is shown.</p></div></div>
              </> : <>
                <h3>Scenario &amp; local activity</h3>
                <p className={styles.historyNote}>This is a demo activity history, not a production audit log or a delivery receipt.</p>
                <ol className={styles.timeline}>{history.map((entry) => <li key={entry.id}><span className={styles.timelineDot} aria-hidden="true" /><div><div className={styles.timelineMeta}><span>{entry.origin}</span><time dateTime={entry.at}>{formatTime(entry.at)}</time></div><strong>{entry.title}</strong><p>{entry.detail}</p></div></li>)}</ol>
              </>}
            </div>

            <section className={styles.cooldownSection} aria-labelledby={`${id}-cooldown-heading`}>
              <div className={styles.cooldownHeading}><BellOff size={17} aria-hidden="true" /><h3 id={`${id}-cooldown-heading`}>{selectedIncident.kind === "sos" ? "SOS bypasses cooldowns" : "Repeat-alert cooldown"}</h3></div>
              {selectedIncident.kind === "sos" ? <p>A manual SOS is kept separate from anomaly grouping, even when GPS or ML is unavailable.</p> : <>
                <div className={styles.cooldownReadout}><strong>{remainingCooldown > 0 ? formatCountdown(remainingCooldown) : "Ready to preview"}</strong><span>{remainingCooldown > 0 ? "remaining · local preview" : "5-minute grouping window"}</span></div>
                <progress className={styles.cooldownProgress} max={COOLDOWN_SECONDS} value={remainingCooldown} aria-label="Seconds remaining in local cooldown preview" />
                <p>Preview a window for grouping repeated matching anomalies. No notification system is connected; SOS is always excluded.</p>
                <button type="button" className={styles.secondaryButton} onClick={toggleCooldown}><Clock3 size={14} aria-hidden="true" />{remainingCooldown > 0 ? "End cooldown preview" : "Preview 5-minute cooldown"}</button>
              </>}
            </section>

            <section className={styles.reviewSection} aria-labelledby={`${id}-review-heading`}>
              <h3 id={`${id}-review-heading`}>Review this incident</h3>
              <button type="button" className={styles.acknowledgeButton} onClick={acknowledgeSelected} disabled={selectedAcknowledged}><Check size={16} aria-hidden="true" />{selectedAcknowledged ? "Acknowledged · demo only" : "Acknowledge · demo only"}</button>
              <p>Acknowledgment marks review in this view. The incident stays open. It does not notify a responder or resolve the incident.</p>
            </section>
          </> : <div className={styles.emptyState}><Activity size={25} aria-hidden="true" /><h2>Select an incident</h2><p>Choose an SOS above or clear the anomaly filters to inspect evidence and local history.</p></div>}
        </aside>
      </div>
    </div>
  );
}
