/**
 * Browser-safe decoder for the ESP32 diagnostic serial stream.
 *
 * Receipt timestamps are host-clock milliseconds, never device capture times.
 * GPS positions come only from checksum-valid, positioned RMC/GGA sentences.
 * MPU values remain signed raw register counts: scale, orientation and
 * calibration are not known. The quality estimate is a documented heuristic,
 * not trained ML, spoof detection, a safety probability, or an SOS receipt.
 */

export const GPS_STALE_MS = 10_000;
export const STREAM_STALE_MS = 5_000;
export const IMU_STALE_MS = 5_000;
const MAX_LINE_LENGTH = 4096;
const DAY_MS = 86_400_000;

export type TrustFactor = {
  id: string;
  label: string;
  weight: number;
  /** Fraction in [0, 1], or null when this evidence is unavailable. */
  value: number | null;
  detail: string;
};

export type RawImu = { ax: number; ay: number; az: number; gx: number; gy: number; gz: number; temp: number };

export type HardwareKind = "display" | "modem" | "imu" | "wifi" | "system" | "firmware" | "gpsReceiver";
export type HardwareReport = { receivedAt: number; values: Record<string, string | number | boolean> };
export type HardwareTelemetry = Partial<Record<HardwareKind, HardwareReport>>;

// Only these diagnostic fields may leave the local reader. Wi-Fi names,
// addresses, credentials, raw modem responses and SIM identifiers are omitted.
const hardwareFields: Record<string, { kind: HardwareKind; text?: string[]; flags?: string[]; numbers?: string[] }> = {
  UI_STATUS: { kind: "display", text: ["app"], flags: ["ready", "calibrated", "calibrating", "touch_pressed", "psram_test"], numbers: ["touch_events", "psram_bytes", "flushes", "pixels", "max_touch_sample_gap_ms", "touch_queue_drops"] },
  MODEM_STATUS: { kind: "modem", text: ["state", "model", "sim_state", "last_error"], flags: ["uart_connected", "registered"], numbers: ["rx_pin", "tx_pin", "baud", "rssi_raw", "signal_dbm", "creg", "cgreg", "cereg", "last_response_age_ms", "rx_bytes", "scan_attempts"] },
  MPU_INFO: { kind: "imu", text: ["model"], numbers: ["address", "who_am_i", "accel_lsb_per_g", "gyro_lsb_per_dps", "sample_hz", "sda", "scl", "errors", "temp_lsb_per_c", "temp_offset_c"] },
  WIFI_STATUS: { kind: "wifi", text: ["mode"], flags: ["configured", "connected"], numbers: ["rssi", "heap_free", "heap_min", "reset_reason"] },
  RTOS_STATUS: { kind: "system", flags: ["mpu_task", "mpu_ready"], numbers: ["uptime_ms", "sample_age_ms", "queue_drops", "queued_records", "worker_stack_free_bytes"] },
  FIRMWARE_INFO: { kind: "firmware", text: ["partition", "elf_sha256", "version", "build_date", "build_time"], numbers: ["address"] },
  GPS_STATUS: { kind: "gpsReceiver", numbers: ["rx", "baud", "bytes", "valid"] },
};

function hardwareLine(line: string, at: number): { kind: HardwareKind; report: HardwareReport } | null {
  const match = /^([A-Z_]+)\s+(.*)$/.exec(line);
  const fields = match && hardwareFields[match[1]];
  if (!match || !fields) return null;
  const value: unknown = match[1] === "GPS_STATUS"
    ? Object.fromEntries([...match[2].matchAll(/\b([a-z_]+)=([^\s]+)/g)].map(entry => [entry[1], Number(entry[2])]))
    : JSON.parse(match[2]);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid hardware report");
  const raw = value as Record<string, unknown>, values: HardwareReport["values"] = {};
  for (const key of fields.text ?? []) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "string" || raw[key].length > 160 || /[\x00-\x1f\x7f]/.test(raw[key])) throw new Error("Invalid diagnostic text");
    values[key] = raw[key];
  }
  for (const key of fields.flags ?? []) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "boolean") throw new Error("Invalid diagnostic flag");
    values[key] = raw[key];
  }
  for (const key of fields.numbers ?? []) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== "number" || !Number.isFinite(raw[key]) || Math.abs(raw[key]) > 1e12) throw new Error("Invalid diagnostic number");
    values[key] = raw[key];
  }
  if (!Object.keys(values).length) throw new Error("Empty hardware report");
  return { kind: fields.kind, report: { receivedAt: at, values } };
}

