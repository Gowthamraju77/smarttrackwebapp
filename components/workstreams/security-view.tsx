"use client";

import { useId, useState } from "react";
import {
  ChevronDown,
  CircleHelp,
  ClipboardList,
  Database,
  Filter,
  KeyRound,
  LockKeyhole,
  Shield,
} from "lucide-react";
import styles from "./security-view.module.css";

type RiskCategory = "access" | "data" | "device" | "credentials" | "operations";
type ReviewPriority = "critical" | "high" | "medium";

type ReadinessControl = {
  id: string;
  title: string;
  category: RiskCategory;
  priority: ReviewPriority;
  requirement: string;
  evidence: readonly string[];
  reviewer: string;
};

const categories: readonly { id: RiskCategory; label: string }[] = [
  { id: "access", label: "Access & tenancy" },
  { id: "data", label: "Data protection" },
  { id: "device", label: "Device & transport" },
  { id: "credentials", label: "Credentials" },
  { id: "operations", label: "Operations" },
];

const priorityLabels: Record<ReviewPriority, string> = {
  critical: "Critical",
  high: "High",
  medium: "Medium",
};

// Requirements are a review plan, not a report of the deployed system.
// No evidence source is connected, so every control remains unverified.
const controls: readonly ReadinessControl[] = [
  {
    id: "AC-01",
    title: "Authenticated production access",
    category: "access",
    priority: "critical",
    requirement:
      "Verify user identity on the server for every protected production read and write. Missing service configuration must fail closed with 503, without returning synthetic fleet data.",
    evidence: [
      "Unauthenticated, expired-session and forged-token requests are rejected by each protected API.",
      "A deployment with required configuration removed returns 503 and never a demo response.",
    ],
    reviewer: "API owner",
  },
  {
    id: "AC-02",
    title: "Tenant isolation at the database boundary",
    category: "access",
    priority: "critical",
    requirement:
      "Enforce Supabase row-level security and tenant-scoped server queries for devices, telemetry, SOS events and audit history. A client-supplied tenant or resource ID is not authorization.",
    evidence: [
      "Two isolated test tenants cannot read, update or export each other’s records, including through direct API requests.",
      "RLS policies, membership checks and privileged RPC access are reviewed against the deployed schema.",
    ],
    reviewer: "Database owner",
  },
  {
    id: "AC-03",
    title: "Least-privilege roles and browser writes",
    category: "access",
    priority: "high",
    requirement:
      "Enforce owner, admin, responder and viewer permissions on the server. Protect browser-originated mutations with same-origin checks; hidden UI actions do not provide access control.",
    evidence: [
      "A role matrix confirms viewers cannot mutate data and SOS acknowledgement or resolution requires an authorized role.",
      "Cross-origin browser mutation attempts and removed memberships are denied without changing records.",
    ],
    reviewer: "Identity / API owner",
  },
  {
    id: "DP-01",
    title: "Encryption across storage and service boundaries",
    category: "data",
    priority: "high",
    requirement:
      "Confirm encrypted transport between the UI, APIs, Supabase and the separate ML service. Review encryption at rest for databases, backups and device storage; provider defaults are not deployment evidence.",
    evidence: [
      "Actual deployment settings establish TLS, encryption coverage, key ownership and access to backups.",
      "A physical-device review documents SD-card exposure and the chosen protection or approved restriction on retained location data.",
    ],
    reviewer: "Infrastructure / hardware owner",
  },
  {
    id: "DP-02",
    title: "Location retention, deletion and exports",
    category: "data",
    priority: "high",
    requirement:
      "Approve purpose and retention periods for precise location, journey history and SOS records. Include device queues, exports and backup expiry in deletion and access policies.",
    evidence: [
      "An approved data inventory records each storage location, authorized audience and retention period.",
      "A scoped export and deletion exercise verifies authorization, redaction, deletion propagation and documented backup limitations.",
    ],
    reviewer: "Data owner",
  },
  {
    id: "DP-03",
    title: "Sensitive-data redaction and minimal collection",
    category: "data",
    priority: "high",
    requirement:
      "Collect only operationally necessary fields. Keep bearer tokens, service keys and unnecessary precise coordinates out of browser storage, URLs, application logs and error reports.",
    evidence: [
      "Synthetic error, authentication and ingest cases are inspected across browser, server and monitoring outputs for sensitive fields.",
      "Telemetry, export and diagnostic schemas have a documented field-level purpose and redaction policy.",
    ],
    reviewer: "Application / data owner",
  },
  {
    id: "DP-04",
    title: "ML service data and artifact boundaries",
    category: "data",
    priority: "high",
    requirement:
      "Authenticate the separately deployed ML service, limit its input to needed telemetry and load only trusted, evaluated artifacts. Missing configuration or a promoted model must display ML unavailable.",
    evidence: [
      "Unauthorized scoring calls and oversized inputs are rejected; service logs and retention are reviewed.",
      "Artifact provenance and promotion evidence exist; synthetic models cannot produce production scores or safety probabilities.",
    ],
    reviewer: "ML service owner",
  },
  {
    id: "DT-01",
    title: "Device HTTPS certificate validation",
    category: "device",
    priority: "critical",
    requirement:
      "Require HTTPS with certificate and hostname validation on the real device transport. Invalid certificates, time uncertainty or unavailable trust configuration must never trigger an insecure fallback.",
    evidence: [
      "The target board and modem reject untrusted, expired and wrong-host certificates with the deployed firmware.",
      "A failed TLS connection preserves queued telemetry and SOS records for a later authenticated retry.",
    ],
    reviewer: "Firmware / hardware owner",
  },
  {
    id: "DT-02",
    title: "Unique device identity and revocation",
    category: "device",
    priority: "critical",
    requirement:
      "Use a unique, high-entropy bearer secret per device and store its SHA-256 hash on the server. Bind the authenticated device to its payload identity and reject revoked credentials.",
    evidence: [
      "Missing, incorrect, revoked and cross-device credentials are denied for both ingest and SOS.",
      "Secure provisioning and replacement are demonstrated without shared fleet secrets or raw device secrets in database records.",
    ],
    reviewer: "Device provisioning / API owner",
  },
  {
    id: "DT-03",
    title: "Wire validation and corruption detection",
    category: "device",
    priority: "high",
    requirement:
      "Validate versioned payloads, finite numeric values, coordinate limits and bounded request sizes. CRC32 must cover the exact UTF-8 payload bytes; it detects corruption and does not authenticate a sender.",
    evidence: [
      "Malformed envelopes, mismatched CRCs, unsupported versions and out-of-range fields are rejected.",
      "No-fix GPS and unsynced timestamps remain explicitly unknown rather than appearing as a current location.",
    ],
    reviewer: "Firmware / API owner",
  },
  {
    id: "DT-04",
    title: "Durable retries and independent SOS",
    category: "device",
    priority: "high",
    requirement:
      "Preserve device_id and record_id across retries, with transactional deduplication. Remove a queued item only after its exact accepted receipt. SOS must work without GPS or ML.",
    evidence: [
      "Power-loss, duplicate and interrupted-response cases retain identity and create at most one durable event.",
      "Wrong-record acknowledgements do not drain the queue; no-GPS / no-ML SOS is exercised on the intended integration.",
    ],
    reviewer: "Firmware / backend owner",
  },
  {
    id: "CR-01",
    title: "Server-only service credentials",
    category: "credentials",
    priority: "critical",
    requirement:
      "Keep Supabase service-role and ML credentials in restricted server-side secret storage. Keep them out of NEXT_PUBLIC variables, client bundles, source control and support exports.",
    evidence: [
      "Build output and repository secret scanning show no secret values exposed to the client or committed history.",
      "Environment access is scoped by service and environment, with named owners and restricted deployment access.",
    ],
    reviewer: "Deployment owner",
  },
  {
    id: "CR-02",
    title: "Credential rotation and recovery",
    category: "credentials",
    priority: "high",
    requirement:
      "Document planned rotation and immediate compromise revocation for device and service credentials. Account for offline devices, secure re-provisioning and queued records; overlap support must be verified.",
    evidence: [
      "A controlled rotation proves the replacement works, the retired credential is rejected and audit records contain no secret values.",
      "An offline-device recovery exercise preserves queued record IDs and confirms retry behavior after re-provisioning.",
    ],
    reviewer: "Security / provisioning owner",
  },
  {
    id: "CR-03",
    title: "Credential ownership and review schedule",
    category: "credentials",
    priority: "medium",
    requirement:
      "Inventory credential identifiers, purpose, owner and review cadence. Derive last-rotation and next-review dates from actual records rather than an assumed interval.",
    evidence: [
      "A secret-value-free inventory identifies each credential class and its revocation path.",
      "Rotation records and a documented owner-approved review schedule are available for the deployment.",
    ],
    reviewer: "Security owner",
  },
  {
    id: "OP-01",
    title: "Auditable SOS and administrative actions",
    category: "operations",
    priority: "high",
    requirement:
      "Record tenant, actor, timestamp and the authorized transition for sensitive actions. SOS acknowledgement and resolution are distinct audited transitions, not a delivery or safety guarantee.",
    evidence: [
      "Authorized acknowledgement and resolution each create their own audit evidence; denied transitions leave state unchanged.",
      "Audit read access, retention and protection from unauthorized alteration are verified.",
    ],
    reviewer: "Operations / backend owner",
  },
  {
    id: "OP-02",
    title: "Durable abuse controls and resource limits",
    category: "operations",
    priority: "high",
    requirement:
      "Apply durable, scoped rate limits and bounded payload handling across serverless instances. Review how throttling affects urgent SOS and retry queues.",
    evidence: [
      "Concurrent requests across instances respect the configured device / tenant limits without bypassing authorization.",
      "Oversized requests and throttled retries remain bounded; the SOS handling policy is exercised and documented.",
    ],
    reviewer: "API / operations owner",
  },
  {
    id: "OP-03",
    title: "Backup restoration and service recovery",
    category: "operations",
    priority: "medium",
    requirement:
      "Set recovery targets for durable Supabase data and external dependencies. Verify restricted backup access and restoration; local JSON files on Vercel are not durable storage.",
    evidence: [
      "A non-production restore confirms records, tenant policies and audit history can be recovered within agreed targets.",
      "Service outage and recovery exercises confirm unavailable states are explicit and never replaced by synthetic success.",
    ],
    reviewer: "Infrastructure / operations owner",
  },
  {
    id: "OP-04",
    title: "Incident ownership and delivery evidence",
    category: "operations",
    priority: "high",
    requirement:
      "Assign incident responders and escalation paths. Separate an accepted SOS record from notification delivery, human acknowledgement and resolution; each needs its own real evidence.",
    evidence: [
      "A documented incident exercise covers lost devices, credential exposure and unauthorized location access.",
      "Configured notification channels are tested with actual provider receipts and failure handling; unavailable delivery stays unknown.",
    ],
    reviewer: "Operations / security owner",
  },
];

