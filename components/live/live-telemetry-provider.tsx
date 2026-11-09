"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { TelemetryDecoder, type LiveSnapshot } from "@/lib/live/telemetry";
import { ageLiveSnapshot, isLiveFeed, isLiveSnapshot } from "@/lib/live/feed";

type SerialPort = {
  readable: ReadableStream<Uint8Array> | null;
  open(options: { baudRate: number; bufferSize?: number }): Promise<void>;
  close(): Promise<void>;
  setSignals?(signals: { dataTerminalReady: boolean; requestToSend: boolean }): Promise<void>;
};
type BrowserSerial = { requestPort(options: { filters: { usbVendorId: number; usbProductId: number }[] }): Promise<SerialPort> };
type ConnectionStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";
type Source = "relay" | "usb" | "none";
type FeedStatus = "connecting" | "live" | "stale" | "unavailable" | "locked";
export type LivePoint = { longitude: number; latitude: number; receivedAt: number; recordedAt?: string | null };
type LiveTelemetryContext = {
  mode: "live";
  setMode: (mode: "demo" | "live") => void;
  supported: boolean | null;
  status: ConnectionStatus;
  snapshot: LiveSnapshot | null;
  capturedSnapshot: LiveSnapshot | null;
  points: readonly LivePoint[];
  source: Source;
  /** Local identity for display state; never a credential or device identifier. */
  captureEpoch: number;
  feedStatus: FeedStatus;
  feedError: string | null;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
};
type SerialRun = { port: SerialPort; reader: ReadableStreamDefaultReader<Uint8Array>; cancelled: boolean };
const Context = createContext<LiveTelemetryContext | null>(null);
const VIEWER_KEY = "smarttrack.feed.viewer.v1";
const CAPTURE_KEY = "smarttrack.feed.capture.v1";
const VALID_VIEWER = /^[A-Za-z0-9_-]{32,256}$/;
const noModeChange = () => {};

function serialError(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotFoundError") return "No device was selected. The device feed will continue loading.";
  if (name === "SecurityError" || name === "NotAllowedError") return "Serial access was not allowed. Use Chrome or Edge to connect an attached ESP32.";
  if (name === "NetworkError" || name === "InvalidStateError") return "The serial port could not be opened. Close any serial monitor using the ESP32, then reconnect.";
  return "The USB connection was interrupted. The captured-device feed will resume automatically.";
}

function validPoints(value: unknown): value is LivePoint[] {
  return Array.isArray(value) && value.length <= 240 && value.every((point) =>
    typeof point === "object" && point !== null
    && typeof point.latitude === "number" && Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90
    && typeof point.longitude === "number" && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180
    && typeof point.receivedAt === "number" && Number.isFinite(point.receivedAt) && point.receivedAt >= 0
    && (point.recordedAt === undefined || point.recordedAt === null || typeof point.recordedAt === "string"));
}

