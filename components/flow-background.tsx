"use client";

import { useEffect, useRef } from "react";
import styles from "./flow-background.module.css";

/** Persistent decoration, independent of navigation, maps and device updates. */
export function FlowBackground() {
  const layer = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const update = () => layer.current?.setAttribute("data-paused", String(document.hidden));
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return <div ref={layer} className={styles.background} aria-hidden="true" inert data-flow-background data-paused="false">
    <div className={styles.light} />
    <div className={styles.shade} />
    <svg className={styles.landscape} viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice" focusable="false">
      <defs>
        <linearGradient id="flow-sage-fold" x1="0" y1="0" x2="0.75" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0" stopColor="#e7efd9" stopOpacity="0" />
          <stop offset=".35" stopColor="#d5e3c8" stopOpacity=".32" />
          <stop offset=".7" stopColor="#a5c6ab" stopOpacity=".48" />
          <stop offset=".87" stopColor="#dcebcf" stopOpacity=".66" />
          <stop offset="1" stopColor="#fcfff4" stopOpacity=".85" />
        </linearGradient>
        <linearGradient id="flow-ivory-fold" x1="0.2" y1="0" x2="0.7" y2="1" gradientUnits="objectBoundingBox">
          <stop offset="0" stopColor="#fcfff5" stopOpacity=".8" />
          <stop offset=".3" stopColor="#dae7ce" stopOpacity=".36" />
          <stop offset=".58" stopColor="#aec6a6" stopOpacity=".28" />
          <stop offset=".8" stopColor="#e3efdc" stopOpacity=".18" />
          <stop offset="1" stopColor="#edf4e5" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="flow-edge" x1="0" y1="0" x2="1" y2="0">
          <stop stopColor="#fffef1" stopOpacity="0" />
          <stop offset=".4" stopColor="#fffef1" stopOpacity=".8" />
          <stop offset=".75" stopColor="#92b6a0" stopOpacity=".25" />
          <stop offset="1" stopColor="#92b6a0" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g className={styles.farFold}>
        <path d="M-220 460C180 110 370 500 790 290S1390-100 1810 80L1810 510C1370 140 1050 600 630 500S100 530-220 780Z" fill="url(#flow-sage-fold)" />
        <path d="M-220 780C100 530 210 400 630 500S1370 140 1810 510" fill="none" stroke="url(#flow-edge)" strokeWidth="2" />
      </g>
      <g className={styles.nearFold}>
        <path d="M-220 900C190 430 430 1010 890 690S1370 340 1810 590L1810 1190H-220Z" fill="url(#flow-ivory-fold)" />
        <path d="M-220 900C190 430 430 1010 890 690S1370 340 1810 590" fill="none" stroke="url(#flow-edge)" strokeWidth="2" />
        {Array.from({ length: 7 }, (_, index) => <path key={index}
          d="M-220 900C190 430 430 1010 890 690S1370 340 1810 590"
          transform={`translate(0 ${14 + index * 17})`} fill="none" stroke="#779b7f" strokeOpacity={.065 - index * .007} strokeWidth=".8" />)}
      </g>
      <g className={styles.sideFold}>
        <path d="M1110-220C1430 80 960 210 1230 500S1780 780 1770 1130L1930 1130V-220Z" fill="url(#flow-sage-fold)" />
        <path d="M1110-220C1430 80 960 210 1230 500S1780 780 1770 1130" fill="none" stroke="url(#flow-edge)" strokeWidth="1.5" />
      </g>
    </svg>
    <div className={styles.grain} />
  </div>;
}
