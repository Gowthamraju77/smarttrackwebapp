"use client";

import { useId, useRef, useState } from "react";
import {
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Crown,
  Eye,
  FlaskConical,
  Info,
  LockKeyhole,
  Minus,
  Radio,
  Search,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import styles from "./team-view.module.css";

type TeamRole = "owner" | "admin" | "responder" | "viewer";
type ResourceScope = "same-workspace" | "other-workspace";

const roles: readonly TeamRole[] = ["owner", "admin", "responder", "viewer"];

const roleDetails: Record<TeamRole, { label: string; description: string; icon: LucideIcon }> = {
  owner: { label: "Owner", description: "Workspace stewardship and elevated role management.", icon: Crown },
  admin: { label: "Admin", description: "Device management and operational team access.", icon: ShieldCheck },
  responder: { label: "Responder", description: "Operational visibility and SOS response.", icon: Radio },
  viewer: { label: "Viewer", description: "Read-only visibility into workspace operations.", icon: Eye },
};

type DemoMember = {
  id: string;
  name: string;
  initials: string;
  email: string;
  team: string;
  role: TeamRole;
};

// Fictional fixtures only. These are never loaded into a production membership store.
const demoMembers: readonly DemoMember[] = [
  { id: "demo-member-01", name: "Avery Morgan", initials: "AM", email: "avery@team.example.invalid", team: "Operations", role: "owner" },
  { id: "demo-member-02", name: "Jordan Lee", initials: "JL", email: "jordan@team.example.invalid", team: "Platform", role: "admin" },
  { id: "demo-member-03", name: "Blair Reed", initials: "BR", email: "blair@team.example.invalid", team: "Device operations", role: "admin" },
  { id: "demo-member-04", name: "Casey Quinn", initials: "CQ", email: "casey@team.example.invalid", team: "Response", role: "responder" },
  { id: "demo-member-05", name: "Riley Parker", initials: "RP", email: "riley@team.example.invalid", team: "Response", role: "responder" },
  { id: "demo-member-06", name: "Devon Chen", initials: "DC", email: "devon@team.example.invalid", team: "Dispatch", role: "responder" },
  { id: "demo-member-07", name: "Sam Rivera", initials: "SR", email: "sam@team.example.invalid", team: "Operations", role: "viewer" },
  { id: "demo-member-08", name: "Alex Rowan", initials: "AR", email: "alex@team.example.invalid", team: "Analysis", role: "viewer" },
];

type Capability = {
  id: string;
  label: string;
  description: string;
  allowedRoles: readonly TeamRole[];
  explanation: string;
};

// Illustrative UI policy, not authorization logic. The server must independently
// validate authenticated tenant membership and its own current role policy.
const capabilities: readonly Capability[] = [
  {
    id: "view-operations",
    label: "View operations",
    description: "Devices, journeys, telemetry and alerts",
    allowedRoles: roles,
    explanation: "All four roles can read operational data within their own workspace in this example.",
  },
  {
    id: "acknowledge-sos",
    label: "Acknowledge SOS",
    description: "Record that an SOS is being handled",
    allowedRoles: ["owner", "admin", "responder"],
    explanation: "Owners, admins and responders can acknowledge an SOS. Acknowledgement is a separate, audited transition from resolution.",
  },
  {
    id: "resolve-sos",
    label: "Resolve SOS",
    description: "Record a separate resolution transition",
    allowedRoles: ["owner", "admin", "responder"],
    explanation: "Owners, admins and responders can resolve an SOS. Production resolution also requires valid event state and audit evidence.",
  },
  {
    id: "manage-devices",
    label: "Manage devices",
    description: "Maintain the workspace device registry",
    allowedRoles: ["owner", "admin"],
    explanation: "Device management is reserved for owners and admins in this example policy.",
  },
  {
    id: "manage-operational-members",
    label: "Manage responders & viewers",
    description: "Manage operational and read-only memberships",
    allowedRoles: ["owner", "admin"],
    explanation: "Owners and admins can manage responder and viewer memberships in this example. This preview cannot edit memberships.",
  },
  {
    id: "manage-elevated-members",
    label: "Manage elevated roles",
    description: "Manage owner and admin memberships",
    allowedRoles: ["owner"],
    explanation: "Elevated role management is reserved for owners in this example. Production ownership rules must be enforced by the server.",
  },
];

export default function TeamView() {
  const id = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const explorerHeadingRef = useRef<HTMLHeadingElement>(null);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<TeamRole | "all">("all");
  const [preview, setPreview] = useState<{ role: TeamRole; memberId: string | null }>({ role: "responder", memberId: null });
  const [capabilityId, setCapabilityId] = useState("acknowledge-sos");
  const [scope, setScope] = useState<ResourceScope>("same-workspace");

  const searchTerms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const filteredMembers = demoMembers.filter((member) => {
    const searchable = `${member.name} ${member.email} ${member.team} ${member.role}`.toLowerCase();
    return (roleFilter === "all" || member.role === roleFilter) && searchTerms.every((term) => searchable.includes(term));
  });
  const hasFilters = query.length > 0 || roleFilter !== "all";
  const selectedMember = demoMembers.find((member) => member.id === preview.memberId);
  const selectedRole = roleDetails[preview.role];
  const SelectedRoleIcon = selectedRole.icon;
  const capability = capabilities.find((entry) => entry.id === capabilityId) ?? capabilities[0];
  const allowed = scope === "same-workspace" && capability.allowedRoles.includes(preview.role);
  const roleCapabilityCount = capabilities.filter((entry) => entry.allowedRoles.includes(preview.role)).length;
  const permissionExplanation = scope === "other-workspace"
    ? "A workspace role does not grant access to another workspace. Every role is blocked in this example until membership in that workspace is verified independently."
    : capability.explanation;

  function clearFilters() {
    setQuery("");
    setRoleFilter("all");
    searchRef.current?.focus();
  }

  function exploreMember(member: DemoMember) {
    setPreview({ role: member.role, memberId: member.id });
    explorerHeadingRef.current?.focus();
  }

  return (
    <div className={styles.root}>
      <header className={styles.pageHeader}>
        <div>
          <p className={styles.eyebrow}>Workspace / People</p>
          <h1>Team &amp; access</h1>
          <p className={styles.subtitle}>The right visibility. Clear responsibilities. One shared workspace.</p>
        </div>
        <span className={styles.demoBadge}><FlaskConical size={15} aria-hidden="true" /> Synthetic demo</span>
      </header>

      <div className={styles.demoNotice}>
        <Info size={19} aria-hidden="true" />
        <p><strong>A team you can explore.</strong> These members are fictional. Filters and permission checks run locally; no workspace access is changed.</p>
      </div>

      <dl className={styles.summary} aria-label="Synthetic team overview">
        <div className={styles.summaryItem}>
          <span className={styles.summaryIcon}><Users size={21} aria-hidden="true" /></span>
          <div><dt>Synthetic members</dt><dd>{demoMembers.length}<span>across the demo workspace</span></dd></div>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryIcon} data-tone="blue"><ShieldCheck size={21} aria-hidden="true" /></span>
          <div><dt>Access roles</dt><dd>{roles.length}<span>from owner to viewer</span></dd></div>
        </div>
        <div className={styles.summaryItem}>
          <span className={styles.summaryIcon} data-tone="purple"><Building2 size={21} aria-hidden="true" /></span>
          <div><dt>Permission boundary</dt><dd className={styles.scopeValue}>Workspace-scoped<span>membership is checked per tenant</span></dd></div>
        </div>
      </dl>

      <div className={styles.workspaceGrid}>
        <section className={styles.panel} aria-labelledby={`${id}-directory-title`}>
          <div className={styles.panelHeading}>
            <div><p className={styles.eyebrow}>People directory</p><h2 id={`${id}-directory-title`}>Demo members <span className={styles.countBadge}>{demoMembers.length}</span></h2></div>
            <Users size={20} className={styles.headingIcon} aria-hidden="true" />
          </div>
          <form className={styles.filters} role="search" aria-label="Filter synthetic members" onSubmit={(event) => event.preventDefault()}>
            <div className={styles.searchField}>
              <label htmlFor={`${id}-search`}>Search members</label>
              <div className={styles.searchInput}>
                <Search size={17} aria-hidden="true" />
                <input id={`${id}-search`} ref={searchRef} type="search" placeholder="Name, email or team" value={query} maxLength={120} autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
              </div>
            </div>
            <div className={styles.roleFilter}>
              <label htmlFor={`${id}-filter`}>Role</label>
              <select id={`${id}-filter`} value={roleFilter} onChange={(event) => setRoleFilter(event.target.value as TeamRole | "all")}>
                <option value="all">All roles</option>
                {roles.map((role) => <option key={role} value={role}>{roleDetails[role].label}</option>)}
              </select>
            </div>
          </form>
          <div className={styles.listToolbar}>
            <p role="status" aria-live="polite" aria-atomic="true">Showing <strong>{filteredMembers.length}</strong> of {demoMembers.length} synthetic members</p>
            <button className={styles.textButton} type="button" onClick={clearFilters} disabled={!hasFilters}>Clear filters</button>
          </div>
          {filteredMembers.length > 0 ? (
            <ul className={styles.memberList}>
              {filteredMembers.map((member) => (
                <li className={styles.member} data-selected={preview.memberId === member.id} key={member.id}>
                  <span className={styles.avatar} data-role={member.role} aria-hidden="true">{member.initials}</span>
                  <div className={styles.memberCopy}>
                    <div className={styles.memberName}><strong>{member.name}</strong><span className={styles.roleBadge} data-role={member.role}>{roleDetails[member.role].label}</span></div>
                    <span className={styles.memberEmail}>{member.email}</span>
                    <span className={styles.memberTeam}>{member.team}</span>
                  </div>
                  <button className={styles.exploreButton} type="button" aria-label={`Explore demo permissions for ${member.name}`} aria-pressed={preview.memberId === member.id} aria-controls={`${id}-explorer`} title={`Explore ${member.name}'s permissions`} onClick={() => exploreMember(member)}>
                    <ArrowRight size={17} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className={styles.emptyState}>
              <span className={styles.emptyIcon}><Search size={24} aria-hidden="true" /></span>
              <h3>No matching demo members</h3>
              <p>Try another name, email or team, or clear your filters to see the full directory.</p>
              <button className={styles.outlineButton} type="button" onClick={clearFilters}>Clear filters</button>
            </div>
          )}
          <div className={styles.panelFooter}><LockKeyhole size={15} aria-hidden="true" /><span>Directory preview only. Membership editing is not connected.</span></div>
        </section>

        <section className={`${styles.panel} ${styles.explorer}`} id={`${id}-explorer`} aria-labelledby={`${id}-explorer-title`}>
          <div className={styles.panelHeading}>
            <div><p className={styles.eyebrow}>Understand each role</p><h2 id={`${id}-explorer-title`} ref={explorerHeadingRef} tabIndex={-1}>Permission explorer</h2></div>
            <span className={styles.localBadge}>Local only</span>
          </div>
          <p className={styles.explorerIntro}>Choose a role and an action to explore the example policy.</p>
          <fieldset className={styles.rolePicker}>
            <legend>Preview role</legend>
            <div className={styles.roleOptions}>
              {roles.map((role) => {
                const RoleIcon = roleDetails[role].icon;
                return (
                  <label className={styles.roleOption} data-selected={preview.role === role} key={role}>
                    <input type="radio" name={`${id}-preview-role`} value={role} checked={preview.role === role} onChange={() => setPreview({ role, memberId: null })} />
                    <RoleIcon size={16} aria-hidden="true" />
                    <span>{roleDetails[role].label}</span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <div className={styles.roleProfile} data-role={preview.role}>
            <span className={styles.profileIcon}><SelectedRoleIcon size={21} aria-hidden="true" /></span>
            <div><strong>{selectedMember ? `${selectedMember.name} · ${selectedRole.label}` : `${selectedRole.label} access`}</strong><p>{selectedRole.description}</p><span>{roleCapabilityCount} of {capabilities.length} example capabilities in the same workspace</span></div>
          </div>

          <div className={styles.explorerField}>
            <label htmlFor={`${id}-action`}>Action to explore</label>
            <select id={`${id}-action`} value={capability.id} onChange={(event) => setCapabilityId(event.target.value)}>
              {capabilities.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
            </select>
          </div>
          <div className={styles.explorerField}>
            <label htmlFor={`${id}-scope`}>Resource workspace</label>
            <select id={`${id}-scope`} value={scope} aria-describedby={`${id}-scope-help`} onChange={(event) => setScope(event.target.value as ResourceScope)}>
              <option value="same-workspace">Same demo workspace</option>
              <option value="other-workspace">Another workspace (no membership)</option>
            </select>
            <p id={`${id}-scope-help`}>Roles apply only to the workspace where membership is held.</p>
          </div>

          <div className={styles.permissionResult} data-allowed={allowed} role="status" aria-live="polite" aria-atomic="true">
            <div className={styles.resultHeading}>{allowed ? <CheckCircle2 size={20} aria-hidden="true" /> : <LockKeyhole size={20} aria-hidden="true" />}<strong>{allowed ? "Allowed in demo policy" : "Not allowed in demo policy"}</strong></div>
            <p className={styles.resultAction}>{selectedMember ? `${selectedMember.name} (${selectedRole.label})` : selectedRole.label} <span>/</span> {capability.label}</p>
            <p>{permissionExplanation}</p>
          </div>
          <p className={styles.authorityNote}><Info size={15} aria-hidden="true" /><span>This result is illustrative. Real requests require authenticated, server-side role and tenant checks.</span></p>
        </section>
      </div>

      <section className={`${styles.panel} ${styles.matrixPanel}`} aria-labelledby={`${id}-matrix-title`}>
        <div className={styles.panelHeading}>
          <div><p className={styles.eyebrow}>At a glance</p><h2 id={`${id}-matrix-title`}>Role access matrix</h2></div>
          <span className={styles.matrixTag}><ShieldCheck size={15} aria-hidden="true" /> Example policy</span>
        </div>
        <p className={styles.matrixDescription}>Compare the four roles. The highlighted column follows the permission explorer.</p>
        <div className={styles.matrixScroll} role="region" aria-label="Role access matrix; scroll horizontally on small screens" tabIndex={0}>
          <table className={styles.matrix}>
            <caption>Illustrative permissions for the same workspace; not a live server policy.</caption>
            <thead>
              <tr><th scope="col">Capability</th>{roles.map((role) => (
                <th scope="col" className={preview.role === role ? styles.selectedColumn : undefined} key={role}>
                  {roleDetails[role].label}<span className={styles.columnHint}>{preview.role === role ? "Exploring" : "Role"}</span>
                </th>
              ))}</tr>
            </thead>
            <tbody>
              {capabilities.map((entry) => (
                <tr key={entry.id}>
                  <th scope="row"><strong>{entry.label}</strong><span>{entry.description}</span></th>
                  {roles.map((role) => {
                    const granted = entry.allowedRoles.includes(role);
                    return (
                      <td className={preview.role === role ? styles.selectedColumn : undefined} key={role}>
                        <span className={styles.matrixPermission} data-allowed={granted}>{granted ? <Check size={16} aria-hidden="true" /> : <Minus size={15} aria-hidden="true" />}{granted ? "Allowed" : "Not allowed"}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className={styles.matrixFooter}><Building2 size={17} aria-hidden="true" /><p><strong>Workspace boundaries come first.</strong> No role grants access to another tenant. Server authorization and audit evidence remain required for production changes.</p></div>
      </section>
    </div>
  );
}
