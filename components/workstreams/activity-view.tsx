"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronRight,
  Clock3,
  FileClock,
  Fingerprint,
  LockKeyhole,
  Search,
  Settings2,
  ShieldCheck,
  ShieldX,
  Siren,
  SlidersHorizontal,
  Truck,
  Users,
  X,
} from "lucide-react";
import styles from "./activity-view.module.css";

type ActorRole = "owner" | "admin" | "responder" | "viewer";
type EventCategory = "access" | "sos" | "devices" | "workspace";
type EventOutcome = "allowed" | "denied";
type AuditEvent = {
  id: string;
  timestamp: string;
  category: EventCategory;
  action: string;
  actor: string;
  role: ActorRole;
  target: string;
  outcome: EventOutcome;
  summary: string;
  before: string;
  after: string;
  requested?: string;
  context: string;
};

const ROLES: ActorRole[] = ["owner", "admin", "responder", "viewer"];
const CATEGORIES = {
  access: { label: "Access & roles", icon: Users },
  sos: { label: "SOS response", icon: Siren },
  devices: { label: "Devices", icon: Truck },
  workspace: { label: "Workspace", icon: Settings2 },
} as const;

// Fixed fictional fixtures only. No user, session, API, storage, or device data is read.
// Redacted fields below contain placeholders; there is no underlying raw payload.
const SAMPLE_EVENTS: readonly AuditEvent[] = [
  {
    id: "DEMO-AUD-012", timestamp: "2026-10-11T10:42:00Z", category: "access",
    action: "Responder role granted", actor: "Demo owner 01", role: "owner",
    target: "Demo member 04", outcome: "allowed", before: "Viewer", after: "Responder",
    summary: "An owner grants a sample member the responder role.",
    context: "Role-change example. The member can respond to incidents in this fictional scenario.",
  },
  {
    id: "DEMO-AUD-011", timestamp: "2026-10-11T10:35:00Z", category: "sos",
    action: "SOS resolved", actor: "Demo responder 03", role: "responder",
    target: "Demo SOS 02", outcome: "allowed", before: "Acknowledged", after: "Resolved",
    summary: "A responder resolves an already acknowledged sample incident.",
    context: "Resolution is a separate transition from acknowledgement. This is not an emergency-service or delivery receipt.",
  },
  {
    id: "DEMO-AUD-010", timestamp: "2026-10-11T10:28:00Z", category: "sos",
    action: "SOS acknowledged", actor: "Demo responder 03", role: "responder",
    target: "Demo SOS 02", outcome: "allowed", before: "Open", after: "Acknowledged",
    summary: "A responder acknowledges a sample incident for review.",
    context: "Acknowledgement does not resolve the incident. No contact, dispatch, or notification is performed.",
  },
  {
    id: "DEMO-AUD-009", timestamp: "2026-10-11T10:22:00Z", category: "access",
    action: "Role change denied", actor: "Demo viewer 04", role: "viewer",
    target: "Demo member 03", outcome: "denied", before: "Responder", after: "Responder",
    requested: "Admin",
    summary: "A viewer attempts a role change; the sample role stays unchanged.",
    context: "Denied-role example. A viewer cannot grant membership roles. No membership was changed.",
  },
  {
    id: "DEMO-AUD-008", timestamp: "2026-10-11T09:55:00Z", category: "devices",
    action: "Device registered", actor: "Demo admin 02", role: "admin",
    target: "Demo device A", outcome: "allowed", before: "Not registered", after: "Registered",
    summary: "An administrator adds a device in the fictional workspace.",
    context: "Registration example only. No hardware was connected and no device credential was created.",
  },
  {
    id: "DEMO-AUD-007", timestamp: "2026-10-11T09:20:00Z", category: "workspace",
    action: "Activity log viewed", actor: "Demo viewer 04", role: "viewer",
    target: "Demo workspace", outcome: "allowed", before: "Read only", after: "Read only",
    summary: "A viewer opens the fictional workspace activity log.",
    context: "Read-access example. Your interactions with this preview do not create audit records.",
  },
  {
    id: "DEMO-AUD-006", timestamp: "2026-10-10T16:15:00Z", category: "access",
    action: "Member role reduced", actor: "Demo owner 01", role: "owner",
    target: "Demo member 05", outcome: "allowed", before: "Admin", after: "Viewer",
    summary: "An owner changes a sample administrator to a viewer.",
    context: "Role-reduction example. Both the previous and resulting role remain visible in the sample audit trail.",
  },
  {
    id: "DEMO-AUD-005", timestamp: "2026-10-10T15:30:00Z", category: "devices",
    action: "Device disabled", actor: "Demo admin 02", role: "admin",
    target: "Demo device B", outcome: "allowed", before: "Enabled", after: "Disabled",
    summary: "An administrator disables a sample device.",
    context: "Device-administration example. No real device, connection, or journey is affected.",
  },
  {
    id: "DEMO-AUD-004", timestamp: "2026-10-10T14:20:00Z", category: "sos",
    action: "SOS resolution denied", actor: "Demo viewer 04", role: "viewer",
    target: "Demo SOS 01", outcome: "denied", before: "Acknowledged", after: "Acknowledged",
    requested: "Resolved",
    summary: "A viewer attempts to resolve a sample incident; its state stays unchanged.",
    context: "Denied-role example. A viewer cannot resolve SOS events. The sample incident remains acknowledged.",
  },
  {
    id: "DEMO-AUD-003", timestamp: "2026-10-10T14:05:00Z", category: "sos",
    action: "SOS acknowledged", actor: "Demo admin 02", role: "admin",
    target: "Demo SOS 01", outcome: "allowed", before: "Open", after: "Acknowledged",
    summary: "An administrator acknowledges a sample incident.",
    context: "Acknowledgement example. It is recorded separately from any resolution in this fictional sequence.",
  },
  {
    id: "DEMO-AUD-002", timestamp: "2026-10-09T13:00:00Z", category: "access",
    action: "Admin role granted", actor: "Demo owner 01", role: "owner",
    target: "Demo member 02", outcome: "allowed", before: "Responder", after: "Admin",
    summary: "An owner grants a sample member the administrator role.",
    context: "Role-grant example. Actor roles describe these fixtures, not your current account permissions.",
  },
  {
    id: "DEMO-AUD-001", timestamp: "2026-10-09T11:20:00Z", category: "workspace",
    action: "Display preference changed", actor: "Demo owner 01", role: "owner",
    target: "Demo workspace", outcome: "allowed", before: "Compact", after: "Comfortable",
    summary: "An owner changes a fictional workspace display preference.",
    context: "Settings example. No browser preference or workspace configuration is saved.",
  },
];

