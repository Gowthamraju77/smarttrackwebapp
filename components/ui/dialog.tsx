"use client";

import {
  useEffect,
  useId,
  useRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
  type RefObject,
  type SyntheticEvent,
} from "react";
import styles from "./dialog.module.css";

type NativeDialogProps = Omit<
  ComponentPropsWithoutRef<"dialog">,
  | "open"
  | "onClose"
  | "onCancel"
  | "title"
  | "children"
  | "role"
  | "tabIndex"
  | "autoFocus"
  | "aria-label"
  | "aria-labelledby"
  | "aria-describedby"
  | "aria-modal"
>;

/** Other native dialog attributes, such as id, className and style, are forwarded. */
export interface DialogProps extends NativeDialogProps {
  /** Controlled visibility. The parent must update this when onOpenChange is called. */
  open: boolean;
  /** Requests closure with false on Escape, the close button, or a native method="dialog" form. */
  onOpenChange: (open: boolean) => void;
  /** Required visible title, also used as the accessible dialog name. */
  title: string;
  /** Optional short description announced with the dialog. Put complex content in children. */
  description?: ReactNode;
  /** Dialog body. State is retained while closed because children remain mounted. */
  children?: ReactNode;
  /** Optional caller-owned actions, such as Cancel and Confirm buttons. */
  footer?: ReactNode;
  /** Optional focusable descendant to focus when opened; otherwise the title receives focus. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Accessible close-button label. Defaults to "Close dialog". */
  closeLabel?: string;
}

/**
 * A controlled modal using native showModal() for background inertness, focus
 * containment and restoration to the opener. Escape uses the native cancel event;
 * clicking the backdrop does not dismiss. Requires native HTMLDialogElement support.
 * @example
 * <Dialog open={open} onOpenChange={setOpen} title="Device details">
 *   <p>Select a device to inspect its reported status.</p>
 * </Dialog>
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  initialFocusRef,
  closeLabel = "Close dialog",
  className,
  ...props
}: DialogProps) {
  const instanceId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleId = `${instanceId}-title`;
  const descriptionId = `${instanceId}-description`;
  const hasDescription = description != null && description !== false;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      const initialFocus = initialFocusRef?.current;
      if (initialFocus && dialog.contains(initialFocus)) {
        initialFocus.focus({ preventScroll: true });
      } else {
        titleRef.current?.focus({ preventScroll: true });
      }
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, initialFocusRef]);

  useEffect(() => {
    const dialog = dialogRef.current;
    return () => {
      // Close on unmount too, allowing the browser to restore the opener's focus.
      if (dialog?.open) dialog.close();
    };
  }, []);

  function handleCancel(event: SyntheticEvent<HTMLDialogElement>) {
    // Keep the open prop authoritative, including when the parent declines closure.
    event.preventDefault();
    onOpenChange(false);
  }

  function handleClose(event: SyntheticEvent<HTMLDialogElement>) {
    // Native forms can close the element themselves. Ignore queued close events
    // after a reopen (including React Strict Mode's effect cleanup/replay).
    if (!event.currentTarget.open && open) onOpenChange(false);
  }

  return (
    <dialog
      {...props}
      ref={dialogRef}
      className={[styles.dialog, className].filter(Boolean).join(" ")}
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={hasDescription ? descriptionId : undefined}
      onCancel={handleCancel}
      onClose={handleClose}
    >
      <header className={styles.header}>
        <div className={styles.heading}>
          <h2 className={styles.title} id={titleId} ref={titleRef} tabIndex={-1}>{title}</h2>
          {hasDescription && (
            <div className={styles.description} id={descriptionId}>{description}</div>
          )}
        </div>
        <button
          className={styles.closeButton}
          type="button"
          aria-label={closeLabel}
          onClick={() => onOpenChange(false)}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" focusable="false">
            <path d="m6 6 12 12M6 18 18 6" />
          </svg>
        </button>
      </header>
      {children != null && children !== false && <div className={styles.body}>{children}</div>}
      {footer != null && footer !== false && <footer className={styles.footer}>{footer}</footer>}
    </dialog>
  );
}
