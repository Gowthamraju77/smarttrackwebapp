"use client";

import { useId, type ReactNode } from "react";
import { Activity, Cpu, Monitor, Radio, Satellite, Wifi } from "lucide-react";
import type { HardwareKind, HardwareReport } from "@/lib/live/telemetry";
import { FeatureFlow } from "../feature-flow";
import { useLiveTelemetry } from "./live-telemetry-provider";
import styles from "./hardware-status.module.css";

const number = (report: HardwareReport | undefined, key: string): number | null => typeof report?.values[key] === "number" ? report.values[key] : null;
const flag = (report: HardwareReport | undefined, key: string): boolean | null => typeof report?.values[key] === "boolean" ? report.values[key] : null;
const text = (report: HardwareReport | undefined, key: string): string | null => typeof report?.values[key] === "string" && report.values[key] ? report.values[key] : null;
const count = (value: number | null, suffix = "") => value === null ? "Unavailable" : `${value.toLocaleString()}${suffix}`;
const yesNo = (value: boolean | null, yes = "Yes", no = "No") => value === null ? "Unavailable" : value ? yes : no;
const memory = (value: number | null) => value === null ? "Unavailable" : `${(value / 1024).toFixed(0)} KiB`;

function Row({ label, children }: { label: string; children: ReactNode }) { return <div><dt>{label}</dt><dd>{children}</dd></div>; }