const SAMPLE_DATES = ["2026-10-11", "2026-10-10", "2026-10-09"];
const REDACTED_METADATA = [
  ["actor_identity", "[REDACTED]"],
  ["member_contact", "[REDACTED]"],
  ["source_ip", "[REDACTED]"],
  ["precise_location", "[REDACTED]"],
  ["credentials", "[NEVER INCLUDED]"],
] as const;

function sampleDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit", month: "short", year: "numeric", timeZone: "UTC",
  }).format(new Date(`${value.slice(0, 10)}T00:00:00Z`));
}

export default function ActivityView() {
  const instanceId = useId();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<EventCategory | "all">("all");
  const [role, setRole] = useState<ActorRole | "all">("all");
  const [outcome, setOutcome] = useState<EventOutcome | "all">("all");
  const [date, setDate] = useState("all");
  const [sort, setSort] = useState("newest");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const detailTrigger = useRef<HTMLButtonElement | null>(null);
  const searchTerms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const filteredEvents = SAMPLE_EVENTS.filter((event) => {
    const searchable = [
      event.id, event.action, event.actor, event.role, event.target,
      event.summary, event.before, event.after, event.requested,
      event.outcome, CATEGORIES[event.category].label,
    ].join(" ").toLowerCase();
    return (category === "all" || event.category === category)
      && (role === "all" || event.role === role)
      && (outcome === "all" || event.outcome === outcome)
      && (date === "all" || event.timestamp.startsWith(date))
      && searchTerms.every((term) => searchable.includes(term));
  }).sort((a, b) => sort === "newest"
    ? b.timestamp.localeCompare(a.timestamp)
    : a.timestamp.localeCompare(b.timestamp));
  const selectedEvent = filteredEvents.find((event) => event.id === selectedId);
  const hasFilters = Boolean(query || category !== "all" || role !== "all" || outcome !== "all" || date !== "all");
  const detailId = `${instanceId}-detail`;

  useEffect(() => {
    if (selectedId) detailHeading.current?.focus();
  }, [selectedId]);

  function resetFilters() {
    setQuery("");
    setCategory("all");
    setRole("all");
    setOutcome("all");
    setDate("all");
    setSelectedId(null);
    searchInput.current?.focus();
  }

  function closeDetails() {
    setSelectedId(null);
    detailTrigger.current?.focus();
  }

  return (
    <div className={styles.root}>
      <header className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>Workspace oversight</p>
          <h1>Activity log</h1>
          <p className={styles.subtitle}>A clear trail of role changes, device actions, and incident responses.</p>
        </div>
        <span className={styles.privacyBadge}><LockKeyhole size={14} aria-hidden="true" /> Metadata redacted</span>
      </header>

      <div className={styles.demoBanner}>
        <span className={styles.demoIcon}><Fingerprint size={21} aria-hidden="true" /></span>
        <div>
          <strong>Synthetic audit preview · Local only</strong>
          <p>Fictional actors and events, 09–11 Oct 2026 (UTC). Filters and details stay in this view; nothing is saved or sent.</p>
        </div>
        <span className={styles.demoPill}>Demo data</span>
      </div>

      <section className={styles.metrics} aria-label="Synthetic audit summary">
        <article className={styles.metric}>
          <span className={`${styles.metricIcon} ${styles.teal}`}><FileClock size={19} aria-hidden="true" /></span>
          <div><span>Synthetic events</span><strong>{SAMPLE_EVENTS.length}<small>across 3 sample days</small></strong></div>
        </article>
        <article className={styles.metric}>
          <span className={`${styles.metricIcon} ${styles.purple}`}><Users size={19} aria-hidden="true" /></span>
          <div><span>Role-action examples</span><strong>{SAMPLE_EVENTS.filter((event) => event.category === "access").length}<small>grants, changes & denials</small></strong></div>
        </article>
        <article className={styles.metric}>
          <span className={`${styles.metricIcon} ${styles.orange}`}><ShieldX size={19} aria-hidden="true" /></span>
          <div><span>Denied-action examples</span><strong>{SAMPLE_EVENTS.filter((event) => event.outcome === "denied").length}<small>sample state unchanged</small></strong></div>
        </article>
      </section>

      <section className={styles.filterPanel} aria-labelledby={`${instanceId}-filters`}>
        <div className={styles.filterHeading}>
          <h2 id={`${instanceId}-filters`}><SlidersHorizontal size={16} aria-hidden="true" /> Filter activity</h2>
          <button type="button" className={styles.textButton} onClick={resetFilters} disabled={!hasFilters}>Clear filters</button>
        </div>
        <div className={styles.filterGrid}>
          <label className={styles.searchField}>
            <span>Search sample events</span>
            <span className={styles.searchInput}>
              <Search size={16} aria-hidden="true" />
              <input ref={searchInput} type="search" value={query} placeholder="Action, actor, target, or event ID…" onChange={(event) => { setQuery(event.target.value); setSelectedId(null); }} />
            </span>
          </label>
          <label className={styles.field}>
            <span>Actor role</span>
            <select value={role} onChange={(event) => { setRole(event.target.value as ActorRole | "all"); setSelectedId(null); }}>
              <option value="all">All roles</option>
              {ROLES.map((value) => <option key={value} value={value}>{value[0].toUpperCase() + value.slice(1)}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>Sample outcome</span>
            <select value={outcome} onChange={(event) => { setOutcome(event.target.value as EventOutcome | "all"); setSelectedId(null); }}>
              <option value="all">All outcomes</option>
              <option value="allowed">Allowed</option>
              <option value="denied">Denied</option>
            </select>
          </label>
          <label className={styles.field}>
            <span>Sample date · UTC</span>
            <select value={date} onChange={(event) => { setDate(event.target.value); setSelectedId(null); }}>
              <option value="all">All sample dates</option>
              {SAMPLE_DATES.map((value) => <option key={value} value={value}>{sampleDate(value)}</option>)}
            </select>
          </label>
        </div>
        <div className={styles.categoryFilters} role="group" aria-label="Event category">
          <button type="button" aria-pressed={category === "all"} onClick={() => { setCategory("all"); setSelectedId(null); }}>All activity</button>
          {(Object.keys(CATEGORIES) as EventCategory[]).map((value) => {
            const Icon = CATEGORIES[value].icon;
            return <button key={value} type="button" aria-pressed={category === value} onClick={() => { setCategory(value); setSelectedId(null); }}><Icon size={14} aria-hidden="true" />{CATEGORIES[value].label}</button>;
          })}
        </div>
      </section>

      <div className={styles.contentGrid}>
        <section className={styles.timelinePanel} aria-labelledby={`${instanceId}-timeline`}>
          <div className={styles.panelHeading}>
            <div><h2 id={`${instanceId}-timeline`}>Event timeline</h2><p role="status" aria-live="polite" aria-atomic="true">{filteredEvents.length} of {SAMPLE_EVENTS.length} synthetic events</p></div>
            <label className={styles.sortField}>
              <span className={styles.srOnly}>Timeline order</span>
              <select value={sort} onChange={(event) => setSort(event.target.value)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select>
            </label>
          </div>

          {filteredEvents.length === 0 ? (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}><Search size={23} aria-hidden="true" /></span>
              <h3>No matching sample events</h3>
              <p>Try a different action, role, or sample date, or clear the filters to see the full timeline.</p>
              <button type="button" className={styles.secondaryButton} onClick={resetFilters}>Clear all filters</button>
            </div>
          ) : (
            <ol className={styles.timeline}>
              {filteredEvents.map((event, index) => {
                const Icon = CATEGORIES[event.category].icon;
                const day = event.timestamp.slice(0, 10);
                const startsDay = index === 0 || filteredEvents[index - 1].timestamp.slice(0, 10) !== day;
                return (
                  <li key={event.id} className={styles.timelineItem}>
                    {startsDay && <h3 className={styles.dateHeading}><Clock3 size={13} aria-hidden="true" /><time dateTime={day}>{sampleDate(day)}</time><span>UTC</span></h3>}
                    <button
                      type="button"
                      className={styles.eventButton}
                      aria-label={`${event.action}. ${event.actor}, ${event.role}; ${event.target}. Sample outcome: ${event.outcome}. ${sampleDate(day)} at ${event.timestamp.slice(11, 16)} UTC. View event details`}
                      aria-expanded={selectedId === event.id}
                      aria-controls={detailId}
                      onClick={(click) => { detailTrigger.current = click.currentTarget; setSelectedId(event.id); if (selectedId === event.id) detailHeading.current?.focus(); }}
                    >
                      <span className={`${styles.eventIcon} ${styles[event.category]}`}><Icon size={17} aria-hidden="true" /></span>
                      <span className={styles.eventCopy}>
                        <span className={styles.eventTitle}>{event.action}</span>
                        <span className={styles.eventActor}>{event.actor}<span className={styles.roleBadge}>{event.role}</span></span>
                        <span className={styles.eventTarget}>{event.target}</span>
                      </span>
                      <span className={styles.eventMeta}>
                        <time dateTime={event.timestamp}>{event.timestamp.slice(11, 16)}</time>
                        <span className={`${styles.outcome} ${event.outcome === "denied" ? styles.denied : styles.allowed}`}>{event.outcome === "denied" ? <ShieldX size={11} aria-hidden="true" /> : <Check size={11} aria-hidden="true" />}{event.outcome}</span>
                      </span>
                      <ChevronRight className={styles.eventChevron} size={16} aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          <p className={styles.timelineFooter}><LockKeyhole size={13} aria-hidden="true" /> Fixed fixtures only. This preview does not record your activity.</p>
        </section>

        <aside
          id={detailId}
          className={styles.detailPanel}
          aria-labelledby={`${instanceId}-detail-heading`}
          onKeyDown={(event) => { if (event.key === "Escape" && selectedEvent) { event.stopPropagation(); closeDetails(); } }}
        >
          <div className={styles.detailHeader}>
            <p className={styles.eyebrow}>Event detail</p>
            {selectedEvent && <button type="button" className={styles.iconButton} aria-label="Close event details" onClick={closeDetails}><X size={17} aria-hidden="true" /></button>}
          </div>
          {selectedEvent ? (
            <>
              <h2 id={`${instanceId}-detail-heading`} ref={detailHeading} tabIndex={-1} className={styles.detailTitle}>{selectedEvent.action}</h2>
              <p className={styles.detailSummary}>{selectedEvent.summary}</p>
              <div className={styles.detailBadges}><span className={styles.demoPill}>Synthetic event</span><span className={`${styles.outcome} ${selectedEvent.outcome === "denied" ? styles.denied : styles.allowed}`}>{selectedEvent.outcome === "denied" ? "Denied · no change" : "Allowed · sample only"}</span></div>
              <dl className={styles.facts}>
                <div><dt>Event ID</dt><dd className={styles.mono}>{selectedEvent.id}</dd></div>
                <div><dt>Timestamp</dt><dd><time dateTime={selectedEvent.timestamp}>{sampleDate(selectedEvent.timestamp)} · {selectedEvent.timestamp.slice(11, 16)} UTC</time></dd></div>
                <div><dt>Actor alias</dt><dd>{selectedEvent.actor}</dd></div>
                <div><dt>Actor role</dt><dd><span className={styles.roleBadge}>{selectedEvent.role}</span></dd></div>
                <div><dt>Target alias</dt><dd>{selectedEvent.target}</dd></div>
                <div><dt>Category</dt><dd>{CATEGORIES[selectedEvent.category].label}</dd></div>
              </dl>
              <section className={styles.transitionSection} aria-labelledby={`${instanceId}-transition`}>
                <h3 id={`${instanceId}-transition`}>Sample state transition</h3>
                <div className={styles.transition}>
                  <div><span>Before</span><strong>{selectedEvent.before}</strong></div>
                  <ArrowRight size={17} aria-hidden="true" />
                  <div><span>After</span><strong>{selectedEvent.after}</strong></div>
                </div>
                {selectedEvent.requested && <p className={styles.deniedRequest}>Requested: {selectedEvent.requested}. Denied; the sample state is unchanged.</p>}
                <p className={styles.context}>{selectedEvent.context}</p>
              </section>
              <section className={styles.metadataSection} aria-labelledby={`${instanceId}-metadata`}>
                <h3 id={`${instanceId}-metadata`}><LockKeyhole size={14} aria-hidden="true" /> Redacted metadata</h3>
                <dl className={styles.metadata}>
                  <div><dt>source</dt><dd>synthetic_fixture</dd></div>
                  {REDACTED_METADATA.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
                </dl>
                <p>Placeholders only. No identities, contacts, IPs, credentials, or coordinates are loaded or hidden behind these labels.</p>
              </section>
            </>
          ) : (
            <div className={styles.detailEmpty}>
              <span className={styles.emptyIcon}><FileClock size={24} aria-hidden="true" /></span>
              <h2 id={`${instanceId}-detail-heading`}>The context behind an event</h2>
              <p>Select an event to inspect its actor role, sample outcome, state transition, and redacted metadata.</p>
              <div className={styles.privacyNote}><ShieldCheck size={17} aria-hidden="true" /><span>Only fictional aliases and safe placeholders appear in this preview.</span></div>
            </div>
          )}
        </aside>
      </div>
      <p className={styles.footnote}>Actor roles describe sample actions only. Production permissions and audit evidence require authenticated, tenant-scoped server enforcement.</p>
    </div>
  );
}
