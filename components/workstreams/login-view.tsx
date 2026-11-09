"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AlertCircle, ArrowRight, CheckCircle2, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, LogOut, Radar, ShieldCheck } from "lucide-react";
import styles from "./login-view.module.css";

type AuthConfig = { url: string; publicKey: string };
type StoredSession = { version: 1; projectUrl: string; accessToken: string; expiresAt: number };
type AuthResult = { accessToken: string; expiresAt: number; email: string | null };
type SignedIn = { expiresAt: number; email: string | null; persistence: "memory" | "tab" };
type Phase = "checking" | "idle" | "signing-in" | "signing-out";

const REQUEST_TIMEOUT_MS = 15_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPublicKey(key: string): boolean {
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return true;
  // A public env variable must never be configured with a service-role key.
  try {
    const payload = key.split(".")[1];
    if (!payload || key.split(".").length !== 3) return false;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded: unknown = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=")));
    return isRecord(decoded) && decoded.role === "anon";
  } catch {
    return false;
  }
}

function readConfig(): AuthConfig | null {
  const rawUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publicKey = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  if (!rawUrl || !publicKey || !isPublicKey(publicKey)) return null;
  try {
    const url = new URL(rawUrl);
    const localHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !localHttp) || url.username || url.password || url.search || url.hash || url.pathname !== "/") return null;
    return { url: url.origin, publicKey };
  } catch {
    return null;
  }
}

const config = readConfig();
// Scoped to this application, Supabase project, origin, and browser tab. No refresh
// token, password, or user profile is persisted; there is no localStorage fallback.
const storageKey = config ? `smarttrack.supabase.session.v1:${encodeURIComponent(config.url)}` : null;
let memorySession: StoredSession | null = null;
let ignoreStoredSession = false;

function isAccessToken(value: unknown): value is string {
  return typeof value === "string" && value.length <= 16_384 && /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

/** Clears only this app/project's session in this tab. False means storage removal failed. */
export function clearSmartTrackSession(): boolean {
  memorySession = null;
  ignoreStoredSession = true;
  if (typeof window === "undefined" || !storageKey) return true;
  try {
    window.sessionStorage.removeItem(storageKey);
    return true;
  } catch {
    return false;
  }
}

function readSession(): StoredSession | null {
  if (!config || typeof window === "undefined") return null;
  if (memorySession) {
    if (memorySession.expiresAt > Date.now()) return memorySession;
    clearSmartTrackSession();
    return null;
  }
  if (ignoreStoredSession || !storageKey) return null;
  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) return null;
    const stored: unknown = JSON.parse(raw);
    if (!isRecord(stored) || stored.version !== 1 || stored.projectUrl !== config.url || !isAccessToken(stored.accessToken) || typeof stored.expiresAt !== "number" || !Number.isSafeInteger(stored.expiresAt) || stored.expiresAt <= Date.now()) {
      clearSmartTrackSession();
      return null;
    }
    memorySession = { version: 1, projectUrl: config.url, accessToken: stored.accessToken, expiresAt: stored.expiresAt };
    return memorySession;
  } catch {
    clearSmartTrackSession();
    return null;
  }
}

/**
 * Client integration point for Authorization: Bearer headers to SmartTrack APIs.
 * Token presence is not authorization: every protected API must verify it and
 * enforce tenant/role access. Never place this value in URLs, UI, or logs.
 */
export function getSmartTrackAccessToken(): string | null {
  return readSession()?.accessToken ?? null;
}

function saveSession(result: AuthResult, persistInTab: boolean): { persistence: "memory" | "tab"; storageCleared: boolean } {
  const storageCleared = clearSmartTrackSession();
  if (!config) return { persistence: "memory", storageCleared };
  memorySession = { version: 1, projectUrl: config.url, accessToken: result.accessToken, expiresAt: result.expiresAt };
  if (persistInTab && storageKey && storageCleared) {
    try {
      window.sessionStorage.setItem(storageKey, JSON.stringify(memorySession));
      ignoreStoredSession = false;
      return { persistence: "tab", storageCleared };
    } catch {
      // Storage can be unavailable in private/restricted browsing. Retain memory only.
    }
  }
  return { persistence: "memory", storageCleared };
}

