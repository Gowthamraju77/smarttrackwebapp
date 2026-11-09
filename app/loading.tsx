import Link from "next/link";
import { ArrowUpRight, Radar, ScanLine } from "lucide-react";
import { SignalScanner } from "@/components/live/signal-ui";
import styles from "@/components/shell.module.css";

export default function Loading() {
  return (
    <main className={styles.loadingPage} id="main-content" tabIndex={-1}>
      <h1 className={styles.loadingBrand}><span className="brand-mark" aria-hidden="true"><Radar size={22} strokeWidth={1.9} /></span>SmartTrack</h1>
      <div className={styles.loadingStack}><section className={styles.loadingSurface} aria-label="Opening workspace">
        <div className={styles.loadingTopline}><span><ScanLine size={13} aria-hidden="true" /> WORKSPACE</span><span>GETTING READY</span></div>
        <div role="status" aria-live="polite" aria-atomic="true">
          <SignalScanner title="Opening your workspace" description="Preparing the next view." />
        </div>
        <div className={styles.loadingFooter}><p>A clearer view is on its way.</p><Link href="/">Return to overview <ArrowUpRight size={12} aria-hidden="true" /></Link></div>
      </section></div>
    </main>
  );
}
