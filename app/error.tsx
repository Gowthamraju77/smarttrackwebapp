"use client";

import { CircleAlert, Home, Radar, RotateCcw } from "lucide-react";
import { useEffect, useRef } from "react";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function ErrorPage({ reset }: ErrorPageProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <main className="boundary" aria-labelledby="page-error-title">
      <div className="brand boundary-brand">
        <span className="brand-mark" aria-hidden="true"><Radar size={21} /></span>
        <span>SmartTrack</span>
      </div>

      <section className="panel boundary-card" aria-labelledby="page-error-title">
        <div className="boundary-icon" aria-hidden="true"><CircleAlert size={28} /></div>
        <p className="eyebrow">A pause in your journey</p>
        <h1 id="page-error-title" ref={headingRef} tabIndex={-1}>This page couldn’t load</h1>
        <p className="boundary-copy">
          Something went wrong while opening this page. Try again, or return to the SmartTrack home page.
        </p>

        <div className="boundary-actions">
          <button type="button" className="primary-button" onClick={reset}>
            <RotateCcw size={17} aria-hidden="true" />
            Try again
          </button>
          <a className="secondary-button" href="/">
            <Home size={17} aria-hidden="true" />
            Go to home
          </a>
        </div>
        <p className="boundary-note">If the problem continues, try again in a moment.</p>
      </section>

      <style jsx>{`
        .boundary {
          display: grid;
          align-content: center;
          gap: 28px;
          min-height: 100vh;
          min-height: 100svh;
          padding: 40px 20px;
          color: var(--ink, #142033);
          background: var(--canvas, #f5f7fa);
        }
        .boundary-brand, .boundary-card { width: 100%; max-width: 580px; margin: 0 auto; }
        .boundary-brand { padding-left: 4px; }
        .boundary-card { padding: clamp(24px, 5vw, 44px); overflow: visible; }
        .boundary-icon {
          display: grid;
          width: 56px;
          height: 56px;
          margin-bottom: 28px;
          place-items: center;
          color: #945321;
          background: var(--orange-wash, #fff4e8);
          border-radius: var(--radius-lg, 16px);
        }
        .eyebrow { color: var(--ink-soft, #637084); }
        h1 { margin: 0; font-size: clamp(26px, 5vw, 34px); line-height: 1.2; letter-spacing: -.04em; }
        h1:focus { outline: 2px solid var(--line-strong, #dce4eb); outline-offset: 6px; border-radius: 4px; }
        .boundary-copy { margin: 16px 0 0; color: var(--ink-soft, #637084); font-size: 15px; line-height: 1.7; }
        .boundary-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
        .primary-button, .secondary-button { min-height: 44px; font-size: 14px; }
        .primary-button { color: #fff; background: var(--ink, #142033); border-color: var(--ink, #142033); box-shadow: none; }
        .primary-button:hover { background: #273950; transform: none; }
        .secondary-button { color: #285a56; }
        button:focus-visible, a:focus-visible { outline: 3px solid var(--blue, #5b89e6); outline-offset: 4px; }
        .boundary-note { margin: 28px 0 0; padding-top: 20px; border-top: 1px solid var(--line, #e8edf2); color: var(--ink-soft, #637084); font-size: 13px; line-height: 1.6; }
        @media (prefers-reduced-motion: reduce) {
          .primary-button, .secondary-button { transition: none; }
        }
      `}</style>
    </main>
  );
}
