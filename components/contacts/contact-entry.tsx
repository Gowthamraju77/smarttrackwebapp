"use client";

import { useState, type FormEvent } from "react";
import { ArrowRight, AtSign, Phone, Radar, UserRound } from "lucide-react";
import { useContact } from "./contact-provider";
import styles from "./contacts.module.css";

export function ContactEntry() {
  const { contact, saveProfile, cancelEdit } = useContact();
  const [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    try { saveProfile({ name: String(data.get("name") ?? ""), email: String(data.get("email") ?? ""), phone: String(data.get("phone") ?? "") }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Check your contact details."); }
  }
  return <main className={styles.entry} id="main-content">
    <div className={styles.entryCard}>
      <section className={styles.story} aria-label="Welcome to SmartTrack">
        <div className={styles.brand}><span><Radar size={25} /></span>SmartTrack</div>
        <p className={styles.eyebrow}>EVERY CONNECTION HAS A PERSON</p>
        <h1>A clearer view.<br />A closer connection.</h1>
        <p>Give your device connection a name. Keep your journey and the people behind it in view.</p>
        <div className={styles.orbit} aria-hidden="true"><div /><div /><span className={styles.orbitCore}><Radar size={54} strokeWidth={1} /></span><i /><i /><i /></div>
        <div className={styles.storyFooter}><span />Your details. Your update schedule.</div>
      </section>
      <section className={styles.entryForm} aria-labelledby="contact-title">
        <span className={styles.step}>LET’S GET YOU CONNECTED</span>
        <h2 id="contact-title">{contact ? "Your connection details" : "Hello, who’s joining?"}</h2>
        <p>Your name shows who is using the device. Your email and number receive updates when you enable them. No password or verification needed.</p>
        <form onSubmit={submit}>
          <label htmlFor="contact-name">Your name</label>
          <div className={styles.input}><UserRound size={18} aria-hidden="true" /><input id="contact-name" name="name" autoComplete="name" placeholder="How should we call you?" required maxLength={80} defaultValue={contact?.profile.name} autoFocus /></div>
          <label htmlFor="contact-phone">Phone number</label>
          <div className={styles.input}><Phone size={18} aria-hidden="true" /><input id="contact-phone" name="phone" type="tel" autoComplete="tel" placeholder="+91 98765 43210" required maxLength={30} defaultValue={contact?.profile.phone} aria-describedby="phone-hint" /></div>
          <small id="phone-hint">Include your country code, such as +91.</small>
          <label htmlFor="contact-email">Email address</label>
          <div className={styles.input}><AtSign size={18} aria-hidden="true" /><input id="contact-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} defaultValue={contact?.profile.email} /></div>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <button className={styles.primary} type="submit">{contact ? "Save details" : "Enter workspace"}<ArrowRight size={18} aria-hidden="true" /></button>
          {contact && <button className={styles.textButton} type="button" onClick={cancelEdit}>Cancel changes</button>}
        </form>
        <p className={styles.footnote}>Remembered in this browser. You can edit your details and choose email + SMS timing in Settings.</p>
      </section>
    </div>
  </main>;
}
