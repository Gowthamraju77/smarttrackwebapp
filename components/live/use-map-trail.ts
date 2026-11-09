"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "smarttrack.map.trail.v1";
const CHANGE_EVENT = "smarttrack:map-trail";
let fallback = true;
let memoryOnly = false;

function readPreference() {
  if (memoryOnly) return fallback;
  try { return window.localStorage.getItem(STORAGE_KEY) !== "location"; }
  catch { return fallback; }
}

function subscribe(update: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) { memoryOnly = false; update(); }
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, update);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, update);
  };
}

function setShowTrail(show: boolean) {
  fallback = show;
  try { window.localStorage.setItem(STORAGE_KEY, show ? "trail" : "location"); memoryOnly = false; }
  catch { memoryOnly = true; }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** One display preference for every map, including other open tabs. */
export function useMapTrail() {
  const showTrail = useSyncExternalStore(subscribe, readPreference, () => true);
  return { showTrail, setShowTrail };
}
