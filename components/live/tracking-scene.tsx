"use client";

import { Activity, Crosshair, Radio, Satellite } from "lucide-react";
import styles from "./tracking-scene.module.css";

type SignalState = "live" | "captured" | "waiting";
type Props = { gps: SignalState; motion: SignalState; connected: boolean };

const label = (state: SignalState) => state === "live" ? "Receiving" : state === "captured" ? "At capture" : "Waiting";

/** An abstract receiver instrument, not geography, motion orientation, or signal strength. */
export function TrackingScene({ gps, motion, connected }: Props) {
  return <div className={styles.scene} aria-hidden="true" data-connected={connected}>
    <div className={styles.assembly}>
      <div className={styles.basePlate} />
      <div className={styles.signalPlate}>
        <svg viewBox="0 0 200 200" className={styles.circuit}>
          <path d="M26 48H71V77M173 151H129V121M39 159V120H77M166 39V81H126" />
          <circle cx="100" cy="100" r="59" />
          <circle cx="100" cy="100" r="43" strokeDasharray="1 7" />
          <path d="M100 23V35M100 165V177M23 100H35M165 100H177" />
        </svg>
        <i className={styles.pinA} data-state={gps} />
        <i className={styles.pinB} data-state={motion} />
        <span className={styles.plateMark}>SMARTTRACK / S3</span>
      </div>
      <div className={styles.receiverBase} />
      <div className={styles.receiver}>
        <span className={styles.receiverTop}><Crosshair size={29} strokeWidth={1.25} /><i /></span>
        <span className={styles.receiverLabel}>ESP32</span>
      </div>
      <div className={styles.topRing} />
    </div>
    <span className={`${styles.signalPill} ${styles.gpsPill}`} data-state={gps}><Satellite size={12} strokeWidth={1.7} /><span>GPS</span><b>{label(gps)}</b></span>
    <span className={`${styles.signalPill} ${styles.motionPill}`} data-state={motion}><Activity size={12} strokeWidth={1.7} /><span>MPU</span><b>{label(motion)}</b></span>
    <span className={styles.linkPill}><Radio size={10} strokeWidth={1.7} />{connected ? "STREAM ACTIVE" : "DEVICE LINK"}</span>
  </div>;
}
