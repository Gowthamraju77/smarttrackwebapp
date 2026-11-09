"use client";

import { FeatureFlow } from "@/components/feature-flow";

import { Bell, Check, Clock3, Mail, Pencil, Radio, Route, UserRound } from "lucide-react";
import { useId } from "react";
import { NOTIFICATION_INTERVALS, intervalLabel, type NotificationMode } from "@/lib/notifications";
import { useContact } from "./contact-provider";
import { useLiveTelemetry } from "@/components/live/live-telemetry-provider";
import styles from "./contacts.module.css";

export function ContactBadge() {
  const { contact } = useContact();
  const initials = contact?.profile.name.split(" ").slice(0, 2).map(part => part[0]).join("").toUpperCase() ?? "ST";
  return <span className={styles.badge}><span className="topbar-avatar" aria-hidden="true">{initials}</span><span className={styles.badgeName}>{contact?.profile.name}</span></span>;
}

export function NotificationSettings({ only }: { only?: NotificationMode }) {
  const { contact, savePreferences, status, syncing, message, storageWarning, mode, retry, edit, canResumeGeneral, resumeGeneral } = useContact();
  const id = useId();
  if (!contact) return null;
  const modes: NotificationMode[] = only ? [only] : ["general", "journey"];
  return <section className={styles.settings} aria-labelledby={`${id}-title`} data-feature-surface><FeatureFlow offset={2} />
    <header className={styles.sectionHeader}><span className={styles.sectionIcon}><Bell size={20} /></span><div><p className={styles.eyebrow}>STAY IN THE LOOP</p><h2 id={`${id}-title`}>{only === "journey" ? "Journey updates" : "Your notification rhythm"}</h2></div><span className={styles.pill}>Email + SMS</span></header>
    {!only && <div className={styles.profile}><span className={styles.avatar}><UserRound size={22} /></span><div><strong>{contact.profile.name}</strong><span>{contact.profile.email}</span><span>{contact.profile.phone}</span></div><button type="button" onClick={edit} aria-label="Edit contact details"><Pencil size={15} />Edit</button></div>}
    <p className={styles.description}>Choose how often to hear from SmartTrack. Journey timing takes over while a journey is waiting to start or in progress; general timing resumes when it ends.</p>
    {canResumeGeneral && <button className={styles.textButton} type="button" onClick={resumeGeneral}>Resume general timing</button>}
    <div className={styles.schedules} data-single={!!only}>
      {modes.map(kind => {
        const setting = contact.preferences[kind], active = mode === kind;
        return <div className={styles.schedule} key={kind} data-active={active} data-feature-surface><FeatureFlow offset={1} />
          <div className={styles.scheduleHeading}><span>{kind === "journey" ? <Route size={19} /> : <Radio size={19} />}<strong>{kind === "general" ? "General updates" : "Journey mode"}</strong></span><label className={styles.toggle}><input type="checkbox" checked={setting.enabled} aria-label={`Enable ${kind} email and SMS updates`} onChange={event => savePreferences({ ...contact.preferences, [kind]: { ...setting, enabled: event.target.checked } })} /><span /></label></div>
          <p>{kind === "general" ? "A regular check-in outside your journeys." : "A check-in while your journey is underway."}</p>
          <fieldset className={styles.intervals}><legend>Send every</legend>{NOTIFICATION_INTERVALS.map(minutes => <label key={minutes}><input type="radio" name={`${id}-${kind}`} value={minutes} checked={setting.minutes === minutes} onChange={() => savePreferences({ ...contact.preferences, [kind]: { ...setting, minutes } })} /><span>{intervalLabel(minutes)}{setting.minutes === minutes && <Check size={12} aria-hidden="true" />}</span></label>)}</fieldset>
          <div className={styles.scheduleFooter}><Clock3 size={14} />{setting.enabled ? `Every ${intervalLabel(setting.minutes)} · ${active ? "current mode" : "standing by"}` : "Updates off · enable when you’re ready"}</div>
        </div>;
      })}
    </div>
    <div className={styles.sync} role="status" aria-live="polite"><Mail size={17} aria-hidden="true" /><div><strong>{syncing ? "Syncing your preferences…" : status?.available ? "Email + SMS configured" : "Delivery not active"}</strong><p>{message}</p>
      {status?.nextDue && <p>Next scheduled check: {new Date(status.nextDue).toLocaleString()}. Allow up to a minute for scheduling and provider processing.</p>}
      {status && !status.available && <p>Email: {status.email ? "configured" : "setup needed"} · SMS: {status.sms ? "configured" : "setup needed"}</p>}
      {storageWarning && <p>This browser blocked storage. Your details will need to be entered again after a reload.</p>}
    </div><button type="button" onClick={retry} disabled={syncing}>Retry sync</button></div>
    {status?.deliveries.length ? <details className={styles.receipts}><summary>Recent delivery attempts</summary><ul>{status.deliveries.map((delivery, index) => <li key={`${delivery.created_at}-${index}`}><span>{delivery.channel === "email" ? "Email" : "SMS"}</span><strong>{delivery.status === "accepted" ? "Accepted by provider" : delivery.status === "uncertain" ? "Delivery unconfirmed" : delivery.status}</strong><time>{new Date(delivery.created_at).toLocaleString()}</time></li>)}</ul><p>Provider acceptance does not confirm arrival in an inbox or on a phone.</p></details> : null}
    <p className={styles.footnote}>Synced schedules continue when this tab is closed. Keep the journey tab open to sync journey changes. Turning updates off needs a successful sync to stop an existing schedule.</p>
  </section>;
}

export function ConnectedContacts() {
  const { contact, contacts, status, edit } = useContact();
  const live = useLiveTelemetry();
  if (!contact) return null;
  const others = contacts.filter(person => person.id !== contact.id);
  const fresh = (person: typeof others[number]) => person.connected && Date.now() - new Date(person.last_seen_at).getTime() < 150_000;
  return <section className={styles.settings} aria-label="Device connections" data-feature-surface><FeatureFlow offset={2} /><header className={styles.sectionHeader}><span className={styles.sectionIcon}><UserRound size={20} /></span><div><p className={styles.eyebrow}>THE PEOPLE BEHIND THE SIGNAL</p><h2>Device connections</h2></div></header>
    <p className={styles.description}>Names supplied by visitors using this device workspace. These are contact labels, with no identity verification.</p>
    <div className={styles.person}><span className={styles.avatar}><UserRound size={21} /></span><div><strong>{contact.profile.name} <small>You</small></strong><span>{live.status === "connected" ? `Connected through ${live.source === "usb" ? "USB" : "device feed"}` : "Workspace open · device not connected"}</span></div><button type="button" onClick={edit}>Edit details</button></div>
    {others.map(person => <div className={styles.person} key={person.id}><span className={styles.avatar}><UserRound size={21} /></span><div><strong>{person.name}</strong><span>{fresh(person) ? `Recently connected · ${person.source === "usb" ? "USB" : "device feed"}` : `Last seen ${new Date(person.last_seen_at).toLocaleString()}`}</span></div></div>)}
    <p className={styles.footnote}>{status ? "Shared connections refresh about every minute. Other visitors’ phone numbers and email addresses stay private." : "Showing this tab’s contact. Shared connections appear after the device connection service is configured and synced."}</p>
  </section>;
}
