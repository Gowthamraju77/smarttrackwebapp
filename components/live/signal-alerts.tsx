"use client";

import { FeatureFlow } from "@/components/feature-flow";

import { useState } from "react";
import { ArrowUpRight, Bell, Clock3, Fingerprint, Radio, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { TRUST_REASON_LABELS, type LiveSnapshot } from "@/lib/live/telemetry";
import { Disclosure, SignalScanner } from "./signal-ui";
import styles from "./signal-alerts.module.css";

type Category = "Signal" | "Timing" | "Integrity";
const observations: Record<string, { title: string; category: Category; action: string }> = {
  waiting_for_serial: { title: "Waiting for sensor data", category: "Signal", action: "Check the device feed or open Connection options to connect over USB." },
  stream_stale: { title: "The stream has paused", category: "Signal", action: "Check that the device is powered and its data connection is available." },
  gps_no_fix: { title: "GPS is looking for a fix", category: "Signal", action: "Give the GPS antenna a clear view of the sky and wait for a usable position." },
  gps_stale: { title: "GPS position is historical", category: "Timing", action: "Wait for a fresh GPS observation before using the position as current." },
  gps_time_unknown: { title: "GPS date is unavailable", category: "Timing", action: "Freshness currently uses receipt time. A dated RMC observation supplies GPS UTC time." },
  gps_timestamp_stale: { title: "GPS capture time has expired", category: "Timing", action: "Check the receiver output for new, correctly dated observations." },
  gps_timestamp_future: { title: "GPS and host clocks disagree", category: "Timing", action: "Check the computer clock and the UTC date reported by the receiver." },
  gps_out_of_order: { title: "An older GPS message was rejected", category: "Timing", action: "Inspect the source for delayed or replayed observations." },
  gps_jump_rejected: { title: "A position jump was rejected", category: "Integrity", action: "Inspect the next GPS fixes and receiver conditions. This flag alone does not establish spoofing." },
  gps_conflicting_fix: { title: "GPS messages disagree", category: "Integrity", action: "Inspect the receiver's RMC and GGA messages for the same observation." },
  gps_invalid_sentence: { title: "A GPS message was invalid", category: "Integrity", action: "Inspect the receiver's position, time, and fix fields." },
  gps_hdop_missing: { title: "GPS precision evidence is missing", category: "Signal", action: "Wait for a valid GGA message containing HDOP." },
  gps_satellites_missing: { title: "Satellite count is unavailable", category: "Signal", action: "Wait for the receiver to report the number of satellites used." },
  nmea_checksum_error: { title: "A damaged GPS message was rejected", category: "Integrity", action: "If this repeats, inspect the serial connection and receiver wiring." },
  imu_unavailable: { title: "Motion data is unavailable", category: "Signal", action: "Check that the device is sending complete, recent MPU samples." },
  imu_duplicate: { title: "A motion sample was repeated", category: "Timing", action: "A repeated counter cannot refresh a sample. Wait for a new counter." },
  imu_out_of_order: { title: "A motion sample arrived out of order", category: "Timing", action: "Inspect sequence and uptime counters at the source." },
  device_restarted: { title: "The device restarted", category: "Timing", action: "The previous GPS observation was cleared. Wait for new sensor evidence." },
  host_clock_reversed: { title: "The host clock moved backwards", category: "Timing", action: "Correct the host clock and wait for fresh observations." },
  line_too_long: { title: "An oversized message was discarded", category: "Integrity", action: "Inspect the serial output for malformed or unterminated lines." },
  invalid_sensor_json: { title: "A sensor message could not be read", category: "Integrity", action: "Check the diagnostic JSON format at the device source." },
};
const filters = ["All", "Signal", "Timing", "Integrity"] as const;

export function SignalAlerts({ observed, connected }: { observed: LiveSnapshot | null; connected: boolean }) {
  const [filter, setFilter] = useState<typeof filters[number]>("All");
  const reasons = [...new Set(observed?.trust.reasons ?? [])];
  const shown = reasons.filter(reason => filter === "All" || (observations[reason]?.category ?? "Integrity") === filter);
  const receivedAt = observed?.receivedAt;
  const timestamp = receivedAt === null || receivedAt === undefined ? null : new Date(receivedAt);
  return <div className={styles.alerts}>
    <section className={styles.hero} aria-labelledby="signal-review-title" data-feature-surface><FeatureFlow tone="dark" offset={2} />
      <div className={styles.heroCopy}><span className={styles.eyebrow}><span /> SIGNAL INTELLIGENCE</span><h2 id="signal-review-title">A clearer view<br />of every signal.</h2><p>Quality observations from your device.<br />Open a note to see the evidence behind it.</p>
        <span className={styles.historyLabel}><Clock3 size={13} aria-hidden="true" />{!observed ? "Awaiting the first observation" : connected ? "From the latest received observation" : "Historical observation · not a current alert"}</span>
      </div>
      <div className={styles.orb} aria-hidden="true"><div className={styles.orbRing} /><div className={styles.orbRingInner} /><span className={styles.orbCore}><Bell size={30} strokeWidth={1.3} /></span><i /><b /></div>
      <div className={styles.heroCount}><strong>{observed ? reasons.length.toString().padStart(2, "0") : "—"}</strong><span>{observed ? "quality notes" : "no observation"}</span></div>
    </section>
    <div className={styles.layout}>
      <section className={styles.inbox} aria-label="Signal quality observations" data-feature-surface><FeatureFlow offset={1} />
        <div className={styles.inboxHeader}><h2>Observation inbox</h2><span>{connected ? "Latest capture" : observed ? "Saved capture" : "Waiting"}</span></div>
        <div className={styles.filters} role="group" aria-label="Filter observations">{filters.map(item => <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)}>{item}{item === "All" && observed && <span>{reasons.length}</span>}</button>)}</div>
        {!observed ? <div className={styles.waiting}><SignalScanner compact title="Listening for your device" description="Quality notes will appear when sensor observations arrive." /></div>
          : reasons.length === 0 ? <div className={styles.empty}><ShieldCheck size={29} strokeWidth={1.4} aria-hidden="true" /><h3>No quality flags in this observation</h3><p>This describes the received sensor evidence. It is not an emergency or safety assessment.</p></div>
          : shown.length === 0 ? <div className={styles.empty}><Radio size={26} aria-hidden="true" /><h3>No {filter.toLowerCase()} notes</h3><p>Choose another category to inspect the received observations.</p></div>
          : <div className={styles.notes} key={filter}>{shown.map(reason => {
            const info = observations[reason] ?? { title: "Unclassified sensor observation", category: "Integrity", action: "Inspect this decoder observation in the signal evidence." };
            const Icon = info.category === "Timing" ? Clock3 : info.category === "Integrity" ? Fingerprint : Radio;
            return <article className={styles.note} key={reason} data-category={info.category}>
              <div className={styles.noteKind}><Icon size={14} aria-hidden="true" /><span>{info.category}</span><span>{connected ? "Latest" : "At capture"}</span></div>
              <Disclosure title={info.title} summary="View evidence & next step">
                <div className={styles.noteBody}><p>{TRUST_REASON_LABELS[reason] ?? reason}</p><div><span>Suggested check</span><p>{info.action}</p></div><code>{reason}</code></div>
              </Disclosure>
            </article>;
          })}</div>}
        {timestamp && <div className={styles.receipt}>Observation received <time dateTime={timestamp.toISOString()}>{timestamp.toLocaleString()}</time></div>}
      </section>
      <aside className={styles.side}>
        <section className={styles.emergency} data-feature-surface><FeatureFlow offset={1} /><span className={styles.sideIcon}><ShieldCheck size={21} aria-hidden="true" /></span><span className={styles.sideLabel}>EMERGENCY EVENTS</span><h2>No SOS event data supplied</h2><p>Verified SOS events and responder actions have not been supplied to this workspace.</p><span className={styles.unavailable}>Unavailable</span></section>
        <section className={styles.context} data-feature-surface><FeatureFlow offset={1} /><h2>Read the signal,<br />then the evidence.</h2><p>These notes describe sensor quality. They do not confirm an emergency or its delivery.</p><Link href="/insights">Explore Trust Score <ArrowUpRight size={15} aria-hidden="true" /></Link></section>
      </aside>
    </div>
  </div>;
}
