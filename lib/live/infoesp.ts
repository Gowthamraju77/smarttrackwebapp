import type { FeedPoint, LiveFeed } from "./feed";
import type { HardwareKind, HardwareReport, HardwareTelemetry, LiveSnapshot, RawImu, TrustFactor } from "./telemetry";

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value !== null && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const number = (value: unknown, min = -1e12, max = 1e12): number | null => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : null;
const integer = (value: unknown, min = 0, max = 1e12): number | null => number(value, min, max) !== null && Number.isInteger(value) ? value as number : null;
const timestamp = (value: unknown): number | null => typeof value === "string" && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value)) && Date.parse(value) >= 0 ? Date.parse(value) : null;
const atAge = (receipt: number, seconds: unknown): number | null => number(seconds, 0, 86400 * 365) === null ? null : Math.max(0, receipt - (seconds as number) * 1000);
const recent = (at: number | null, now: number, limit: number) => at !== null && now - at >= -2000 && now - at <= limit;

/** The collector's receipt clock is authoritative; HTTP polls never renew a sensor timestamp. */
export function infoEspObservation(input: unknown, now: number): { id: string; receipt: number; connected: boolean; live: LiveSnapshot } {
  const root = object(input), latest = object(root.latest), readings = object(latest.readings);
  const receiptValue = timestamp(latest.received_at);
  if (root.name !== "infoesp" || root.schema_version !== 1 || typeof latest.sample_id !== "string"
    || !/^[A-Za-z0-9_-]{1,128}$/.test(latest.sample_id) || receiptValue === null || receiptValue > now + 2000
    || !Object.keys(readings).length) throw new Error("Invalid infoesp observation");
  const receipt: number = receiptValue;

  const connected = root.status === "live" && latest.source_available === true && readings.connected === true && readings.receiving === true;
  const streamAt = atAge(receipt, readings.last_line_age_seconds);
  const liveStream = connected && recent(streamAt, now, 5000) && recent(receipt, now, 5000);
  const gps = object(readings.gps), mpu = object(readings.mpu);
  const gpsAt = atAge(receipt, gps.age_seconds), gpsUtc = timestamp(gps.utc);
  const latitude = number(gps.latitude, -90, 90), longitude = number(gps.longitude, -180, 180);
  const position = latitude !== null && longitude !== null;
  const fix = liveStream && gps.status === "fix" && [1, 2, 3, 4, 5].includes(Number(gps.fix_quality))
    && typeof gps.fix_quality === "number" && position && recent(gpsAt, now, 10000) && recent(gpsUtc, now, 10000);
  const speedAt = atAge(receipt, gps.speed_age_seconds);
  const speedKmh = number(gps.speed_kmh, 0, 3600);
  const hdop = number(gps.hdop, 0.01, 99), satellites = integer(gps.satellites_used, 0, 99);
  const imuAt = atAge(receipt, mpu.age_seconds), rawObject = object(mpu.raw);
  const rawKeys = ["ax", "ay", "az", "gx", "gy", "gz", "temp"] as const;
  const raw = rawKeys.every(key => integer(rawObject[key], -32768, 32767) !== null)
    ? Object.fromEntries(rawKeys.map(key => [key, rawObject[key]])) as RawImu : null;
  const imuAvailable = liveStream && recent(imuAt, now, 5000) && raw !== null
    && ["receiving", "live", "ok"].includes(String(mpu.status));

  const hardware: HardwareTelemetry = {};
  function report(kind: HardwareKind, data: ObjectValue, at: number | null, fields: string[]) {
    if (at === null) return;
    const values: HardwareReport["values"] = {};
    for (const key of fields) {
      const value = data[key];
      if (typeof value === "boolean" || number(value) !== null
        || (typeof value === "string" && value.length <= 160 && !/[\x00-\x1f\x7f]/.test(value))) values[key] = value as string | number | boolean;
    }
    if (Object.keys(values).length) hardware[kind] = { receivedAt: at, values };
  }
  function reportTime(data: ObjectValue): number | null {
    const observed = timestamp(data.observed_at), aged = atAge(receipt, data.age_seconds);
    const at = aged === null ? observed : observed === null ? aged : Math.min(aged, observed);
    // A source-marked stale report must stay historical even if its clock looks recent.
    return at === null ? null : data.fresh === false ? Math.min(at, now - 15001) : at;
  }
  const display = object(readings.display), modem = object(readings.modem), rtos = object(readings.rtos);
  report("display", object(display.data), reportTime(display), ["app", "ready", "calibrated", "calibrating", "touch_pressed", "psram_test", "touch_events", "psram_bytes", "flushes", "pixels", "max_touch_sample_gap_ms", "touch_queue_drops"]);
  report("modem", modem, reportTime(modem), ["state", "model", "sim_state", "last_error", "uart_connected", "registered", "rx_pin", "tx_pin", "baud", "rssi_raw", "signal_dbm", "creg", "cgreg", "cereg", "last_response_age_ms", "scan_attempts"]);
  report("imu", { ...mpu, errors: mpu.hardware_errors }, receipt, ["status", "error", "model", "address", "who_am_i", "sample_hz", "sda", "scl", "errors", "accel_lsb_per_g", "gyro_lsb_per_dps", "temp_lsb_per_c", "temp_offset_c"]);
  // Values already expressed in physical units are kept as measurements, never converted back to invented raw counts.
  if (hardware.imu && recent(imuAt, now, 5000) && !["error", "stale"].includes(String(mpu.status))) {
    const acceleration = object(mpu.acceleration_m_s2), rotation = object(mpu.gyro_deg_s);
    for (const axis of ["x", "y", "z"]) {
      const accel = number(acceleration[axis]), gyro = number(rotation[axis]);
      if (accel !== null) hardware.imu.values[`acceleration_${axis}_m_s2`] = accel;
      if (gyro !== null) hardware.imu.values[`rotation_${axis}_deg_s`] = gyro;
    }
    const temperature = number(mpu.temperature_c, -100, 200);
    if (temperature !== null) hardware.imu.values.temperature_c = temperature;
  }
  report("wifi", object(readings.network), streamAt, ["mode", "connected", "rssi", "heap_free", "heap_min", "reset_reason"]);
  report("system", object(rtos.data), reportTime(rtos), ["uptime_ms", "mpu_task", "mpu_ready", "sample_age_ms", "queue_drops", "queued_records", "worker_stack_free_bytes"]);
  report("firmware", object(readings.firmware), streamAt, ["partition", "elf_sha256", "version", "build_date", "build_time", "address"]);
  report("gpsReceiver", { rx: gps.rx_pin, baud: gps.baud, valid: gps.valid_sentences }, gpsAt, ["rx", "baud", "valid"]);

  const freshness = fix ? Math.max(0, 1 - Math.max(0, now - gpsAt!, now - gpsUtc!) / 10000) : 0;
  const factors: TrustFactor[] = [
    { id: "freshness", label: "Position freshness", weight: 25, value: freshness, detail: "Uses the older of the collector's GPS receipt and receiver UTC; zero after 10 seconds." },
    { id: "precision", label: "GPS precision", weight: 25, value: hdop === null ? null : Math.min(1, 1 / hdop), detail: "Reported HDOP; min(1, 1 / HDOP). This is not measured position error." },
    { id: "satellites", label: "Satellites used", weight: 15, value: satellites === null ? null : Math.max(0, Math.min(1, (satellites - 3) / 9)), detail: "Receiver-reported satellites used, scaled from 3 to 12." },
    { id: "imu", label: "IMU stream", weight: 15, value: imuAvailable ? 1 : 0, detail: "Complete raw MPU measurements within 5 seconds; calibration and GPS agreement are not established." },
    { id: "stream", label: "Serial integrity", weight: 10, value: null, detail: "Raw NMEA checksums are not included in the infoesp summary; this factor is omitted." },
    { id: "chronology", label: "Observation order", weight: 10, value: null, detail: "A collector summary does not establish serial sample integrity; this factor is omitted." },
  ];
  const available = factors.filter(factor => factor.value !== null);
  const reasons = ["infoesp_summary"];
  if (!liveStream) reasons.push("infoesp_unavailable");
  if (!fix) reasons.push("gps_no_fix");
  if (!recent(gpsAt, now, 10000)) reasons.push("gps_stale");
  if (gpsUtc === null) reasons.push("gps_time_unknown");
  else if (now - gpsUtc > 10000) reasons.push("gps_timestamp_stale");
  else if (gpsUtc > now + 2000) reasons.push("gps_timestamp_future");
  if (!imuAvailable) reasons.push("imu_unavailable");
  if (hdop === null) reasons.push("gps_hdop_missing");
  if (satellites === null) reasons.push("gps_satellites_missing");

  const live: LiveSnapshot = {
    version: 1, status: liveStream ? "live" : "stale", receivedAt: streamAt,
    gps: { fix, latitude: position ? latitude : null, longitude: position ? longitude : null,
      speedMps: fix && recent(speedAt, now, 10000) && speedKmh !== null ? speedKmh / 3.6 : null,
      courseDeg: null, altitudeM: fix ? number(gps.altitude_m, -15000, 100000) : null,
      satellites, hdop, recordedAt: gpsUtc === null ? null : new Date(gpsUtc).toISOString(),
      receivedAt: gpsAt, ageMs: gpsAt === null ? null : Math.max(0, now - gpsAt), source: "INFOESP" },
    imu: { available: imuAvailable, receivedAt: imuAt, sequence: integer(mpu.valid_samples), uptimeMs: integer(mpu.device_ms), raw },
    trust: { score: fix ? Math.round(available.reduce((sum, factor) => sum + factor.weight * factor.value!, 0) / available.reduce((sum, factor) => sum + factor.weight, 0) * 100) : null,
      kind: "sensor_quality_heuristic", label: "Trust Score — live estimate", factors, reasons },
    diagnostics: { lines: integer(readings.total_lines), checksumErrors: null, invalidLines: integer(gps.invalid_sentences) }, hardware,
  };
  return { id: latest.sample_id, receipt, connected: liveStream, live };
}