export type LiveSnapshot = {
  version: 1;
  status: "waiting" | "live" | "stale";
  receivedAt: number | null;
  gps: {
    fix: boolean;
    /** Retained after fix loss as last-known coordinates; check fix and ageMs. */
    latitude: number | null;
    longitude: number | null;
    speedMps: number | null;
    courseDeg: number | null;
    altitudeM: number | null;
    satellites: number | null;
    hdop: number | null;
    /** GPS UTC timestamp, or null when only undated GGA is available. */
    recordedAt: string | null;
    receivedAt: number | null;
    ageMs: number | null;
    source: "RMC" | "GGA" | "INFOESP" | null;
  };
  imu: {
    available: boolean;
    receivedAt: number | null;
    sequence: number | null;
    uptimeMs: number | null;
    raw: RawImu | null;
  };
  trust: {
    score: number | null;
    kind: "sensor_quality_heuristic";
    label: "Trust Score — live estimate";
    factors: TrustFactor[];
    reasons: string[];
  };
  diagnostics: { lines: number | null; checksumErrors: number | null; invalidLines: number | null };
  hardware?: HardwareTelemetry;
};

export const TRUST_REASON_LABELS: Readonly<Record<string, string>> = {
  infoesp_unavailable: "The infoesp collector is not receiving current device readings.",
  infoesp_invalid: "The collector returned an invalid or out-of-order observation.",
  infoesp_summary: "Quality uses the collector's reported measurements; raw NMEA checksums are not supplied by this feed.",
  waiting_for_serial: "Waiting for sensor data from the selected serial port.",
  stream_stale: "No valid sensor message received in the last five seconds.",
  gps_no_fix: "The receiver has not supplied a usable GPS position.",
  gps_stale: "The last positioned GPS observation is older than ten seconds.",
  gps_time_unknown: "GPS date is unavailable; freshness uses serial receipt time.",
  gps_timestamp_stale: "The GPS capture timestamp is older than ten seconds.",
  gps_timestamp_future: "GPS time is ahead of the host clock by more than two seconds.",
  gps_out_of_order: "An older GPS observation was rejected.",
  gps_jump_rejected: "A position jump exceeded the 100 m/s and 100 m sanity limits.",
  gps_conflicting_fix: "Receiver sentences disagree about the same GPS observation.",
  gps_invalid_sentence: "A GPS sentence had invalid position, time, or fix fields.",
  gps_hdop_missing: "Current GPS precision evidence is unavailable.",
  gps_satellites_missing: "Current satellites-used evidence is unavailable.",
  nmea_checksum_error: "A damaged NMEA sentence was rejected.",
  imu_unavailable: "A complete recent raw IMU sample is unavailable.",
  imu_duplicate: "A repeated IMU counter did not refresh the sample.",
  imu_out_of_order: "An out-of-order IMU sample was rejected.",
  device_restarted: "A device restart cleared the previous GPS observation.",
  host_clock_reversed: "The host clock moved backwards; freshness cannot be established.",
  line_too_long: "An oversized serial line was discarded.",
  invalid_sensor_json: "A malformed sensor diagnostic line was rejected.",
  invalid_hardware_json: "A malformed hardware status report was rejected.",
};

type Position = {
  latitude: number;
  longitude: number;
  timeOfDay: number;
  recordedMs: number | null;
  receivedAt: number;
  source: "RMC" | "GGA";
};
type TimedNumber = { value: number; receivedAt: number } | null;

