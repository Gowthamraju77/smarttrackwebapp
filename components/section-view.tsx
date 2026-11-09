import { Activity } from "lucide-react";
import type { ViewKey } from "@/components/app-shell";
import MapView from "@/components/workstreams/map-view";
import InsightsView from "@/components/workstreams/insights-view";
import { RealDeviceSection } from "@/components/live/real-device-section";
import { JourneyPage, NavigationPage } from "@/components/live/tracking-pages";

type SectionViewKey = Exclude<ViewKey, "dashboard">;

/** Every routed workspace uses actual captured device evidence or an explicit empty state. */
export function SectionView({ activeView }: { activeView: SectionViewKey }) {
  switch (activeView) {
    case "map": return <MapView />;
    case "insights": return <InsightsView />;
    case "journeys": return <JourneyPage />;
    case "navigation": return <NavigationPage />;
    case "analytics":
    case "alerts":
    case "devices":
    case "settings":
    case "display":
    case "team":
    case "security":
    case "activity":
    case "help": return <RealDeviceSection section={activeView} />;
    default:
      return (
        <section className="panel section-empty-card" aria-live="polite">
          <div className="empty-icon"><Activity size={20} aria-hidden="true" /></div>
          <h1>Workspace section unavailable</h1>
          <p>This route is not configured. Return to the dashboard or contact your workspace administrator.</p>
        </section>
      );
  }
}
