"use client";

import { Compass, Home, Radar } from "lucide-react";

export default function NotFound() {
  return (
    <main className="not-found" aria-labelledby="not-found-title">
      <div className="brand not-found-brand">
        <span className="brand-mark" aria-hidden="true"><Radar size={21} /></span>
        <span>SmartTrack</span>
      </div>

      <section className="panel not-found-card" aria-labelledby="not-found-title">
        <div className="not-found-icon" aria-hidden="true"><Compass size={30} /></div>
        <p className="eyebrow">404 · A different direction</p>
        <h1 id="not-found-title">Page not found</h1>
        <p className="not-found-copy">
          The page you’re looking for isn’t available. Check the address, or return home to choose a section.
        </p>
        <a className="primary-button" href="/">
          <Home size={17} aria-hidden="true" />
          Go to home
        </a>
        <p className="not-found-note">Your next view starts at the SmartTrack dashboard.</p>
      </section>

      <style jsx>{`
        .not-found {
          display: grid;
          align-content: center;
          gap: 28px;
          min-height: 100vh;
          min-height: 100svh;
          padding: 40px 20px;
          color: var(--ink, #142033);
          background: var(--canvas, #f5f7fa);
        }
        .not-found-brand, .not-found-card { width: 100%; max-width: 580px; margin: 0 auto; }
        .not-found-brand { padding-left: 4px; }
        .not-found-card { padding: clamp(24px, 5vw, 44px); overflow: visible; }
        .not-found-icon { display: grid; width: 60px; height: 60px; margin-bottom: 28px; place-items: center; color: #365bb0; background: var(--blue-wash, #edf3ff); border-radius: var(--radius-lg, 16px); }
        .eyebrow { color: var(--ink-soft, #637084); }
        h1 { margin: 0; font-size: clamp(28px, 5vw, 36px); line-height: 1.2; letter-spacing: -.04em; }
        .not-found-copy { margin: 16px 0 28px; color: var(--ink-soft, #637084); font-size: 15px; line-height: 1.7; }
        .primary-button { min-height: 44px; color: #fff; background: var(--ink, #142033); border-color: var(--ink, #142033); box-shadow: none; font-size: 14px; }
        .primary-button:hover { background: #273950; transform: none; }
        a:focus-visible { outline: 3px solid var(--blue, #5b89e6); outline-offset: 4px; }
        .not-found-note { margin: 28px 0 0; padding-top: 20px; border-top: 1px solid var(--line, #e8edf2); color: var(--ink-soft, #637084); font-size: 13px; line-height: 1.6; }
        @media (prefers-reduced-motion: reduce) {
          .primary-button { transition: none; }
        }
      `}</style>
    </main>
  );
}