function number(value: string): number | null {
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function bounded(value: unknown, min: number, max: number, integer = false): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max
    && (!integer || Number.isInteger(value));
}

function coordinate(value: string, hemisphere: string, latitude: boolean): number | null {
  const pattern = latitude ? /^\d{4}(?:\.\d+)?$/ : /^\d{5}(?:\.\d+)?$/;
  if (!pattern.test(value) || !(latitude ? /^(N|S)$/ : /^(E|W)$/).test(hemisphere)) return null;
  const degreeDigits = latitude ? 2 : 3;
  const degrees = Number(value.slice(0, degreeDigits));
  const minutes = Number(value.slice(degreeDigits));
  const result = degrees + minutes / 60;
  if (minutes >= 60 || result > (latitude ? 90 : 180)) return null;
  return /^(S|W)$/.test(hemisphere) ? -result : result;
}

function timeOfDay(value: string): number | null {
  if (!/^\d{6}(?:\.\d+)?$/.test(value)) return null;
  const hour = Number(value.slice(0, 2));
  const minute = Number(value.slice(2, 4));
  const seconds = Number(value.slice(4));
  if (hour > 23 || minute > 59 || seconds >= 60) return null;
  return Math.round(((hour * 60 + minute) * 60 + seconds) * 1000);
}

function rmcTimestamp(date: string, clock: number): number | null {
  if (!/^\d{6}$/.test(date)) return null;
  const day = Number(date.slice(0, 2));
  const month = Number(date.slice(2, 4));
  const shortYear = Number(date.slice(4, 6));
  const year = shortYear + (shortYear >= 80 ? 1900 : 2000);
  const stamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(stamp);
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return stamp + clock;
}