/** Maintains only distinct observations. Repeated uploads and polling cannot keep old readings live. */
export function createInfoEspState({ clock = Date.now, ageSnapshot }: { clock?: () => number; ageSnapshot: (snapshot: LiveSnapshot, now: number, connected: boolean) => LiveSnapshot }) {
  const startedAt = clock();
  let latest: LiveSnapshot = { version: 1, status: "waiting", receivedAt: null,
    gps: { fix: false, latitude: null, longitude: null, speedMps: null, courseDeg: null, altitudeM: null, satellites: null, hdop: null, recordedAt: null, receivedAt: null, ageMs: null, source: "INFOESP" },
    imu: { available: false, receivedAt: null, sequence: null, uptimeMs: null, raw: null },
    trust: { score: null, kind: "sensor_quality_heuristic", label: "Trust Score — live estimate", factors: [], reasons: ["infoesp_unavailable"] },
    diagnostics: { lines: null, checksumErrors: null, invalidLines: null }, hardware: {} };
  let capturedSnapshot: LiveSnapshot | null = null;
  let trajectory: FeedPoint[] = [];
  let lastId: string | null = null, lastReceipt = -1;
  let connected = false, error: string | null = null;
  const fail = (message = "The infoesp collector is unavailable.") => { connected = false; error = message; };
  return {
    fail,
    ingest(input: unknown) {
      let observation: ReturnType<typeof infoEspObservation>;
      try { observation = infoEspObservation(input, clock()); } catch { fail("The infoesp collector returned an invalid observation."); return false; }
      if (observation.receipt < lastReceipt) { fail("The infoesp collector returned an older observation."); return false; }
      connected = observation.connected;
      error = connected ? null : "The infoesp collector is not receiving current device readings.";
      if (observation.id === lastId || observation.receipt === lastReceipt) return false;
      const next = observation.live;
      const previousGpsTime = latest.gps.recordedAt === null ? null : Date.parse(latest.gps.recordedAt);
      const nextGpsTime = next.gps.recordedAt === null ? null : Date.parse(next.gps.recordedAt);
      if (next.gps.fix && previousGpsTime !== null && nextGpsTime !== null && nextGpsTime < previousGpsTime) {
        next.gps.fix = false; next.gps.speedMps = null; next.trust.score = null; next.trust.reasons.push("gps_out_of_order");
      }
      if (nextGpsTime !== null && nextGpsTime === previousGpsTime) next.gps.receivedAt = latest.gps.receivedAt;
      if (next.imu.raw && next.imu.uptimeMs !== null && next.imu.uptimeMs === latest.imu.uptimeMs) next.imu.receivedAt = latest.imu.receivedAt;
      latest = ageSnapshot(next, clock(), connected);
      lastId = observation.id; lastReceipt = observation.receipt;
      if (latest.gps.fix && latest.status === "live") {
        capturedSnapshot = structuredClone(latest);
        if (latest.gps.recordedAt !== trajectory.at(-1)?.recordedAt) {
          trajectory = [...trajectory, { latitude: latest.gps.latitude!, longitude: latest.gps.longitude!, receivedAt: latest.gps.receivedAt!, recordedAt: latest.gps.recordedAt }].slice(-240);
        }
      }
      return true;
    },
    snapshot(): LiveFeed {
      const now = clock(), live = ageSnapshot(latest, now, connected);
      return { version: 1, source: "esp32-infoesp", startedAt, generatedAt: now, receivedAt: live.receivedAt,
        serial: { port: "infoesp", baudRate: 0, connected: connected && live.status === "live", error },
        live, capturedSnapshot: structuredClone(capturedSnapshot), trajectory: structuredClone(trajectory) };
    },
  };
}