function authHeaders(accessToken?: string): HeadersInit {
  if (!config) throw new Error("Sign-in is not configured for this deployment.");
  return {
    apikey: config.publicKey,
    "Content-Type": "application/json",
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

function signInError(status: number): string {
  if (status === 400 || status === 401 || status === 422) return "Sign-in failed. Check your email and password, and confirm your email if required.";
  if (status === 403) return "This account cannot sign in. Contact your organization administrator.";
  if (status === 429) return "Too many sign-in attempts. Wait a moment before trying again.";
  return "Supabase could not complete sign-in. Try again later or contact your administrator.";
}

function readUserEmail(value: unknown): string | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id) throw new Error("Supabase returned an incomplete session. Please sign in again.");
  return typeof value.email === "string" && value.email ? value.email : null;
}

/** Exchanges credentials only with the configured Supabase Auth service. Does not persist them. */
export async function signInWithPassword(email: string, password: string, signal: AbortSignal): Promise<AuthResult> {
  if (!config) throw new Error("Sign-in is not configured for this deployment.");
  let response: Response;
  try {
    response = await fetch(`${config.url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ email: email.trim(), password }),
      signal,
      credentials: "omit",
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    throw new Error(signal.aborted ? "Sign-in timed out or was cancelled. Please try again." : "Unable to reach Supabase. Check your connection and try again.");
  }
  if (!response.ok) throw new Error(signInError(response.status));
  let result: unknown;
  try {
    result = await response.json();
  } catch {
    throw new Error("Supabase returned an unreadable session. Please try again.");
  }
  if (!isRecord(result) || !isAccessToken(result.access_token) || typeof result.token_type !== "string" || result.token_type.toLowerCase() !== "bearer") throw new Error("Supabase returned an incomplete session. Please try again.");
  const expiresAt = typeof result.expires_at === "number" ? result.expires_at * 1000 : typeof result.expires_in === "number" ? Date.now() + result.expires_in * 1000 : 0;
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) throw new Error("Supabase returned an expired session. Please sign in again.");
  return { accessToken: result.access_token, expiresAt, email: readUserEmail(result.user) };
}

export function LoginView() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [persistInTab, setPersistInTab] = useState(true);
  const [phase, setPhase] = useState<Phase>(config ? "checking" : "idle");
  const [signedIn, setSignedIn] = useState<SignedIn | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const busy = phase !== "idle";

  useEffect(() => {
    let active = true;
    const session = readSession();
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    async function restore() {
      if (!session || !config) {
        if (active) setPhase("idle");
        return;
      }
      try {
        // Saved browser data is untrusted. Confirm the bearer with Supabase before
        // displaying a signed-in state; SmartTrack APIs still authorize each call.
        const response = await fetch(`${config.url}/auth/v1/user`, {
          headers: authHeaders(session.accessToken), signal: controller.signal,
          credentials: "omit", cache: "no-store", redirect: "error",
        });
        if (!response.ok) throw new Error("Saved session not verified");
        const verifiedEmail = readUserEmail(await response.json());
        if (!active) return;
        if (session.expiresAt <= Date.now()) throw new Error("Saved session expired");
        setSignedIn({ email: verifiedEmail, expiresAt: session.expiresAt, persistence: ignoreStoredSession ? "memory" : "tab" });
      } catch {
        if (!active) return;
        const cleared = clearSmartTrackSession();
        setError(cleared ? "Your saved session could not be verified. Sign in again; check your connection if needed." : "Your saved session could not be verified or cleared from browser storage. Close this tab before signing in again.");
      } finally {
        if (active) setPhase("idle");
      }
    }

    void restore().finally(() => {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) requestRef.current = null;
    });
    return () => {
      active = false;
      window.clearTimeout(timeout);
      requestRef.current?.abort();
      requestRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    function checkExpiry() {
      if (!signedIn || signedIn.expiresAt > Date.now()) return;
      const cleared = clearSmartTrackSession();
      setSignedIn(null);
      setNotice("");
      setError(cleared ? "Your access token has expired. Sign in again to continue." : "Your access token has expired. Browser storage could not be cleared; close this tab before continuing.");
    }
    const timer = window.setInterval(checkExpiry, 1000);
    window.addEventListener("focus", checkExpiry);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", checkExpiry);
    };
  }, [signedIn]);

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!config || busy || requestRef.current) return;
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setPhase("signing-in");
    setError("");
    setNotice("");
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const result = await signInWithPassword(email, password, controller.signal);
      if (requestRef.current !== controller) return;
      const saved = saveSession(result, persistInTab);
      setSignedIn({ email: result.email, expiresAt: result.expiresAt, persistence: saved.persistence });
      if (!saved.storageCleared) setNotice("Signed in in memory, but an older browser session could not be cleared. Close this tab before changing accounts.");
      else if (persistInTab && saved.persistence === "memory") setNotice("Browser session storage is unavailable. You are signed in in memory only; reloading will require another sign-in.");
    } catch (reason) {
      if (requestRef.current === controller) setError(reason instanceof Error ? reason.message : "Sign-in failed. Please try again.");
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) {
        requestRef.current = null;
        setPassword("");
        setShowPassword(false);
        setPhase("idle");
      }
    }
  }

  async function handleSignOut() {
    if (!config || busy || requestRef.current) return;
    const token = getSmartTrackAccessToken();
    const cleared = clearSmartTrackSession();
    setSignedIn(null);
    setPhase("signing-out");
    setError("");
    setNotice("");
    const controller = new AbortController();
    requestRef.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let revoked = false;
    try {
      if (token) {
        const response = await fetch(`${config.url}/auth/v1/logout?scope=local`, {
          method: "POST", headers: authHeaders(token), signal: controller.signal,
          credentials: "omit", cache: "no-store", redirect: "error",
        });
        revoked = response.ok;
      }
    } catch {
      // Local state is cleared even when the remote sign-out cannot be confirmed.
    } finally {
      window.clearTimeout(timeout);
      if (requestRef.current === controller) {
        requestRef.current = null;
        setPhase("idle");
        if (!cleared) setError("The in-memory session was cleared, but browser storage could not be cleared. Close this tab before using another account.");
        else setNotice(revoked ? "Signed out of this session. Already-issued access tokens remain valid until their expiry." : "This tab's session was cleared. Supabase sign-out could not be confirmed; the access token remains valid until its expiry.");
      }
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.intro} aria-labelledby="login-intro-title">
        <Link className={styles.brand} href="/" aria-label="SmartTrack home">
          <span className={styles.brandMark}><Radar size={24} aria-hidden="true" /></span>
          SmartTrack
        </Link>
        <div className={styles.introCopy}>
          <span className={styles.eyebrow}>Your workspace, connected</span>
          <h1 id="login-intro-title">A clear view.<br />A trusted connection.</h1>
          <p>Sign in with your organization account to authenticate with SmartTrack&apos;s configured Supabase project.</p>
          <div className={styles.feature}>
            <ShieldCheck size={22} aria-hidden="true" />
            <div><strong>Access stays scoped</strong><span>Workspace membership and permissions are checked by the server.</span></div>
          </div>
          <div className={styles.feature}>
            <KeyRound size={22} aria-hidden="true" />
            <div><strong>Your session, this tab</strong><span>Only an expiring access token is retained. Your password and refresh token are not stored.</span></div>
          </div>
        </div>
        <p className={styles.introFooter}>Supabase Auth · Email and password</p>
      </section>

      <section className={styles.formPane} aria-labelledby="login-heading">
        <div className={styles.card}>
          <span className={styles.formIcon}><LockKeyhole size={24} aria-hidden="true" /></span>
          <p className={styles.kicker}>Account access</p>
          <h2 id="login-heading">{signedIn ? "You're signed in" : "Welcome back"}</h2>
          <p className={styles.subtitle}>{signedIn ? "Your identity was confirmed by Supabase." : "Enter your account details to continue."}</p>

          {!config && (
            <div className={styles.configuration} role="status">
              <strong>Sign-in is not configured</strong>
              <p>Set <code>NEXT_PUBLIC_SUPABASE_URL</code> and <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code> (or <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>), then rebuild this deployment.</p>
              <p>Use a public anon/publishable key and an HTTPS project URL. Local Supabase on localhost may use HTTP. Never use a service-role or secret key.</p>
            </div>
          )}

          {error && <div className={styles.error} role="alert"><AlertCircle size={18} aria-hidden="true" /><span>{error}</span></div>}
          {notice && <div className={styles.notice} role="status">{notice}</div>}
          <div className={styles.progress} role="status" aria-live="polite" aria-atomic="true">
            {busy && <><LoaderCircle className={styles.spinner} size={16} aria-hidden="true" /><span>{phase === "checking" ? "Checking this tab's saved session…" : phase === "signing-in" ? "Signing in with Supabase…" : "Ending this session…"}</span></>}
          </div>

          {signedIn ? (
            <div className={styles.session}>
              <div className={styles.success} role="status"><CheckCircle2 size={20} aria-hidden="true" /><strong>{signedIn.email || "Supabase account authenticated"}</strong></div>
              <dl className={styles.sessionDetails}>
                <div><dt>Token storage</dt><dd>{signedIn.persistence === "tab" ? "Session storage · this tab" : "Memory only · until reload"}</dd></div>
                <div><dt>Access expires</dt><dd><time dateTime={new Date(signedIn.expiresAt).toISOString()}>{new Date(signedIn.expiresAt).toLocaleString()}</time></dd></div>
              </dl>
              <p className={styles.help}>There is no automatic token refresh. Sign in again after expiry. Authentication does not grant workspace permissions or change the captured device observations.</p>
              <Link className={styles.primaryButton} href="/">Open SmartTrack <ArrowRight size={17} aria-hidden="true" /></Link>
              <button className={styles.secondaryButton} type="button" onClick={() => void handleSignOut()} disabled={busy}><LogOut size={16} aria-hidden="true" />Sign out of this session</button>
            </div>
          ) : (
            <form className={styles.form} onSubmit={handleSignIn} aria-busy={busy} aria-describedby="login-session-scope">
              <div className={styles.field}>
                <label htmlFor="login-email">Email address</label>
                <input id="login-email" name="email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={320} required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@organization.com" disabled={!config || busy} />
              </div>
              <div className={styles.field}>
                <label htmlFor="login-password">Password</label>
                <div className={styles.passwordField}>
                  <input id="login-password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} disabled={!config || busy} />
                  <button type="button" className={styles.passwordToggle} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} aria-controls="login-password" onClick={() => setShowPassword((visible) => !visible)} disabled={!config || busy}>{showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button>
                </div>
              </div>
              <label className={styles.checkboxLabel}>
                <input type="checkbox" checked={persistInTab} onChange={(event) => setPersistInTab(event.target.checked)} disabled={!config || busy} />
                Keep access token for reloads in this tab
              </label>
              <p className={styles.help} id="login-session-scope">{persistInTab ? "Uses this tab's session storage, scoped to this app and Supabase project, until token expiry or sign-out." : "Uses memory only. Reloading the page requires signing in again."} No password or refresh token is saved.</p>
              <button className={styles.primaryButton} type="submit" disabled={!config || busy}>{phase === "signing-in" ? "Signing in…" : "Sign in"}<ArrowRight size={17} aria-hidden="true" /></button>
            </form>
          )}

          <p className={styles.accountHelp}>Need an account or help with your password? Contact your organization administrator.</p>
          <Link className={styles.backLink} href="/">Back to SmartTrack</Link>
        </div>
      </section>
    </main>
  );
}