function distanceMetres(a: Position, b: Position): number {
  const radians = Math.PI / 180;
  const dlat = (b.latitude - a.latitude) * radians;
  const dlon = (b.longitude - a.longitude) * radians;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin(dlon / 2) ** 2;
  return 12_742_017.6 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

function age(at: number | null, now: number): number | null {
  return at === null ? null : Math.max(0, now - at);
}

/** Keep one decoder per serial connection; reset it before selecting a new port. */
export class TelemetryDecoder {
  private textDecoder = new TextDecoder();
  private pending = "";
  private droppingLine = false;
  private receivedAt: number | null = null;
  private position: Position | null = null;
  private fixValid = false;
  private invalidFixTime: number | null = null;
  private rmcDateAnchor: number | null = null;
  private speed: TimedNumber = null;
  private course: TimedNumber = null;
  private altitude: TimedNumber = null;
  private hdop: TimedNumber = null;
  private satellites: TimedNumber = null;
  private imu: LiveSnapshot["imu"] = { available: false, receivedAt: null, sequence: null, uptimeMs: null, raw: null };
  private hardware: HardwareTelemetry = {};
  private issues = new Map<string, number>();
  private integrity: boolean[] = [];
  private diagnostics = { lines: 0, checksumErrors: 0, invalidLines: 0 };

  reset(): void {
    this.textDecoder = new TextDecoder();
    this.pending = "";
    this.droppingLine = false;
    this.receivedAt = null;
    this.clearSensors();
    this.issues.clear();
    this.integrity = [];
    this.diagnostics = { lines: 0, checksumErrors: 0, invalidLines: 0 };
  }

  private clearSensors(): void {
    this.hardware = {};
    this.position = null;
    this.fixValid = false;
    this.invalidFixTime = null;
    this.rmcDateAnchor = null;
    this.speed = this.course = this.altitude = this.hdop = this.satellites = null;
    this.imu = { available: false, receivedAt: null, sequence: null, uptimeMs: null, raw: null };
  }

  /** Buffers partial lines. Both LF and CRLF input are accepted. */
  push(chunk: string | Uint8Array, receivedAt = Date.now()): LiveSnapshot {
    if (!Number.isFinite(receivedAt) || receivedAt < 0) throw new RangeError("receivedAt must be host-clock milliseconds");
    const decoded = typeof chunk === "string" ? chunk : this.textDecoder.decode(chunk, { stream: true });
    for (const character of decoded) {
      if (character === "\n" || character === "\r") {
        if (!this.droppingLine && this.pending.trim()) this.line(this.pending.trim(), receivedAt);
        this.pending = "";
        this.droppingLine = false;
      } else if (!this.droppingLine) {
        this.pending += character;
        if (this.pending.length > MAX_LINE_LENGTH) {
          this.pending = "";
          this.droppingLine = true;
          this.bad("line_too_long", receivedAt);
        }
      }
    }
    return this.snapshot(receivedAt);
  }

  private bad(reason: string, at: number, checksum = false): void {
    if (checksum) this.diagnostics.checksumErrors += 1;
    else this.diagnostics.invalidLines += 1;
    this.issues.set(reason, at);
    this.integrity.push(false);
    if (this.integrity.length > 100) this.integrity.shift();
  }

  private good(at: number): void {
    this.receivedAt = at;
    this.integrity.push(true);
    if (this.integrity.length > 100) this.integrity.shift();
  }

  private line(line: string, at: number): void {
    this.diagnostics.lines += 1;
    if (/^(?:ESP-ROM:|rst:0x|ets\s|SMARTTRACK_BOOT\b|BOOT(?:_START|_READY)?(?:\s|$))/.test(line)) {
      this.clearSensors();
      this.issues.set("device_restarted", at);
      return;
    }
    const jsonMatch = /^(MPU_SAMPLE|DISPLAY_VALUES)\s+(.*)$/.exec(line);
    if (jsonMatch) {
      try {
        const value: unknown = JSON.parse(jsonMatch[2]);
        if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid object");
        const object = value as Record<string, unknown>;
        if (jsonMatch[1] === "MPU_SAMPLE") this.mpu(object, at);
        else this.display(object, at);
      } catch {
        this.bad("invalid_sensor_json", at);
      }
      return;
    }
    try {
      const hardware = hardwareLine(line, at);
      if (hardware) {
        this.hardware[hardware.kind] = hardware.report;
        // A status report proves stream activity, not a GPS fix or IMU sample.
        this.receivedAt = at;
        return;
      }
    } catch { this.bad("invalid_hardware_json", at); return; }
    const start = line.indexOf("$");
    if (start < 0) return; // Ordinary firmware logs do not establish sensor health.
    const match = /^\$([^*$]+)\*([\da-fA-F]{2})$/.exec(line.slice(start));
    if (!match) { this.bad("nmea_checksum_error", at, true); return; }
    let checksum = 0;
    for (const character of match[1]) {
      if (character.charCodeAt(0) > 127) { this.bad("nmea_checksum_error", at, true); return; }
      checksum ^= character.charCodeAt(0);
    }
    if (checksum !== parseInt(match[2], 16)) { this.bad("nmea_checksum_error", at, true); return; }
    const fields = match[1].split(",");
    if (!/^[A-Z]{2}[A-Z0-9]{3}$/.test(fields[0])) return;
    this.good(at);
    const type = fields[0].slice(2);
    if (type === "RMC" || type === "GGA") this.gps(fields, type, at);
    // GSA/GSV describe satellite constellations, not a positioned observation.
  }

  private mpu(value: Record<string, unknown>, at: number): void {
    const rawKeys = ["ax", "ay", "az", "gx", "gy", "gz", "temp"] as const;
    if (!bounded(value.ms, 0, 0xffffffff, true) || !bounded(value.seq, 0, 0xffffffff, true)
      || rawKeys.some((key) => !bounded(value[key], -32768, 32767, true))) throw new Error("invalid MPU counts");
    if (this.imu.sequence !== null && this.imu.uptimeMs !== null) {
      const sequenceDelta = (value.seq - this.imu.sequence + 0x100000000) % 0x100000000;
      const uptimeDelta = (value.ms - this.imu.uptimeMs + 0x100000000) % 0x100000000;
      if (value.seq < this.imu.sequence && value.ms < this.imu.uptimeMs && (sequenceDelta > 0x7fffffff || uptimeDelta > 0x7fffffff)) {
        this.clearSensors();
        this.issues.set("device_restarted", at);
      } else if (sequenceDelta === 0 || uptimeDelta === 0) {
        this.issues.set("imu_duplicate", at);
        return;
      } else if (sequenceDelta > 0x7fffffff || uptimeDelta > 0x7fffffff) {
        this.issues.set("imu_out_of_order", at);
        return;
      }
    }
    this.imu = {
      available: true, receivedAt: at, sequence: value.seq, uptimeMs: value.ms,
      raw: Object.fromEntries(rawKeys.map((key) => [key, value[key]])) as RawImu,
    };
    this.good(at);
  }

  private display(value: Record<string, unknown>, at: number): void {
    if (typeof value.mpu !== "boolean" || typeof value.gps_rx !== "boolean" || typeof value.gps_fix !== "boolean") throw new Error("invalid display status");
    if (!value.mpu) this.imu.available = false;
    if (!value.gps_fix) this.fixValid = false;
    if (bounded(value.sat, 0, 99, true)) this.satellites = { value: value.sat, receivedAt: at };
    if (bounded(value.hdop, 0.01, 99)) this.hdop = { value: value.hdop, receivedAt: at };
    this.good(at);
    // A displayed gps_fix:true is insufficient: it has no position or capture time.
  }

  private invalidateFix(time: number | null, at: number, reason = "gps_no_fix"): void {
    this.fixValid = false;
    this.invalidFixTime = time;
    this.speed = this.course = null;
    this.issues.set(reason, at);
  }

  private gps(fields: string[], type: "RMC" | "GGA", at: number): void {
    const time = timeOfDay(fields[1] ?? "");
    const lat = coordinate(fields[type === "RMC" ? 3 : 2] ?? "", fields[type === "RMC" ? 4 : 3] ?? "", true);
    const lon = coordinate(fields[type === "RMC" ? 5 : 4] ?? "", fields[type === "RMC" ? 6 : 5] ?? "", false);
    let recordedMs: number | null = null;
    if (type === "RMC" && time !== null) {
      recordedMs = rmcTimestamp(fields[9] ?? "", time);
    } else if (time !== null && this.rmcDateAnchor !== null) {
      const day = Math.floor(this.rmcDateAnchor / DAY_MS) * DAY_MS;
      recordedMs = [day + time - DAY_MS, day + time, day + time + DAY_MS]
        .sort((a, b) => Math.abs(a - this.rmcDateAnchor!) - Math.abs(b - this.rmcDateAnchor!))[0];
    }
    const valid = type === "RMC"
      ? fields[2] === "A" && ["", "A", "D", "F", "R", "P"].includes(fields[12] ?? "")
      : ["1", "2", "3", "4", "5"].includes(fields[6]);
    if (!valid) { this.invalidateFix(time, at); return; }
    if (time === null || lat === null || lon === null || (type === "RMC" && recordedMs === null)) {
      this.bad("gps_invalid_sentence", at);
      this.invalidateFix(time, at, "gps_invalid_sentence");
      return;
    }
    // Do not allow a replay or a bad receiver clock to replace the current
    // position/date anchor and thereby poison subsequent undated GGA frames.
    if (recordedMs !== null && (at - recordedMs > GPS_STALE_MS || recordedMs - at > 2000)) {
      this.invalidateFix(time, at, recordedMs > at ? "gps_timestamp_future" : "gps_timestamp_stale");
      return;
    }
    if (this.invalidFixTime === time) {
      this.invalidateFix(time, at, "gps_conflicting_fix");
      return;
    }
    const candidate: Position = { latitude: lat, longitude: lon, timeOfDay: time, recordedMs, receivedAt: at, source: type };
    if (this.position) {
      let interval = time - this.position.timeOfDay;
      if (interval < -DAY_MS / 2) interval += DAY_MS;
      if (interval > DAY_MS / 2) interval -= DAY_MS;
      if (recordedMs !== null && this.position.recordedMs !== null) interval = recordedMs - this.position.recordedMs;
      const distance = distanceMetres(this.position, candidate);
      if (interval < 0) { this.issues.set("gps_out_of_order", at); return; }
      if (interval === 0 && distance > 3) { this.invalidateFix(time, at, "gps_conflicting_fix"); return; }
      if (interval > 0 && interval <= 60_000 && distance > 100 && distance / (interval / 1000) > 100) {
        this.invalidateFix(time, at, "gps_jump_rejected");
        return;
      }
      // RMC/GGA often describe the same second. Replays may add metadata but
      // cannot refresh the receipt age of the already observed position.
      if (interval === 0) candidate.receivedAt = this.position.receivedAt;
    }
    this.position = candidate;
    this.fixValid = true;
    this.invalidFixTime = null;
    this.issues.delete("gps_no_fix");
    if (type === "RMC") {
      this.rmcDateAnchor = recordedMs;
      const knots = number(fields[7] ?? "");
      const heading = number(fields[8] ?? "");
      this.speed = knots !== null && knots >= 0 ? { value: knots * 0.5144444444444445, receivedAt: candidate.receivedAt } : null;
      this.course = heading !== null && heading >= 0 && heading <= 360 ? { value: heading % 360, receivedAt: candidate.receivedAt } : null;
    } else {
      const satellites = number(fields[7] ?? "");
      const hdop = number(fields[8] ?? "");
      const altitude = number(fields[9] ?? "");
      this.satellites = bounded(satellites, 0, 99, true) ? { value: satellites, receivedAt: candidate.receivedAt } : null;
      this.hdop = bounded(hdop, 0.01, 99) ? { value: hdop, receivedAt: candidate.receivedAt } : null;
      this.altitude = altitude !== null && fields[10] === "M" ? { value: altitude, receivedAt: candidate.receivedAt } : null;
    }
  }

  /** Call periodically even without incoming bytes to age an unplugged device. */
  snapshot(now = Date.now()): LiveSnapshot {
    if (!Number.isFinite(now) || now < 0) throw new RangeError("now must be host-clock milliseconds");
    const streamAge = age(this.receivedAt, now);
    const clockGood = this.receivedAt === null || now >= this.receivedAt;
    const status = streamAge === null ? "waiting" : clockGood && streamAge <= STREAM_STALE_MS ? "live" : "stale";
    const positionAge = age(this.position?.receivedAt ?? null, now);
    const captureAge = this.position?.recordedMs == null ? null : now - this.position.recordedMs;
    const recent = (value: TimedNumber) => value && now >= value.receivedAt && now - value.receivedAt <= GPS_STALE_MS ? value.value : null;
    const hdop = recent(this.hdop);
    const satellites = recent(this.satellites);
    const reasons = new Set<string>();
    for (const [reason, at] of this.issues) if (now >= at && now - at <= GPS_STALE_MS) reasons.add(reason);
    if (status === "waiting") reasons.add("waiting_for_serial");
    if (status === "stale") reasons.add("stream_stale");
    if (!clockGood) reasons.add("host_clock_reversed");
    if (!this.position || !this.fixValid) reasons.add("gps_no_fix");
    if (positionAge !== null && positionAge > GPS_STALE_MS) reasons.add("gps_stale");
    if (this.position && captureAge === null) reasons.add("gps_time_unknown");
    if (captureAge !== null && captureAge > GPS_STALE_MS) reasons.add("gps_timestamp_stale");
    if (captureAge !== null && captureAge < -2000) reasons.add("gps_timestamp_future");
    const fix = Boolean(this.position && this.fixValid && clockGood && positionAge !== null && positionAge <= GPS_STALE_MS
      && (captureAge === null || (captureAge >= -2000 && captureAge <= GPS_STALE_MS)));
    const imuAge = age(this.imu.receivedAt, now);
    const imuAvailable = this.imu.available && clockGood && imuAge !== null && imuAge <= IMU_STALE_MS;
    if (!imuAvailable) reasons.add("imu_unavailable");
    if (hdop === null) reasons.add("gps_hdop_missing");
    if (satellites === null) reasons.add("gps_satellites_missing");
    const chronologyBad = ["gps_out_of_order", "gps_conflicting_fix", "gps_jump_rejected", "imu_out_of_order", "imu_duplicate", "device_restarted"].some((reason) => reasons.has(reason));
    const freshness = positionAge === null ? null : Math.max(0, 1 - Math.max(positionAge, captureAge ?? 0) / GPS_STALE_MS);
    const integrity = this.integrity.length ? this.integrity.filter(Boolean).length / this.integrity.length : null;
    const factors: TrustFactor[] = [
      { id: "freshness", label: "Position freshness", weight: 25, value: fix ? freshness : 0, detail: captureAge === null ? "Serial receipt age; GPS date is unknown." : "Uses the older of GPS capture time and serial receipt time; zero after 10 s." },
      { id: "precision", label: "GPS precision", weight: 25, value: hdop === null ? null : Math.min(1, 1 / hdop), detail: hdop === null ? "HDOP unavailable; this factor is omitted." : `HDOP ${hdop.toFixed(2)}; factor min(1, 1 / HDOP). HDOP is not measured position error.` },
      { id: "satellites", label: "Satellites used", weight: 15, value: satellites === null ? null : Math.max(0, Math.min(1, (satellites - 3) / 9)), detail: satellites === null ? "Satellites-used count unavailable; this factor is omitted." : `${satellites} satellites used; linear quality from 3 to 12 satellites.` },
      { id: "imu", label: "IMU stream", weight: 15, value: imuAvailable ? 1 : 0, detail: "Complete raw IMU counts within 5 s. This does not establish calibration or GPS/motion agreement." },
      { id: "stream", label: "Serial integrity", weight: 10, value: integrity, detail: "Valid sensor messages among the last 100 checked messages; CRC is not authentication." },
      { id: "chronology", label: "Observation order", weight: 10, value: chronologyBad ? 0 : this.position ? 1 : null, detail: "Penalizes recent counter/order conflicts and jumps over 100 m and 100 m/s; not spoof detection." },
    ];
    const available = factors.filter((factor) => factor.value !== null);
    const totalWeight = available.reduce((sum, factor) => sum + factor.weight, 0);
    const score = fix && status === "live" && totalWeight > 0
      ? Math.round(available.reduce((sum, factor) => sum + factor.weight * factor.value!, 0) / totalWeight * 100) : null;
    return {
      version: 1, status, receivedAt: this.receivedAt,
      gps: {
        fix, latitude: this.position?.latitude ?? null, longitude: this.position?.longitude ?? null,
        speedMps: fix ? recent(this.speed) : null, courseDeg: fix ? recent(this.course) : null,
        altitudeM: fix ? recent(this.altitude) : null, satellites, hdop,
        recordedAt: this.position?.recordedMs == null ? null : new Date(this.position.recordedMs).toISOString(),
        receivedAt: this.position?.receivedAt ?? null, ageMs: positionAge, source: this.position?.source ?? null,
      },
      imu: { ...this.imu, available: imuAvailable, raw: this.imu.raw ? { ...this.imu.raw } : null },
      trust: { score, kind: "sensor_quality_heuristic", label: "Trust Score — live estimate", factors, reasons: [...reasons] },
      diagnostics: { ...this.diagnostics },
      hardware: Object.fromEntries(Object.entries(this.hardware).map(([kind, report]) => [kind, { receivedAt: report.receivedAt, values: { ...report.values } }])),
    };
  }
}
