"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, getDevices, isAbortError, type Device } from "./api";

export type UseDevicesOptions = {
  /** Production requests are opt-in. Only the boolean true enables loading. */
  enabled?: boolean;
  signal?: AbortSignal;
};

export type DevicesState =
  | { status: "idle" | "loading"; devices: null; error: null }
  | { status: "success"; devices: Device[]; error: null }
  | { status: "error"; devices: null; error: ApiError };

export type UseDevicesResult = DevicesState & {
  loading: boolean;
  /** Refetch is also gated by enabled; it cannot turn on production mode. */
  refetch: () => void;
};

const idleState: DevicesState = { status: "idle", devices: null, error: null };

/**
 * Use useDevices({ enabled: true }) after an explicit production-mode choice.
 * No request runs by default. Empty success is [], while unavailable data is
 * null. Disable, abort, or unmount cancels the request and ignores late results.
 */
export function useDevices({ enabled = false, signal }: UseDevicesOptions = {}): UseDevicesResult {
  const [state, setState] = useState<DevicesState>(idleState);
  const [revision, setRevision] = useState(0);

  const refetch = useCallback(() => {
    if (enabled === true && !signal?.aborted) {
      setRevision((current) => current + 1);
    }
  }, [enabled, signal]);

  useEffect(() => {
    if (enabled !== true || signal?.aborted) {
      setState(idleState);
      return;
    }

    const controller = new AbortController();
    let active = true;
    const abort = () => {
      controller.abort(signal?.reason);
      if (active) setState(idleState);
    };

    signal?.addEventListener("abort", abort, { once: true });
    setState({ status: "loading", devices: null, error: null });

    void getDevices({ signal: controller.signal }).then(
      (devices) => {
        if (active && !controller.signal.aborted) {
          setState({ status: "success", devices, error: null });
        }
      },
      (error: unknown) => {
        if (!active) return;
        if (controller.signal.aborted || isAbortError(error)) {
          setState(idleState);
          return;
        }
        setState({
          status: "error",
          devices: null,
          error: error instanceof ApiError
            ? error
            : new ApiError("NETWORK_ERROR", "Unable to load devices. Try again."),
        });
      },
    );

    return () => {
      active = false;
      signal?.removeEventListener("abort", abort);
      controller.abort();
    };
  }, [enabled, signal, revision]);

  const visibleState = enabled === true && !signal?.aborted ? state : idleState;
  return { ...visibleState, loading: visibleState.status === "loading", refetch };
}
