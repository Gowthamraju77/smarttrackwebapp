"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Crosshair, Radio } from "lucide-react";
import styles from "./signal-ui.module.css";

/** Keeps hidden details out of the tab order throughout the closing animation. */
export function Disclosure({ title, summary, children, defaultOpen = false, className = "" }: {
  title: string; summary?: string; children: ReactNode; defaultOpen?: boolean; className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(defaultOpen);
  return <div className={`${styles.disclosure} ${className}`} data-open={open}>
    <button className={styles.trigger} type="button" id={`${id}-trigger`} aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen((current) => !current)}>
      <span><strong>{title}</strong>{summary && <small>{summary}</small>}</span>
      <ChevronDown size={17} aria-hidden="true" />
    </button>
    <div className={styles.reveal} id={`${id}-panel`} role="region" aria-labelledby={`${id}-trigger`} aria-hidden={!open} inert={!open}>
      <div className={styles.clip}><div className={styles.content}>{children}</div></div>
    </div>
  </div>;
}

/** Decorative scanning motion indicates waiting, never invented progress or fixes. */
export function SignalScanner({ title = "Listening for a signal", description = "Your device observations will appear here when they arrive.", compact = false, state = "waiting" }: {
  title?: string; description?: string; compact?: boolean; state?: "waiting" | "stale" | "error";
}) {
  const visualRef = useRef<HTMLDivElement>(null);
  const [motionActive, setMotionActive] = useState(false);

  useEffect(() => {
    const visual = visualRef.current;
    if (!visual) return;
    // Decorative motion can sleep without changing the reported signal state.
    let visible = typeof IntersectionObserver === "undefined";
    const updateMotion = () => setMotionActive(visible && !document.hidden);
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      updateMotion();
    });

    observer?.observe(visual);
    document.addEventListener("visibilitychange", updateMotion);
    updateMotion();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", updateMotion);
    };
  }, []);

  return <div className={`${styles.scanner} ${compact ? styles.compact : ""}`} data-state={state} data-motion-active={motionActive}>
    <div ref={visualRef} className={styles.scannerVisual} aria-hidden="true">
      <div className={styles.lowerPlane} /><div className={styles.middlePlane} />
      <div className={styles.radarPlane}><i className={styles.grid} /><i className={styles.orbit} /><i className={styles.orbitInner} /><i className={styles.sweep} /><i className={styles.crossX} /><i className={styles.crossY} /></div>
      <span className={styles.beam} />
      <span className={styles.beacon}><Crosshair size={compact ? 20 : 26} strokeWidth={1.5} /></span>
      <span className={styles.scanLabel}><Radio size={10} /> SIGNAL SEARCH</span>
    </div>
    <div className={styles.scannerCopy}><strong>{title}</strong><p>{description}</p><span className={styles.waitingLine} aria-hidden="true"><i /><i /><i /></span></div>
  </div>;
}
