export const NOTIFICATION_INTERVALS = [20, 30, 60, 180, 300, 600, 1440] as const;
export type NotificationInterval = typeof NOTIFICATION_INTERVALS[number];
export type NotificationMode = "general" | "journey";
export type ContactProfile = { name: string; phone: string; email: string };
export type NotificationPreferences = Record<NotificationMode, { enabled: boolean; minutes: NotificationInterval }>;
export type ContactSession = { id: string; token: string; profile: ContactProfile; preferences: NotificationPreferences };
export const CONTACT_STORAGE = "smarttrack.contact.browser.v1";
export const NOTIFICATION_MODE_STORAGE = "smarttrack.notifications.mode.v1";
export const defaultPreferences = (): NotificationPreferences => ({ general: { enabled: false, minutes: 60 }, journey: { enabled: false, minutes: 30 } });
export const intervalLabel = (minutes: number) => minutes < 60 ? `${minutes} min` : `${minutes / 60} hr`;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

/** Contact details identify a visitor; they are never an authentication factor. */
export function parseProfile(value: unknown): ContactProfile {
  if (!object(value) || typeof value.name !== "string" || typeof value.email !== "string" || typeof value.phone !== "string") throw new Error("Enter your name, email and phone number.");
  const name = value.name.trim().replace(/\s+/g, " ");
  const email = value.email.trim();
  const phone = value.phone.trim().replace(/[\s().-]/g, "");
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f]/.test(value.name)) throw new Error("Use a name between 1 and 80 characters.");
  if (email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new Error("Enter a valid email address.");
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw new Error("Include your country code, for example +91, followed by your phone number.");
  return { name, email, phone };
}

export function parsePreferences(value: unknown): NotificationPreferences {
  if (!object(value)) throw new Error("Choose notification intervals.");
  for (const mode of ["general", "journey"] as const) {
    const setting = value[mode];
    if (!object(setting) || typeof setting.enabled !== "boolean" || !NOTIFICATION_INTERVALS.includes(setting.minutes as NotificationInterval)) throw new Error("Choose one of the available notification intervals.");
  }
  return { general: { ...(value.general as NotificationPreferences["general"]) }, journey: { ...(value.journey as NotificationPreferences["journey"]) } };
}

export function parseContactSession(value: unknown): ContactSession {
  if (!object(value) || typeof value.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.id)
    || typeof value.token !== "string" || !/^[a-f0-9]{64}$/.test(value.token)) throw new Error("Invalid contact session.");
  return { id: value.id, token: value.token, profile: parseProfile(value.profile), preferences: parsePreferences(value.preferences) };
}

export type NotificationStatus = {
  available: boolean; email: boolean; sms: boolean;
  nextDue: string | null; mode: NotificationMode;
  deliveries: { channel: "email" | "sms"; status: "accepted" | "failed" | "uncertain" | "pending" | "processing" | "cancelled"; created_at: string }[];
};
export type ConnectedContact = { id: string; name: string; source: string; connected: boolean; last_seen_at: string };
