"use client";

import { useEffect, useId, useRef } from "react";
import styles from "./feature-flow.module.css";

/** Place inside a data-feature-surface host; only the decoration is clipped. */
export function FeatureFlow({ tone = "light", offset = 0 }: { tone?: "light" | "dark"; offset?: number }) {
  const layer = useRef<HTMLDivElement>(null);
  const id = useId().replace(/:/g, "");

  useEffect(() => {
    const element = layer.current;
    if (!element) return;
    let visible = false;
    const update = () => element.setAttribute("data-paused", String(!visible || document.hidden));
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      update();
    });
    observer.observe(element);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);

  return <div ref={layer} className={styles.flow} data-feature-flow data-tone={tone} data-offset={offset % 3} data-paused="true" aria-hidden="true" inert>
    <svg className={styles.folds} viewBox="0 0 700 420" preserveAspectRatio="none" focusable="false">
      <defs>
        <linearGradient id={`${id}-fold`} x1="0" y1="0" x2=".35" y2="1">
          <stop offset="0" stopColor="var(--fold-highlight)" stopOpacity="0" />
          <stop offset=".45" stopColor="var(--fold-shade)" stopOpacity=".12" />
          <stop offset=".78" stopColor="var(--fold-shade)" stopOpacity=".38" />
          <stop offset=".95" stopColor="var(--fold-light)" stopOpacity=".65" />
          <stop offset="1" stopColor="var(--fold-highlight)" stopOpacity=".85" />
        </linearGradient>
        <linearGradient id={`${id}-edge`}>
          <stop stopColor="var(--fold-highlight)" stopOpacity="0" />
          <stop offset=".6" stopColor="var(--fold-highlight)" stopOpacity=".75" />
          <stop offset="1" stopColor="var(--fold-highlight)" stopOpacity=".1" />
        </linearGradient>
      </defs>
      <g className={styles.far}>
        <path d="M-140 220C80-70 240 310 440 110S720-60 880 80L880 180C670 50 630 230 420 235S70 150-140 360Z" fill={`url(#${id}-fold)`} />
        <path d="M-140 360C70 150 210 240 420 235S670 50 880 180" fill="none" stroke={`url(#${id}-edge)`} strokeWidth="1.2" />
      </g>
      <g className={styles.near}>
        <path d="M-140 500C90 180 250 510 470 295S750 190 880 280L880 620H-140Z" fill={`url(#${id}-fold)`} />
        <path d="M-140 500C90 180 250 510 470 295S750 190 880 280" fill="none" stroke={`url(#${id}-edge)`} strokeWidth="1.4" />
        {[12, 24, 36].map(shift => <path key={shift} d="M-140 500C90 180 250 510 470 295S750 190 880 280" transform={`translate(0 ${shift})`} fill="none" stroke="var(--fold-shade)" strokeOpacity=".12" strokeWidth=".7" />)}
      </g>
    </svg>
  </div>;
}
