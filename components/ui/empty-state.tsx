"use client";

import { useId, type ComponentPropsWithoutRef, type ReactNode } from "react";
import styles from "./empty-state.module.css";

/** Native section attributes are forwarded; accessible naming can be overridden with ARIA. */
export interface EmptyStateProps extends Omit<ComponentPropsWithoutRef<"section">, "title" | "children"> {
  /** Required visible heading describing the missing results or unavailable data. */
  title: string;
  /** Optional explanation or a useful next step; no default data is invented. */
  description?: ReactNode;
  /** Optional decorative artwork, hidden from assistive technology. Do not put controls here. */
  icon?: ReactNode;
  /** Optional caller-owned buttons or links, with their own labels and behavior. */
  action?: ReactNode;
  /** Match the surrounding document outline. Defaults to h2. */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
}

/**
 * A labelled empty-state region with optional explanatory text and real actions.
 * @example <EmptyState title="No journeys found" description="Try a wider date range." />
 */
export function EmptyState({
  title,
  description,
  icon,
  action,
  headingLevel = 2,
  className,
  ...props
}: EmptyStateProps) {
  const instanceId = useId();
  const titleId = `${instanceId}-title`;
  const descriptionId = `${instanceId}-description`;
  const Heading = `h${headingLevel}` as const;
  const hasDescription = description != null && description !== false;

  return (
    <section
      {...props}
      className={[styles.emptyState, className].filter(Boolean).join(" ")}
      aria-labelledby={props["aria-labelledby"] ?? titleId}
      aria-describedby={props["aria-describedby"] ?? (hasDescription ? descriptionId : undefined)}
    >
      {icon != null && icon !== false && (
        <div className={styles.icon} aria-hidden="true">{icon}</div>
      )}
      <Heading className={styles.title} id={titleId}>{title}</Heading>
      {hasDescription && (
        <div className={styles.description} id={descriptionId}>{description}</div>
      )}
      {action != null && action !== false && <div className={styles.actions}>{action}</div>}
    </section>
  );
}
