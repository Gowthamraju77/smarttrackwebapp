"use client";

import { useEffect, useId, useState, type FormEvent } from "react";
import {
  CheckCircle2,
  Database,
  Eye,
  Info,
  Laptop,
  LockKeyhole,
  RotateCcw,
  Save,
  SlidersHorizontal,
} from "lucide-react";
import styles from "./settings-view.module.css";

type LocalPreferences = {
  distanceUnit: "metric" | "imperial";
  timeFormat: "24h" | "12h";
  density: "comfortable" | "compact";
};

type Notice = {
  tone: "info" | "success" | "error";
  message: string;
};

const STORAGE_KEY = "smarttrack.settings.preferences.v1";
const DEFAULT_PREFERENCES: LocalPreferences = {
  distanceUnit: "metric",
  timeFormat: "24h",
  density: "comfortable",
};

function readPreferences(raw: string): LocalPreferences | null {
  try {
    const stored: unknown = JSON.parse(raw);
    if (!stored || typeof stored !== "object" || !("version" in stored) || stored.version !== 1) {
      return null;
    }

    if (!("preferences" in stored) || !stored.preferences || typeof stored.preferences !== "object") {
      return null;
    }

    const preferences = stored.preferences;
    if (
      !("distanceUnit" in preferences) ||
      (preferences.distanceUnit !== "metric" && preferences.distanceUnit !== "imperial") ||
      !("timeFormat" in preferences) ||
      (preferences.timeFormat !== "24h" && preferences.timeFormat !== "12h") ||
      !("density" in preferences) ||
      (preferences.density !== "comfortable" && preferences.density !== "compact")
    ) {
      return null;
    }

    return {
      distanceUnit: preferences.distanceUnit,
      timeFormat: preferences.timeFormat,
      density: preferences.density,
    };
  } catch {
    return null;
  }
}

function samePreferences(first: LocalPreferences, second: LocalPreferences): boolean {
  return first.distanceUnit === second.distanceUnit &&
    first.timeFormat === second.timeFormat &&
    first.density === second.density;
}

