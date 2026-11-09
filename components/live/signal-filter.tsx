"use client";

import { createContext, useContext, useLayoutEffect, useMemo, useState, type ReactNode } from "react";
import { advanceStability, emptyStability, validStabilityPoint, type StabilityPoint } from "@/lib/live/stabilization";
import { advanceMapFilter, emptyMapFilter, mapMotionEvidence } from "@/lib/live/stationary-map";
import type { RawImu } from "@/lib/live/telemetry";
import { useLiveTelemetry, type LivePoint } from "./live-telemetry-provider";

type SignalStability = {
  gpsPoint: LivePoint | null; points: readonly LivePoint[]; gpsHeld: boolean;
  motionValues: RawImu | null; motionReceivedAt: number | null;
};
const Context = createContext<SignalStability | null>(null);

export function SignalFilterProvider({ children }: { children: ReactNode }) {
  const { snapshot, capturedSnapshot, points, source, captureEpoch, status } = useLiveTelemetry();
  const [state, setState] = useState(() => ({ map: emptyMapFilter(), motion: emptyStability() }));
  const sourceKey = `${source}:${captureEpoch}`;
  const connected = status === "connected" && snapshot?.status === "live";
  const currentFix = connected && !!snapshot?.gps.fix;
  const positioned = currentFix ? snapshot : capturedSnapshot?.gps.latitude != null ? capturedSnapshot : snapshot;
  const motion = snapshot?.imu.raw ? snapshot.imu : capturedSnapshot?.imu ?? snapshot?.imu ?? null;
  const gps = positioned?.gps;
  const rawPoint = useMemo<StabilityPoint | null>(() => {
    if (gps?.latitude == null || gps.longitude === null || gps.receivedAt === null) return null;
    const candidate = { latitude: gps.latitude, longitude: gps.longitude, receivedAt: gps.receivedAt, recordedAt: gps.recordedAt };
    return validStabilityPoint(candidate) ? candidate : null;
  }, [gps?.latitude, gps?.longitude, gps?.receivedAt, gps?.recordedAt]);

  // Process before paint so a raw GPS update cannot flash through a held marker.
  // The telemetry provider also republishes aged snapshots when readings stop.
  useLayoutEffect(() => {
    const now = Date.now();
    const restarted = snapshot?.trust.reasons.includes("device_restarted") ?? false;
    setState(previous => ({
      map: advanceMapFilter(previous.map, { sourceKey, points, gps: rawPoint,
        motion: mapMotionEvidence(snapshot, now), restarted, now, connected, currentFix }),
      motion: advanceStability(previous.motion, { sourceKey, points: [], gps: null, motion,
        restarted, receivedAt: snapshot?.receivedAt ?? null }),
    }));
  }, [sourceKey, points, rawPoint, motion, snapshot, connected, currentFix]);
  const sameSource = state.map.sourceKey === sourceKey;
  const motionAligned = state.motion.sourceKey === sourceKey && state.motion.motionReceivedAt === motion?.receivedAt;
  const value: SignalStability = {
    gpsPoint: !rawPoint ? null : sameSource ? state.map.gpsPoint ?? rawPoint : rawPoint,
    points: sameSource ? state.map.points : points,
    gpsHeld: sameSource && state.map.held,
    motionValues: !motion?.raw ? null : motionAligned ? state.motion.motionValues ?? motion.raw : motion.raw,
    motionReceivedAt: motion?.receivedAt ?? null,
  };
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useSignalStability() {
  const context = useContext(Context);
  if (!context) throw new Error("SignalFilterProvider must wrap the workspace.");
  return context;
}