/** Automatic shared/private device feed, with an optional read-only USB override. */
export function LiveTelemetryProvider({ children, publicFeed = false }: { children: ReactNode; publicFeed?: boolean }) {
  const [supported, setSupported] = useState<boolean | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [capturedSnapshot, setCapturedSnapshot] = useState<LiveSnapshot | null>(null);
  const [points, setPoints] = useState<LivePoint[]>([]);
  const [source, setSource] = useState<Source>("none");
  const [captureEpoch, setCaptureEpoch] = useState(0);
  const [feedStatus, setFeedStatus] = useState<FeedStatus>("connecting");
  const [feedError, setFeedError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const decoderRef = useRef<TelemetryDecoder | null>(null);
  const runRef = useRef<SerialRun | null>(null);
  const connectingRef = useRef(false);
  const mountedRef = useRef(true);
  const sourceRef = useRef<Source>("none");
  const latestRef = useRef<LiveSnapshot | null>(null);
  const capturedRef = useRef<LiveSnapshot | null>(null);
  const pointsRef = useRef<LivePoint[]>([]);
  const relayConnectedRef = useRef(false);
  const relayStartedAtRef = useRef<number | null>(null);
  const viewerRef = useRef<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const generationRef = useRef(0);
  const lastFixRef = useRef<number | null>(null);
  const lastPublishRef = useRef(0);
  const lastCacheWriteRef = useRef(0);
  const lastFeedTimeRef = useRef(-1);

  const changeSource = useCallback((next: Source) => {
    if (sourceRef.current !== next) setCaptureEpoch(epoch => epoch + 1);
    sourceRef.current = next;
    setSource(next);
  }, []);

  const rememberCapture = useCallback((force = false) => {
    if (!capturedRef.current || sourceRef.current === "none") return;
    const now = Date.now();
    if (!force && now - lastCacheWriteRef.current < 1000) return;
    lastCacheWriteRef.current = now;
    try {
      window.sessionStorage.setItem(CAPTURE_KEY, JSON.stringify({
        version: 1, source: sourceRef.current,
        capturedSnapshot: capturedRef.current, points: pointsRef.current,
      }));
    } catch { /* Storage is optional; received observations remain in memory. */ }
  }, []);

  const present = useCallback((latest: LiveSnapshot, connected: boolean) => {
    if (!mountedRef.current) return;
    const next = ageLiveSnapshot(latest, Date.now(), connected);
    const captured = capturedRef.current;
    if (next.gps.latitude === null && captured?.gps.latitude !== null && captured?.gps.latitude !== undefined) {
      next.gps = {
        ...captured.gps, fix: false,
        ageMs: captured.gps.receivedAt === null ? null : Math.max(0, Date.now() - captured.gps.receivedAt),
      };
      next.trust.score = null;
    }
    setSnapshot(next);
  }, []);

  const publishUsb = useCallback((next: LiveSnapshot) => {
    if (!mountedRef.current || sourceRef.current !== "usb") return;
    latestRef.current = next;
    if (next.status === "live" && next.gps.fix && next.trust.score !== null && next.receivedAt !== capturedRef.current?.receivedAt) {
      capturedRef.current = structuredClone(next);
      setCapturedSnapshot(capturedRef.current);
    }
    const gps = next.gps;
    if (gps.fix && gps.latitude !== null && gps.longitude !== null && gps.receivedAt !== null && gps.receivedAt !== lastFixRef.current) {
      lastFixRef.current = gps.receivedAt;
      const last = pointsRef.current[pointsRef.current.length - 1];
      if (!last || last.latitude !== gps.latitude || last.longitude !== gps.longitude) {
        pointsRef.current = [...pointsRef.current, {
          latitude: gps.latitude, longitude: gps.longitude, receivedAt: gps.receivedAt, recordedAt: gps.recordedAt,
        }].slice(-240);
        setPoints(pointsRef.current);
      }
    }
    const connected = !!runRef.current && !runRef.current.cancelled;
    present(next, connected);
    setFeedStatus(connected && next.status === "live" ? "live" : "stale");
    rememberCapture();
  }, [present, rememberCapture]);

  const disconnect = useCallback(async () => {
    const run = runRef.current;
    if (!run) return;
    run.cancelled = true;
    setStatus("disconnected");
    setFeedStatus("stale");
    if (latestRef.current) present(latestRef.current, false);
    rememberCapture(true);
    try { await run.reader.cancel(); } catch { /* The device may have been unplugged. */ }
  }, [present, rememberCapture]);

  const connect = useCallback(async () => {
    if (connectingRef.current || runRef.current) return;
    const serial = (navigator as Navigator & { serial?: BrowserSerial }).serial;
    if (!serial || !window.isSecureContext) {
      setError("Direct USB reading requires Chrome or Edge on HTTPS or localhost.");
      return;
    }
    connectingRef.current = true;
    generationRef.current += 1;
    requestRef.current?.abort();
    setStatus("connecting");
    setError(null);
    let port: SerialPort | null = null;
    let opened = false;
    try {
      port = await serial.requestPort({ filters: [{ usbVendorId: 0x303a, usbProductId: 0x1001 }] });
      if (!mountedRef.current) return;
      await port.open({ baudRate: 115200, bufferSize: 16_384 });
      opened = true;
      try { await port.setSignals?.({ dataTerminalReady: false, requestToSend: false }); } catch { /* Some USB CDC implementations do not expose control signals. */ }
      if (!port.readable) throw new Error("No serial read stream");
      if (!mountedRef.current) { await port.close(); return; }
      const run: SerialRun = { port, reader: port.readable.getReader(), cancelled: false };
      setCaptureEpoch(epoch => epoch + 1);
      runRef.current = run;
      const decoder = new TelemetryDecoder();
      decoderRef.current = decoder;
      changeSource("usb");
      lastFixRef.current = null;
      lastPublishRef.current = 0;
      lastFeedTimeRef.current = -1;
      pointsRef.current = [];
      capturedRef.current = null;
      setCapturedSnapshot(null);
      setPoints([]);
      latestRef.current = decoder.snapshot();
      present(latestRef.current, true);
      setStatus("connected");
      setFeedStatus("connecting");
      setFeedError(null);

      void (async () => {
        let readError: unknown = null;
        try {
          while (!run.cancelled) {
            const { value, done } = await run.reader.read();
            if (done) break;
            if (value && !run.cancelled) {
              const now = Date.now();
              const next = decoder.push(value, now);
              if (now - lastPublishRef.current >= 250) {
                lastPublishRef.current = now;
                publishUsb(next);
              }
            }
          }
        } catch (reason) {
          if (!run.cancelled) readError = reason;
        } finally {
          if (mountedRef.current && runRef.current === run) {
            publishUsb(decoder.snapshot(Date.now()));
            setStatus(readError ? "error" : "disconnected");
            setFeedStatus("stale");
            if (readError) setError(serialError(readError));
            if (latestRef.current) present(latestRef.current, false);
            rememberCapture(true);
          }
          run.reader.releaseLock();
          try { await run.port.close(); } catch { /* Unplugged ports can already be closed. */ }
          if (runRef.current === run) {
            runRef.current = null;
            decoderRef.current = null;
            generationRef.current += 1;
          }
        }
      })();
    } catch (reason) {
      if (opened && port) { try { await port.close(); } catch { /* Best-effort cleanup. */ } }
      if (mountedRef.current) {
        setError(serialError(reason));
        setStatus("error");
        if (latestRef.current) present(latestRef.current, false);
      }
    } finally {
      connectingRef.current = false;
    }
  }, [changeSource, present, publishUsb, rememberCapture]);

  useEffect(() => {
    mountedRef.current = true;
    let disposed = false;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let polling = false;
    setSupported("serial" in navigator && window.isSecureContext);

    function readViewer() {
      let previous: string | null = null;
      try { previous = window.sessionStorage.getItem(VIEWER_KEY); } catch { /* Memory-only access remains possible. */ }
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const supplied = fragment.get("feed");
      let next = supplied && VALID_VIEWER.test(supplied) ? supplied : previous && VALID_VIEWER.test(previous) ? previous : viewerRef.current;
      if (fragment.has("feed")) {
        window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
        if (supplied && VALID_VIEWER.test(supplied)) {
          try {
            if (previous !== supplied) window.sessionStorage.removeItem(CAPTURE_KEY);
            window.sessionStorage.setItem(VIEWER_KEY, supplied);
          } catch { /* The scoped viewer key remains in memory only. */ }
        }
      }
      if (next && !VALID_VIEWER.test(next)) next = null;
      const changed = viewerRef.current !== null && viewerRef.current !== next;
      viewerRef.current = next;
      if (changed && !runRef.current && !connectingRef.current) {
        generationRef.current += 1;
        requestRef.current?.abort();
        latestRef.current = null;
        capturedRef.current = null;
        pointsRef.current = [];
        lastFeedTimeRef.current = -1;
        setSnapshot(null);
        setCapturedSnapshot(null);
        setPoints([]);
        changeSource("none");
      }
      if (!runRef.current) setFeedStatus(next || publicFeed ? "connecting" : "locked");
    }

    readViewer();
    try {
      const raw = window.sessionStorage.getItem(CAPTURE_KEY);
      if (raw && raw.length <= 512_000) {
        const cache: unknown = JSON.parse(raw);
        if (typeof cache === "object" && cache !== null && "version" in cache && cache.version === 1
          && "source" in cache && (cache.source === "usb" || cache.source === "relay")
          && (cache.source === "usb" || publicFeed || viewerRef.current !== null)
          && "capturedSnapshot" in cache && isLiveSnapshot(cache.capturedSnapshot)
          && "points" in cache && validPoints(cache.points)) {
          capturedRef.current = cache.capturedSnapshot;
          pointsRef.current = cache.points;
          latestRef.current = cache.capturedSnapshot;
          setCapturedSnapshot(cache.capturedSnapshot);
          setPoints(cache.points);
          changeSource(cache.source);
          setStatus("disconnected");
          present(cache.capturedSnapshot, false);
        }
      }
    } catch { /* An unavailable or invalid cache is never replaced with fabricated data. */ }

    async function poll() {
      if (disposed || polling) return;
      polling = true;
      let controller: AbortController | null = null;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const generation = generationRef.current;
      try {
        if (runRef.current || connectingRef.current) return;
        const viewer = viewerRef.current;
        if (!viewer && !publicFeed) {
          setFeedStatus("locked");
          // No connection is a normal empty state, not a repeated page error.
          setFeedError(null);
          if (latestRef.current) present(latestRef.current, false);
          return;
        }
        controller = new AbortController();
        requestRef.current = controller;
        timeout = setTimeout(() => controller?.abort(), 12_000);
        const response = await fetch("/api/live", {
          headers: { Accept: "application/json", ...(!publicFeed && viewer ? { Authorization: `Bearer ${viewer}` } : {}) },
          credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal,
        });
        if (disposed || generationRef.current !== generation || runRef.current || connectingRef.current) return;
        if (!response.ok) {
          relayConnectedRef.current = false;
          setFeedStatus(response.status === 401 || response.status === 403 ? "locked" : "unavailable");
          setFeedError(response.status === 401 || response.status === 403
            ? "The saved device connection could not be verified. Reconnect your device."
            : "The device feed is unavailable. Last-captured readings remain historical.");
          setStatus("disconnected");
          if (latestRef.current) present(latestRef.current, false);
          return;
        }
        const data: unknown = await response.json();
        if (disposed || generationRef.current !== generation || runRef.current || connectingRef.current) return;
        if (!isLiveFeed(data)) throw new Error("Invalid device feed");
        if (data.generatedAt < lastFeedTimeRef.current) return;
        lastFeedTimeRef.current = data.generatedAt;
        const previousCapture = sourceRef.current === "relay" ? capturedRef.current : null;
        changeSource("relay");
        if (relayStartedAtRef.current !== null && (relayStartedAtRef.current !== data.startedAt
          || (!relayConnectedRef.current && data.serial.connected))) setCaptureEpoch(epoch => epoch + 1);
        relayStartedAtRef.current = data.startedAt;
        relayConnectedRef.current = data.serial.connected;
        latestRef.current = data.live;
        capturedRef.current = data.capturedSnapshot ?? previousCapture;
        pointsRef.current = data.trajectory.slice(-240);
        setCapturedSnapshot(capturedRef.current);
        setPoints(pointsRef.current);
        const aged = ageLiveSnapshot(data.live, Date.now(), data.serial.connected);
        present(data.live, data.serial.connected);
        setStatus(data.serial.connected ? "connected" : "disconnected");
        setFeedStatus(aged.status === "live" && data.serial.connected ? "live" : "stale");
        setFeedError(null);
        setError(null);
        rememberCapture();
      } catch {
        if (!disposed && generationRef.current === generation && !runRef.current && !connectingRef.current) {
          relayConnectedRef.current = false;
          setFeedStatus("unavailable");
          setFeedError("The device feed could not be reached. Last-captured readings remain historical.");
          setStatus("disconnected");
          if (latestRef.current) present(latestRef.current, false);
        }
      } finally {
        if (timeout !== undefined) clearTimeout(timeout);
        if (requestRef.current === controller) requestRef.current = null;
        polling = false;
        if (!disposed) pollTimer = setTimeout(() => void poll(), 1000);
      }
    }

    const onHashChange = () => {
      readViewer();
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      void poll();
    };
    window.addEventListener("hashchange", onHashChange);
    void poll();
    const ageTimer = setInterval(() => {
      if (disposed) return;
      if (runRef.current && !runRef.current.cancelled && decoderRef.current) {
        publishUsb(decoderRef.current.snapshot(Date.now()));
      } else if (latestRef.current) {
        const connected = sourceRef.current === "relay" && relayConnectedRef.current;
        present(latestRef.current, connected);
        if (connected && ageLiveSnapshot(latestRef.current, Date.now(), true).status !== "live") setFeedStatus("stale");
      }
    }, 1000);
    return () => {
      disposed = true;
      mountedRef.current = false;
      requestRef.current?.abort();
      if (pollTimer !== undefined) clearTimeout(pollTimer);
      clearInterval(ageTimer);
      window.removeEventListener("hashchange", onHashChange);
      const run = runRef.current;
      if (run) { run.cancelled = true; void run.reader.cancel().catch(() => {}); }
    };
  }, [changeSource, present, publicFeed, publishUsb, rememberCapture]);

  return <Context.Provider value={{ mode: "live", setMode: noModeChange, supported, status, snapshot, capturedSnapshot, points, source, captureEpoch, feedStatus, feedError, error, connect, disconnect }}>{children}</Context.Provider>;
}

export function useLiveTelemetry() {
  const context = useContext(Context);
  if (!context) throw new Error("LiveTelemetryProvider must wrap the workspace.");
  return context;
}
