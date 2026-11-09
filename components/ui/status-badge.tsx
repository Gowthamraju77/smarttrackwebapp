"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import styles from "./status-badge.module.css";

export type StatusBadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

/** Native span attributes, including aria-live, are also supported. */
export interface StatusBadgeProps extends Omit<ComponentPropsWithoutRef<"span">, "children"> {
  /** Visible status text; include words so meaning never depends on color alone. */
  children: ReactNode;
  /** Visual emphasis only; no status or live-data claim is inferred. Defaults to neutral. */
  tone?: StatusBadgeTone;
  /** Compact (sm, default) or regular (md) spacing. */
  size?: "sm" | "md";
  /** Include a decorative, screen-reader-hidden dot. Defaults to true. */
  showDot?: boolean;
}

/**
 * A non-interactive status label. It does not announce updates by default;
 * use role="status" when this particular label needs polite live announcements.
 * @example <StatusBadge tone="warning">Location unavailable</StatusBadge>
 */
export function StatusBadge({
  children,
  tone = "neutral",
  size = "sm",
  showDot = true,
  className,
  ...props
}: StatusBadgeProps) {
  return (
    <span
      {...props}
      className={[styles.badge, styles[tone], styles[size], className].filter(Boolean).join(" ")}
    >
      {showDot && <span className={styles.dot} aria-hidden="true" />}
      <span className={styles.label}>{children}</span>
    </span>
  );
}
