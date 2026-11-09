"use client";

import { CircleAlert, Home, Radar, RotateCcw } from "lucide-react";
import { useEffect, useRef } from "react";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ reset }: GlobalErrorProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <html lang="en">
      <head>
        <title>Unable to open SmartTrack</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body style={{ margin: 0, color: "var(--ink, #142033)", background: "var(--canvas, #f5f7fa)", fontFamily: '"Inter", "Avenir Next", "Segoe UI", Arial, sans-serif' }}>
        <main className="global-boundary" aria-labelledby="global-error-title">
          <div className="global-brand">
            <span className="global-brand-mark" aria-hidden="true"><Radar size={21} /></span>
            <span>SmartTrack</span>
          </div>

          <section className="global-card" aria-labelledby="global-error-title">
            <div className="global-icon" aria-hidden="true"><CircleAlert size={28} /></div>
            <p className="global-eyebrow">Let’s try that again</p>
            <h1 id="global-error-title" ref={headingRef} tabIndex={-1}>Unable to open SmartTrack</h1>
            <p className="global-copy">
              Something went wrong while starting the app. Try again, or return to the home page for a fresh start.
            </p>

            <div className="global-actions">
              <button className="global-primary" type="button" onClick={reset}>
                <RotateCcw size={17} aria-hidden="true" />
                Try again
              </button>
              <a className="global-secondary" href="/">
                <Home size={17} aria-hidden="true" />
                Go to home
              </a>
            </div>
            <p className="global-note">If the problem continues, try again in a moment.</p>
          </section>
        </main>

        <style jsx>{`
          .global-boundary, .global-boundary * { box-sizing: border-box; }
          .global-boundary {
            display: grid;
            align-content: center;
            gap: 28px;
            min-height: 100vh;
            min-height: 100svh;
            padding: 40px 20px;
            font-size: 14px;
            -webkit-font-smoothing: antialiased;
          }
          .global-brand, .global-card { width: 100%; max-width: 580px; margin: 0 auto; }
          .global-brand { display: flex; align-items: center; gap: 10px; padding-left: 4px; font-size: 17px; font-weight: 680; letter-spacing: -.03em; }
          .global-brand-mark { display: grid; width: 31px; height: 31px; place-items: center; color: #102a35; background: #73dfd2; border-radius: 10px; box-shadow: 0 0 0 4px rgba(115, 223, 210, .1); }
          .global-card { padding: clamp(24px, 5vw, 44px); border: 1px solid var(--line, #e8edf2); border-radius: var(--radius-lg, 16px); background: var(--panel, #fff); box-shadow: var(--shadow, 0 8px 24px rgba(25, 42, 65, .04)); }
          .global-icon { display: grid; width: 56px; height: 56px; margin-bottom: 28px; place-items: center; color: #945321; background: var(--orange-wash, #fff4e8); border-radius: var(--radius-lg, 16px); }
          .global-eyebrow { margin: 0 0 7px; color: var(--ink-soft, #637084); font-size: 10px; font-weight: 720; letter-spacing: .1em; text-transform: uppercase; }
          h1 { margin: 0; font-size: clamp(26px, 5vw, 34px); line-height: 1.2; letter-spacing: -.04em; }
          h1:focus { outline: 2px solid var(--line-strong, #dce4eb); outline-offset: 6px; border-radius: 4px; }
          .global-copy { margin: 16px 0 0; color: var(--ink-soft, #637084); font-size: 15px; line-height: 1.7; }
          .global-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }
          .global-primary, .global-secondary { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 10px 15px; border: 1px solid; border-radius: 8px; font: inherit; font-weight: 650; line-height: 1.4; text-decoration: none; cursor: pointer; }
          .global-primary { color: #fff; background: var(--ink, #142033); border-color: var(--ink, #142033); }
          .global-primary:hover { background: #273950; }
          .global-secondary { color: #285a56; background: #effbf9; border-color: #c7e3df; }
          .global-secondary:hover { background: #e4f6f2; }
          button:focus-visible, a:focus-visible { outline: 3px solid var(--blue, #5b89e6); outline-offset: 4px; }
          .global-note { margin: 28px 0 0; padding-top: 20px; border-top: 1px solid var(--line, #e8edf2); color: var(--ink-soft, #637084); font-size: 13px; line-height: 1.6; }
          @media (max-width: 600px) {
            .global-primary, .global-secondary { width: 100%; }
          }
        `}</style>
      </body>
    </html>
  );
}