const rotationSteps = [
  {
    title: "Identify the credential and recovery owner",
    description:
      "Record its identifier, scope and dependent services or devices. Suspected compromise calls for immediate revocation and incident handling, rather than waiting for a planned window.",
  },
  {
    title: "Prepare a replacement securely",
    description:
      "Generate a unique, high-entropy replacement through the approved secret manager or device-provisioning channel. Device bearer secrets are stored as SHA-256 hashes on the server; service secrets remain server-only.",
  },
  {
    title: "Coordinate the cutover",
    description:
      "Confirm the backend’s rotation mechanism and device delivery plan. Overlapping credentials are not assumed. Plan a maintenance window or re-provisioning path for offline devices while retaining their queued record IDs.",
  },
  {
    title: "Retire the previous credential",
    description:
      "For a planned rotation, confirm replacement access before revoking the old credential using the authoritative service. For compromise, use the immediate-revocation recovery path. Remove superseded deployment copies.",
  },
  {
    title: "Verify behavior and retain evidence",
    description:
      "Test replacement access and rejection of the retired credential. For devices, confirm exact ingest / SOS receipts and preserved retries. Audit the actor, credential identifier and timestamps without recording secret values.",
  },
] as const;

function ChecklistControl({ control }: { control: ReadinessControl }) {
  const category = categories.find((item) => item.id === control.category);

  return (
    <li className={styles.controlItem}>
      <details className={styles.control}>
        <summary className={styles.controlSummary}>
          <span className={styles.controlCopy}>
            <span className={styles.controlMeta}>
              <span>{control.id}</span>
              <span aria-hidden="true">·</span>
              <span>{category?.label}</span>
            </span>
            <strong className={styles.controlTitle}>{control.title}</strong>
            <span className={`${styles.priority} ${styles[control.priority]}`}>
              {priorityLabels[control.priority]} priority
            </span>
          </span>
          <span className={styles.controlState}>
            <span className={styles.unknownBadge}>
              <CircleHelp size={13} aria-hidden="true" /> Unverified
            </span>
            <ChevronDown size={16} className={styles.chevron} aria-hidden="true" />
          </span>
        </summary>
        <div className={styles.controlDetails}>
          <h3>Requirement</h3>
          <p>{control.requirement}</p>
          <h3>Evidence needed</h3>
          <ul>
            {control.evidence.map((item) => <li key={item}>{item}</li>)}
          </ul>
          <div className={styles.reviewNote}>
            <span>Suggested reviewer: <strong>{control.reviewer}</strong></span>
            <span>Evidence: not supplied · Last checked: unknown</span>
          </div>
        </div>
      </details>
    </li>
  );
}

