"use client";

import { FeatureFlow } from "@/components/feature-flow";

import { LoaderCircle, Radio, Unplug, Usb } from "lucide-react";
import { useLiveTelemetry } from "./live-telemetry-provider";
import { Disclosure } from "./signal-ui";
import styles from "./connection.module.css";

export function LiveConnectionBadge() {
  const { status, snapshot, feedStatus, source, capturedSnapshot } = useLiveTelemetry();
  const receiving = status === "connected" && snapshot?.status === "live";
  const observedAt = snapshot?.receivedAt ?? capturedSnapshot?.receivedAt;
  const label = receiving ? "Receiving device data"
    : observedAt !== null && observedAt !== undefined ? "Last captured data"
    : feedStatus === "locked" ? "Connect a device"
    : feedStatus === "connecting" ? "Connecting to device feed"
    : source === "usb" && status === "connected" ? "Waiting for readings"
    : "No device data yet";
  return <span className={`${styles.connectionBadge} ${receiving ? styles.receiving : ""}`}><i aria-hidden="true" />{label}</span>;
}

export function LiveConnectionPanel() {
  const { status, supported, snapshot, capturedSnapshot, source, feedStatus, feedError, error, connect, disconnect } = useLiveTelemetry();
  const usbConnected = source === "usb" && status === "connected";
  const connecting = status === "connecting";
  const observedAt = snapshot?.receivedAt ?? capturedSnapshot?.receivedAt;
  const hasObservation = observedAt !== null && observedAt !== undefined;
  const description = usbConnected
    ? "Reading the attached ESP32 directly. Keep the USB cable connected."
    : source === "usb" && hasObservation
      ? "Showing the last measurements received over USB. Their original capture times are preserved."
    : feedStatus === "locked"
      ? "Connect your ESP32 to view its GPS, motion and captured observations."
      : hasObservation
        ? "Showing measurements captured from the ESP32. Fresh updates appear automatically when the device feed is available."
        : "Waiting for captured GPS and motion readings from the ESP32 device feed.";
  return <section className={styles.connectionPanel} aria-label="ESP32 connection" data-feature-surface><FeatureFlow offset={2} />
    <div className={styles.overview}>
      <span className={styles.connectionIcon}><Radio size={18} aria-hidden="true" /></span>
      <div className={styles.connectionCopy}>
        <span className={styles.overline}>SIGNAL LINK</span>
        <strong>ESP32-S3</strong>
      </div>
      <div className={styles.state}><LiveConnectionBadge />
        {hasObservation && <span className={styles.connectionHint}>Received <time dateTime={new Date(observedAt).toISOString()}>{new Date(observedAt).toLocaleString()}</time></span>}
      </div>
    </div>
    {(error || (feedError && feedStatus !== "locked")) && <p className={styles.connectionError} role="status">{error || feedError}</p>}
    <Disclosure title="Connection options">
      <div className={styles.connectionDetails}>
        <div><p>{description}</p>{feedStatus === "locked" && feedError && <p className={styles.hint} role="status">{feedError}</p>}<p className={styles.hint}>To use a device attached to this computer, close other serial monitors and select its USB port.</p>
          {supported === false && <p className={styles.hint}>Direct USB access requires Chrome or Edge.</p>}</div>
        {usbConnected ? <button className={styles.secondaryButton} type="button" onClick={() => void disconnect()}><Unplug size={15} aria-hidden="true" />Disconnect</button>
          : <button className={styles.primaryButton} type="button" disabled={supported !== true || connecting} onClick={() => void connect()}>{connecting ? <LoaderCircle size={16} className={styles.spinner} aria-hidden="true" /> : <Usb size={16} aria-hidden="true" />}{connecting ? "Connecting…" : "Connect ESP32"}</button>}
      </div>
    </Disclosure>
  </section>;
}