export function HardwareStatus({ showEmpty = false }: { showEmpty?: boolean }) {
  const id = useId();
  const live = useLiveTelemetry();
  const snapshot = live.snapshot ?? live.capturedSnapshot;
  const hardware = snapshot?.hardware ?? {};
  const { display, modem, imu, wifi, system, firmware, gpsReceiver } = hardware;
  const now = Date.now();
  const current = (report: HardwareReport | undefined) => !!report && live.status === "connected" && snapshot?.status === "live" && now >= report.receivedAt && now - report.receivedAt <= 15_000;
  if (!showEmpty && !Object.keys(hardware).length) return null;

  const raw = snapshot?.imu.raw;
  const axes = (keys: ("ax" | "ay" | "az" | "gx" | "gy" | "gz")[], scale: number | null) => raw && scale !== null && scale > 0 ? keys.map(key => (raw[key] / scale).toFixed(2)).join(" / ") : "Unavailable";
  const temperatureScale = number(imu, "temp_lsb_per_c"), temperatureOffset = number(imu, "temp_offset_c");
  const reportedTemperature = number(imu, "temperature_c");
  const dieTemperature = reportedTemperature !== null ? `${reportedTemperature.toFixed(1)} °C` : raw && temperatureScale !== null && temperatureScale > 0 && temperatureOffset !== null ? `${(raw.temp / temperatureScale + temperatureOffset).toFixed(1)} °C` : "Unavailable";
  const reportedAxes = (prefix: string, suffix: string) => {
    const values = ["x", "y", "z"].map(axis => number(imu, `${prefix}_${axis}_${suffix}`));
    return values.every(value => value !== null) ? values.map(value => value!.toFixed(2)).join(" / ") : null;
  };
  const reportedAcceleration = reportedAxes("acceleration", "m_s2");
  const sim = text(modem, "sim_state");
  const simMissing = sim?.toUpperCase().includes("NOT INSERTED") || text(modem, "state") === "sim_missing";
  const modemSignal = number(modem, "rssi_raw") === 99 ? null : number(modem, "signal_dbm");
  const uptime = number(system, "uptime_ms");
  const elapsed = uptime === null ? "Unavailable" : `${Math.floor(uptime / 3_600_000)}h ${Math.floor(uptime / 60_000) % 60}m ${Math.floor(uptime / 1000) % 60}s`;

  function card(kind: HardwareKind, title: string, icon: ReactNode, body: ReactNode, note?: string) {
    const report = hardware[kind], fresh = current(report);
    return <article className={styles.card} data-feature-surface data-hardware-kind={kind} data-report-state={!report ? "missing" : fresh ? "current" : "historical"} data-received-at={report?.receivedAt}>
      <FeatureFlow offset={kind === "modem" ? 1 : 2} />
      <header><span className={styles.icon}>{icon}</span><h3>{title}</h3><span className={styles.badge} data-current={fresh}>{!report ? "No report" : fresh ? "Live report" : "Last report"}</span></header>
      <dl>{body}</dl>
      {note && <p className={styles.note}>{note}</p>}
      {report && <p className={styles.receipt}>Received <time dateTime={new Date(report.receivedAt).toISOString()}>{new Date(report.receivedAt).toLocaleTimeString()}</time></p>}
    </article>;
  }

  return <section className={styles.hardware} aria-labelledby={`${id}-title`}>
    <div className={styles.heading}><div><p>COMPONENT STATUS</p><h2 id={`${id}-title`}>Hardware, from the device.</h2></div><span>Updates from the running ESP32 program</span></div>
    <div className={styles.grid}>
      {card("display", "Display & touch", <Monitor size={18} />, <>
        <Row label="Renderer">{yesNo(flag(display, "ready"), "Ready", "Not ready")}</Row>
        <Row label="Screen">{text(display, "app") ?? "Unavailable"}</Row>
        <Row label="Touch calibration">{yesNo(flag(display, "calibrated"), "Loaded", "Not calibrated")}</Row>
        <Row label="Touch events">{count(number(display, "touch_events"))}</Row>
        <Row label="Display updates">{count(number(display, "flushes"))}</Row>
        <Row label="PSRAM test">{yesNo(flag(display, "psram_test"), "Passed", "Failed")}</Row>
      </>, "Renderer reports confirm software activity. Check the physical screen for visible output.")}
      {card("modem", "SIM & cellular", <Radio size={18} />, <>
        <Row label="Modem UART">{yesNo(flag(modem, "uart_connected"), "Responding", "No response")}</Row>
        <Row label="SIM detection">{simMissing ? "SIM not detected" : sim ?? "Unavailable"}</Row>
        <Row label="Network">{yesNo(flag(modem, "registered"), "Registered", "Not registered")}</Row>
        <Row label="Reported signal">{count(modemSignal, " dBm")}</Row>
        <Row label="UART baud">{count(number(modem, "baud"))}</Row>
        <Row label="Reported state">{text(modem, "state") ?? "Unavailable"}</Row>
        {text(modem, "last_error") && <Row label="Reported error">{text(modem, "last_error")}</Row>}
      </>, simMissing ? "The modem reports no SIM. A physically inserted card may still have a contact, orientation, or slot issue." : "Signal strength alone does not establish network registration or message delivery.")}
      {card("imu", text(imu, "model") ?? "Motion sensor", <Activity size={18} />, <>
        <Row label="Samples">{snapshot?.imu.available && current(imu) ? "Receiving" : raw ? "Last reading" : "Unavailable"}</Row>
        <Row label={reportedAcceleration ? "Acceleration X / Y / Z (m/s²)" : "Acceleration X / Y / Z (g)"}>{reportedAcceleration ?? axes(["ax", "ay", "az"], number(imu, "accel_lsb_per_g"))}</Row>
        <Row label="Rotation X / Y / Z (°/s)">{reportedAxes("rotation", "deg_s") ?? axes(["gx", "gy", "gz"], number(imu, "gyro_lsb_per_dps"))}</Row>
        <Row label="Sensor die temperature">{dieTemperature}</Row>
        <Row label="Sample rate">{count(number(imu, "sample_hz"), " Hz")}</Row>
        <Row label="Reported sensor errors">{count(number(imu, "errors"))}</Row>
        {text(imu, "error") && <Row label="Reported error">{text(imu, "error")}</Row>}
      </>, "Physical units come from the collector or device-reported scales. Die temperature is not ambient temperature; sensor calibration is not verified.")}
      {card("gpsReceiver", "GPS receiver", <Satellite size={18} />, <>
        <Row label="Position fix">{snapshot?.gps.fix && current(gpsReceiver) ? "Available" : "Waiting for a fix"}</Row>
        <Row label="Valid receiver sentences">{count(number(gpsReceiver, "valid"))}</Row>
        <Row label="Received bytes">{count(number(gpsReceiver, "bytes"))}</Row>
        <Row label="Receiver baud">{count(number(gpsReceiver, "baud"))}</Row>
        <Row label="ESP32 RX pin">{count(number(gpsReceiver, "rx"))}</Row>
      </>, "Receiving GPS messages does not guarantee a position. The map updates only from a valid fix.")}
      {card("wifi", "Device Wi-Fi", <Wifi size={18} />, <>
        <Row label="Connection">{yesNo(flag(wifi, "connected"), "Connected", "Disconnected")}</Row>
        <Row label="Radio mode">{text(wifi, "mode") ?? "Unavailable"}</Row>
        <Row label="Signal">{count(number(wifi, "rssi"), " dBm")}</Row>
        <Row label="Free internal heap">{memory(number(wifi, "heap_free"))}</Row>
      </>, "The website receives these reports through the device's telemetry collector.")}
      {card("system", "Runtime & memory", <Cpu size={18} />, <>
        <Row label="Device uptime">{elapsed}</Row>
        <Row label="MPU worker">{yesNo(flag(system, "mpu_task"), "Running", "Stopped")}</Row>
        <Row label="Worker sample age">{count(number(system, "sample_age_ms"), " ms")}</Row>
        <Row label="Telemetry queue drops">{count(number(system, "queue_drops"))}</Row>
        <Row label="Worker stack free">{count(number(system, "worker_stack_free_bytes"), " bytes")}</Row>
      </>)}
    </div>
    {firmware && <p className={styles.firmware}>Reported firmware: {text(firmware, "partition") ?? "Unknown partition"} · ELF <code title={text(firmware, "elf_sha256") ?? undefined}>{text(firmware, "elf_sha256")?.slice(0, 16) ?? "Unavailable"}</code> · {current(firmware) ? "Current device report" : "Last received identity"}</p>}
  </section>;
}