export default function SecurityView() {
  const [category, setCategory] = useState<RiskCategory | "all">("all");
  const [priority, setPriority] = useState<ReviewPriority | "all">("all");
  const id = useId();
  const checklistId = `${id}-checklist`;
  const visibleControls = controls.filter((control) => (
    (category === "all" || control.category === category)
    && (priority === "all" || control.priority === priority)
  ));
  const hasFilters = category !== "all" || priority !== "all";

  function resetFilters() {
    setCategory("all");
    setPriority("all");
  }

  return (
    <div className={styles.root}>
      <header className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>Workspace governance</p>
          <h1>Security readiness</h1>
          <p className={styles.subtitle}>A clear review plan for protecting your fleet, its people and their data.</p>
        </div>
        <span className={styles.readinessBadge}><Shield size={16} aria-hidden="true" /> Readiness unknown</span>
      </header>

      <section className={styles.notice} aria-labelledby={`${id}-evidence-title`}>
        <span className={styles.noticeIcon}><ClipboardList size={21} aria-hidden="true" /></span>
        <div>
          <h2 id={`${id}-evidence-title`}>Planning checklist · local view</h2>
          <p>No deployment evidence is connected. Every control is unverified. Counts describe review requirements, not detected vulnerabilities or successful security checks. Filters change this view only.</p>
        </div>
      </section>

      <dl className={styles.metrics} aria-label="Readiness evidence summary">
        <div className={styles.metric}>
          <dt><Shield size={17} aria-hidden="true" /> Overall readiness</dt>
          <dd>Unknown</dd>
          <p>Requires deployment-specific evidence</p>
        </div>
        <div className={styles.metric}>
          <dt><ClipboardList size={17} aria-hidden="true" /> Unverified controls</dt>
          <dd>{controls.length}<span> / {controls.length}</span></dd>
          <p>All requirements await review</p>
        </div>
        <div className={styles.metric}>
          <dt><KeyRound size={17} aria-hidden="true" /> Last credential rotation</dt>
          <dd>Unknown</dd>
          <p>No rotation record supplied</p>
        </div>
      </dl>

      <div className={styles.layout}>
        <section className={styles.panel} aria-labelledby={`${id}-checklist-title`}>
          <div className={styles.panelHeading}>
            <div>
              <p className={styles.eyebrow}>Evidence before confidence</p>
              <h2 id={`${id}-checklist-title`}>Readiness checklist</h2>
            </div>
            <span className={styles.smallIcon}><Filter size={17} aria-hidden="true" /></span>
          </div>

          <div className={styles.filters}>
            <fieldset className={styles.categoryFieldset}>
              <legend>Risk category</legend>
              <div className={styles.categoryButtons}>
                <button type="button" aria-pressed={category === "all"} aria-controls={checklistId} onClick={() => setCategory("all")}>
                  All categories <span>{controls.length}</span>
                </button>
                {categories.map((item) => (
                  <button key={item.id} type="button" aria-pressed={category === item.id} aria-controls={checklistId} onClick={() => setCategory(item.id)}>
                    {item.label} <span>{controls.filter((control) => control.category === item.id).length}</span>
                  </button>
                ))}
              </div>
            </fieldset>
            <div className={styles.priorityRow}>
              <div className={styles.priorityField}>
                <label htmlFor={`${id}-priority`}>Review priority</label>
                <select id={`${id}-priority`} value={priority} aria-controls={checklistId} onChange={(event) => setPriority(event.currentTarget.value as ReviewPriority | "all")}>
                  <option value="all">All priorities</option>
                  <option value="critical">Critical</option>
                  <option value="high">High</option>
                  <option value="medium">Medium</option>
                </select>
              </div>
              <button className={styles.resetButton} type="button" disabled={!hasFilters} onClick={resetFilters}>Reset filters</button>
            </div>
            <p className={styles.filterHint}>Priority reflects potential impact if a requirement is missing, not a measured vulnerability.</p>
          </div>

          <div className={styles.resultHeading}>
            <p role="status" aria-live="polite" aria-atomic="true">Showing {visibleControls.length} of {controls.length} controls · all unverified</p>
            <span>Expand for evidence needed</span>
          </div>
          <div id={checklistId}>
            {visibleControls.length > 0 ? (
              <ul className={styles.checklist}>
                {visibleControls.map((control) => <ChecklistControl key={control.id} control={control} />)}
              </ul>
            ) : (
              <div className={styles.emptyState}>
                <Filter size={23} aria-hidden="true" />
                <h3>No controls match these filters</h3>
                <p>Choose another category or reset the filters to return to the full review plan. A filtered empty list does not indicate security readiness.</p>
              </div>
            )}
          </div>
        </section>

        <aside className={styles.sidebar} aria-label="Security review guidance">
          <section className={styles.panel} aria-labelledby={`${id}-data-title`}>
            <div className={styles.panelHeading}>
              <div>
                <p className={styles.eyebrow}>Handle with care</p>
                <h2 id={`${id}-data-title`}>Data protection</h2>
              </div>
              <span className={`${styles.smallIcon} ${styles.dataIcon}`}><Database size={18} aria-hidden="true" /></span>
            </div>
            <p className={styles.panelDescription}>Location history and SOS records can reveal a person’s movements. Review the entire data path, including offline storage.</p>
            <dl className={styles.protectionList}>
              <div><dt>Data path to review</dt><dd>Device queue → Vercel API → Supabase. Necessary telemetry may also reach the separate ML service.</dd></div>
              <div><dt>Access boundary</dt><dd>Authenticated tenant membership, least-privilege roles and server-enforced policies. Verification pending.</dd></div>
              <div><dt>Retention & deletion</dt><dd>Unknown. Approve periods for telemetry, SOS, device storage, logs, exports and backup expiry.</dd></div>
              <div><dt>Encryption coverage</dt><dd>Unverified across transport, database, backups and removable device storage.</dd></div>
            </dl>
            <p className={styles.dataNote}><LockKeyhole size={15} aria-hidden="true" /> Use synthetic records for review exercises until real-data handling is approved.</p>
          </section>

          <section className={styles.panel} aria-labelledby={`${id}-rotation-title`}>
            <div className={styles.panelHeading}>
              <div>
                <p className={styles.eyebrow}>Operational procedure</p>
                <h2 id={`${id}-rotation-title`}>Credential rotation</h2>
              </div>
              <span className={styles.smallIcon}><KeyRound size={18} aria-hidden="true" /></span>
            </div>
            <p className={styles.panelDescription}>Guide only · rotation capability and history are unverified. Credential changes belong in the secured provisioning or service-management process.</p>
            <ol className={styles.rotationSteps}>
              {rotationSteps.map((step) => (
                <li key={step.title}>
                  <h3>{step.title}</h3>
                  <p>{step.description}</p>
                </li>
              ))}
            </ol>
            <div className={styles.rotationStatus}>
              <span>Last rotation <strong>Unknown</strong></span>
              <span>Next review <strong>Not established</strong></span>
            </div>
          </section>
        </aside>
      </div>

      <p className={styles.footerNote}><CircleHelp size={15} aria-hidden="true" /> Readiness requires dated evidence from the deployed services and target hardware, plus accountable review. This planning view is not a security assessment or certification.</p>
    </div>
  );
}