export default function SettingsView() {
  const id = useId();
  const [preferences, setPreferences] = useState<LocalPreferences>(DEFAULT_PREFERENCES);
  const [savedPreferences, setSavedPreferences] = useState<LocalPreferences>(DEFAULT_PREFERENCES);
  const [loaded, setLoaded] = useState(false);
  const [hasSavedPreferences, setHasSavedPreferences] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [notice, setNotice] = useState<Notice | null>({
    tone: "info",
    message: "Loading preferences from this browser…",
  });

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const stored = raw === null ? null : readPreferences(raw);

      if (stored) {
        setPreferences(stored);
        setSavedPreferences(stored);
        setHasSavedPreferences(true);
        setNotice({ tone: "info", message: "Saved preferences loaded from this browser." });
      } else if (raw !== null) {
        setNotice({
          tone: "error",
          message: "Saved preferences could not be read. Defaults are shown. Save or reset to replace the invalid local settings.",
        });
      } else {
        setNotice(null);
      }
    } catch {
      setStorageUnavailable(true);
      setNotice({
        tone: "error",
        message: "Browser storage is unavailable. You can preview changes, but they will not persist until a local save succeeds.",
      });
    } finally {
      setLoaded(true);
    }
  }, []);

  const isDirty = !samePreferences(preferences, savedPreferences);
  const statusMessage = notice?.message ?? (isDirty
    ? "Unsaved changes. Save to keep these choices in this browser."
    : hasSavedPreferences
      ? "These preferences are saved in this browser only."
      : "Using defaults. Save to keep these choices in this browser.");

  function updatePreference<Key extends keyof LocalPreferences>(key: Key, value: LocalPreferences[Key]) {
    setPreferences((current) => ({ ...current, [key]: value }));
    setNotice(null);
  }

  function savePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loaded) return;

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, preferences }));
      setSavedPreferences({ ...preferences });
      setHasSavedPreferences(true);
      setStorageUnavailable(false);
      setNotice({ tone: "success", message: "Preferences saved in this browser only. No workspace policy was changed." });
    } catch {
      setStorageUnavailable(true);
      setNotice({
        tone: "error",
        message: "Local save failed. Your preview is still available, but these changes were not saved. Allow site storage and try again.",
      });
    }
  }

  function resetPreferences() {
    if (!loaded) return;

    try {
      // Remove only this view's settings; never clear other application storage.
      window.localStorage.removeItem(STORAGE_KEY);
      setPreferences({ ...DEFAULT_PREFERENCES });
      setSavedPreferences({ ...DEFAULT_PREFERENCES });
      setHasSavedPreferences(false);
      setStorageUnavailable(false);
      setNotice({ tone: "success", message: "Local preferences reset to defaults. This view’s saved choices were removed from this browser." });
    } catch {
      setStorageUnavailable(true);
      setNotice({
        tone: "error",
        message: "Reset failed because browser storage is unavailable. Your current choices were kept. Allow site storage and try again.",
      });
    }
  }

  const distance = preferences.distanceUnit === "metric" ? "42.4 km" : "26.3 mi";
  const departure = preferences.timeFormat === "24h" ? "14:35 UTC" : "2:35 PM UTC";

  return (
    <div className={styles.view}>
      <header className={styles.intro}>
        <div>
          <p className={styles.eyebrow}>Workspace</p>
          <h1>Settings</h1>
          <p className={styles.subtitle}>Make this demo feel familiar, with clear control over what stays local.</p>
        </div>
        <span className={styles.localBadge}><Laptop size={15} aria-hidden="true" /> Local demo</span>
      </header>

      <div className={styles.demoNotice}>
        <Info size={20} aria-hidden="true" />
        <div>
          <strong>Your browser, your preferences</strong>
          <p>Display choices stay in this browser for this site. They are not synced to a workspace. All preview values below are synthetic.</p>
        </div>
      </div>

      <div className={styles.grid}>
        <form className={styles.panel} onSubmit={savePreferences} aria-labelledby={`${id}-preferences-heading`}>
          <div className={styles.panelHeader}>
            <span className={styles.panelIcon}><SlidersHorizontal size={20} aria-hidden="true" /></span>
            <div>
              <h2 id={`${id}-preferences-heading`}>Display preferences</h2>
              <p>Changes appear in the preview immediately.</p>
            </div>
          </div>

          <fieldset className={styles.fields} disabled={!loaded} aria-describedby={`${id}-preference-scope`}>
            <legend className={styles.visuallyHidden}>Local display options</legend>

            <div className={styles.field}>
              <div>
                <label htmlFor={`${id}-distance`}>Distance units</label>
                <p id={`${id}-distance-help`}>Choose how sample distances are displayed.</p>
              </div>
              <select
                id={`${id}-distance`}
                value={preferences.distanceUnit}
                aria-describedby={`${id}-distance-help`}
                onChange={(event) => updatePreference("distanceUnit", event.currentTarget.value === "imperial" ? "imperial" : "metric")}
              >
                <option value="metric">Kilometers (km)</option>
                <option value="imperial">Miles (mi)</option>
              </select>
            </div>

            <div className={styles.field}>
              <div>
                <label htmlFor={`${id}-clock`}>Clock format</label>
                <p id={`${id}-clock-help`}>The preview uses UTC in either format.</p>
              </div>
              <select
                id={`${id}-clock`}
                value={preferences.timeFormat}
                aria-describedby={`${id}-clock-help`}
                onChange={(event) => updatePreference("timeFormat", event.currentTarget.value === "12h" ? "12h" : "24h")}
              >
                <option value="24h">24-hour</option>
                <option value="12h">12-hour</option>
              </select>
            </div>

            <div className={styles.field}>
              <div>
                <label htmlFor={`${id}-density`}>Preview density</label>
                <p id={`${id}-density-help`}>Set the spacing between sample details.</p>
              </div>
              <select
                id={`${id}-density`}
                value={preferences.density}
                aria-describedby={`${id}-density-help`}
                onChange={(event) => updatePreference("density", event.currentTarget.value === "compact" ? "compact" : "comfortable")}
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </select>
            </div>
          </fieldset>

          <section className={`${styles.preview} ${preferences.density === "compact" ? styles.compact : ""}`} aria-labelledby={`${id}-preview-heading`}>
            <div className={styles.previewHeader}>
              <h3 id={`${id}-preview-heading`}><Eye size={16} aria-hidden="true" /> Display preview</h3>
              <span className={styles.demoBadge}>Synthetic</span>
            </div>
            <dl className={styles.previewDetails}>
              <div><dt>Sample journey</dt><dd>DEMO-001</dd></div>
              <div><dt>Distance</dt><dd>{distance}</dd></div>
              <div><dt>Departure</dt><dd>{departure}</dd></div>
            </dl>
          </section>

          <p className={styles.scope} id={`${id}-preference-scope`}>These preferences format this demo preview. Other screens are not connected to these choices yet.</p>

          <div className={styles.formFooter}>
            <div className={styles.saveState}>
              <span className={isDirty ? styles.dirtyDot : styles.stateDot} aria-hidden="true" />
              {!loaded ? "Loading local preferences" : isDirty ? "Unsaved changes" : hasSavedPreferences ? "Local preferences loaded" : "Default preferences"}
            </div>
            <div className={styles.actions}>
              <button className={styles.resetButton} type="button" onClick={resetPreferences} disabled={!loaded} aria-describedby={`${id}-reset-help`}>
                <RotateCcw size={15} aria-hidden="true" /> Reset local preferences
              </button>
              <button className={styles.saveButton} type="submit" disabled={!loaded || (!isDirty && hasSavedPreferences && !storageUnavailable)}>
                <Save size={15} aria-hidden="true" /> Save locally
              </button>
            </div>
            <p className={`${styles.feedback} ${notice?.tone === "error" ? styles.feedbackError : notice?.tone === "success" ? styles.feedbackSuccess : ""}`} role="status" aria-live="polite" aria-atomic="true">
              {notice?.tone === "success" ? <CheckCircle2 size={16} aria-hidden="true" /> : <Info size={16} aria-hidden="true" />}
              <span>{statusMessage}</span>
            </p>
            {storageUnavailable ? <p className={styles.storageWarning}>Local storage is unavailable. A successful save is required before these choices can survive a reload.</p> : null}
            <p className={styles.resetHelp} id={`${id}-reset-help`}>Reset immediately restores defaults and removes only this view’s saved preferences.</p>
          </div>
        </form>

        <section className={styles.panel} aria-labelledby={`${id}-privacy-heading`}>
          <div className={styles.panelHeader}>
            <span className={styles.lockIcon}><LockKeyhole size={20} aria-hidden="true" /></span>
            <div>
              <h2 id={`${id}-privacy-heading`}>Privacy &amp; retention</h2>
              <p>Workspace policies · Read-only</p>
            </div>
          </div>

          <div className={styles.pendingNotice}>
            <span className={styles.pendingBadge}>Pending server integration</span>
            <p>Authenticated workspace policies have not been loaded. No active privacy or retention configuration can be verified here.</p>
          </div>

          <dl className={styles.policyList}>
            <div>
              <dt>Location history retention</dt>
              <dd><strong>Unknown</strong><span>No verified retention period is available for telemetry.</span></dd>
            </div>
            <div>
              <dt>SOS &amp; audit history retention</dt>
              <dd><strong>Unknown</strong><span>Incident and audit records need a verified server policy.</span></dd>
            </div>
            <div>
              <dt>Location visibility</dt>
              <dd><strong>Access policy unknown</strong><span>Workspace permissions have not been verified in this view.</span></dd>
            </div>
            <div>
              <dt>Data export &amp; deletion</dt>
              <dd><strong>Unavailable in this view</strong><span>Authenticated server actions are required to manage stored records.</span></dd>
            </div>
          </dl>

          <div className={styles.policyNote}>
            <Database size={17} aria-hidden="true" />
            <p>Local save and reset affect display choices only. They do not change workspace policies, collect locations, or delete server data.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
