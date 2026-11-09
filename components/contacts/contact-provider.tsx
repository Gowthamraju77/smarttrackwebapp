"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { CONTACT_STORAGE, NOTIFICATION_MODE_STORAGE, defaultPreferences, parseContactSession, parseProfile, type ContactProfile, type ContactSession, type ConnectedContact, type NotificationMode, type NotificationPreferences, type NotificationStatus } from "@/lib/notifications";
import { useLiveTelemetry } from "@/components/live/live-telemetry-provider";
import { useJourney } from "@/components/live/journey-provider";
import { ContactEntry } from "./contact-entry";

function useContactState() {
  const [contact, setContact] = useState<ContactSession | null>(null);
  const [ready, setReady] = useState(false);
  const [editing, setEditing] = useState(false);
  const [status, setStatus] = useState<NotificationStatus | null>(null);
  const [contacts, setContacts] = useState<ConnectedContact[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("Saved in this browser. Connect through your private device link to sync updates.");
  const [storageWarning, setStorageWarning] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const live = useLiveTelemetry();
  const journey = useJourney();
  const [mode, setMode] = useState<NotificationMode>("general");
  const previousPhase = useRef<string | null>(null);
  const connected = live.status === "connected";
  const revision = useRef(0);

  useEffect(() => {
    try { const raw = localStorage.getItem(CONTACT_STORAGE); if (raw && raw.length < 4096) setContact(parseContactSession(JSON.parse(raw)));
      setMode(localStorage.getItem(NOTIFICATION_MODE_STORAGE) === "journey" ? "journey" : "general"); } catch { /* Invalid or unavailable storage shows the entry form. */ }
    setReady(true);
    const onStorage = (event: StorageEvent) => {
      if (event.key === NOTIFICATION_MODE_STORAGE) setMode(event.newValue === "journey" ? "journey" : "general");
      if (event.key === CONTACT_STORAGE && event.newValue && event.newValue.length < 4096) {
        try { const next = parseContactSession(JSON.parse(event.newValue)); revision.current++; setContact(next); setStatus(null); } catch { /* Ignore malformed cross-tab writes. */ }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!journey.hydrated) return;
    const previous = previousPhase.current;
    previousPhase.current = journey.phase;
    const next = journey.phase === "armed" || journey.phase === "active" ? "journey"
      : previous !== null && previous !== journey.phase ? "general" : null;
    if (!next) return;
    setMode(next);
    try { localStorage.setItem(NOTIFICATION_MODE_STORAGE, next); } catch { /* Memory-only mode still works. */ }
  }, [journey.hydrated, journey.phase]);

  const remember = useCallback((next: ContactSession) => {
    revision.current++;
    setContact(next); setStatus(null);
    setMessage("Saved in this browser. Syncing notification settings…");
    try { localStorage.setItem(CONTACT_STORAGE, JSON.stringify(next)); setStorageWarning(false); }
    catch { setStorageWarning(true); }
  }, []);

  useEffect(() => {
    if (!ready || !contact) return;
    setStatus(null); setSyncing(true);
    let stopped = false, busy = false;
    let controller: AbortController | null = null;
    const currentRevision = revision.current;
    async function sync() {
      if (busy || stopped) return;
      let viewer: string | null = null;
      try { viewer = sessionStorage.getItem("smarttrack.feed.viewer.v1"); } catch { /* Public and USB-only visitors can still use a local profile. */ }
      if (!viewer) { setSyncing(false); setStatus(null); setContacts([]); setMessage("Saved in this browser. A private device link is needed to share your connection and schedule email + SMS updates."); return; }
      busy = true; controller = new AbortController();
      const timeout = setTimeout(() => controller?.abort(), 15_000);
      setSyncing(true);
      try {
        const response = await fetch("/api/notifications/contact", { method: "POST", cache: "no-store", signal: controller.signal,
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${viewer}` },
          body: JSON.stringify({ ...contact, mode, connected, source: live.source, clientRevision: Date.now() }) });
        const data = await response.json();
        if (stopped || currentRevision !== revision.current) return;
        if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Notification sync is unavailable.");
        setStatus(data.status); setContacts(data.contacts);
        setMessage(data.status.available ? "Synced. Email + SMS updates follow the active schedule." : "Contact synced. Email + SMS delivery still needs service setup.");
      } catch (error) {
        if (!stopped && currentRevision === revision.current) { setStatus(null); setContacts([]); setMessage(`Saved in this browser. ${error instanceof Error && error.name !== "AbortError" ? error.message : "Could not sync. Your last synced schedule may still be active."}`); }
      } finally { clearTimeout(timeout); busy = false; if (!stopped) setSyncing(false); }
    }
    // Serialize heartbeats; changing a preference or journey mode syncs promptly.
    const initial = setTimeout(() => void sync(), 350);
    const heartbeat = setInterval(() => void sync(), 60_000);
    const onVisible = () => { if (document.visibilityState === "visible") void sync(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("hashchange", onVisible);
    return () => { stopped = true; clearTimeout(initial); clearInterval(heartbeat); controller?.abort(); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("hashchange", onVisible); };
  }, [ready, contact, mode, connected, live.source, attempt]);

  return { contact, ready, editing, status, contacts, syncing, message, storageWarning, mode,
    canResumeGeneral: mode === "journey" && journey.phase !== "armed" && journey.phase !== "active",
    resumeGeneral: () => { setMode("general"); try { localStorage.setItem(NOTIFICATION_MODE_STORAGE, "general"); } catch { /* Memory-only preference. */ } },
    edit: () => setEditing(true), cancelEdit: () => setEditing(false), retry: () => setAttempt(value => value + 1),
    saveProfile: (profile: ContactProfile) => {
      const token = contact?.token ?? Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join("");
      remember({ id: contact?.id ?? crypto.randomUUID(), token, profile: parseProfile(profile), preferences: contact?.preferences ?? defaultPreferences() });
      setEditing(false);
    },
    savePreferences: (preferences: NotificationPreferences) => { if (contact) remember({ ...contact, preferences }); },
  };
}

const Context = createContext<ReturnType<typeof useContactState> | null>(null);
export function ContactProvider({ children }: { children: ReactNode }) {
  const value = useContactState();
  return <Context.Provider value={value}>
    {!value.ready ? <div className="contact-loading" role="status">Opening SmartTrack…</div> : !value.contact || value.editing ? <ContactEntry /> : children}
  </Context.Provider>;
}
export function useContact() { const value = useContext(Context); if (!value) throw new Error("ContactProvider is required"); return value; }
