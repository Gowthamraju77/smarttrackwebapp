import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LiveTelemetryProvider } from "@/components/live/live-telemetry-provider";
import { SignalFilterProvider } from "@/components/live/signal-filter";
import { JourneyProvider } from "@/components/live/journey-provider";
import { SectionTransitions } from "@/components/section-transitions";
import { ContactProvider } from "@/components/contacts/contact-provider";
import { FlowBackground } from "@/components/flow-background";
import "./globals.css";
import "maplibre-gl/dist/maplibre-gl.css";

export const metadata: Metadata = {
  title: "SmartTrack | Field intelligence",
  description: "A calm, clear view of every journey and safety signal.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <FlowBackground />
        <LiveTelemetryProvider publicFeed={process.env.SMARTTRACK_PUBLIC_LIVE === "1"}>
          <SignalFilterProvider>
          <JourneyProvider>
          <ContactProvider>
          <a className="skip-link" href="#main-content">Skip to main content</a>
          <SectionTransitions>{children}</SectionTransitions>
          </ContactProvider>
          </JourneyProvider>
          </SignalFilterProvider>
        </LiveTelemetryProvider>
      </body>
    </html>
  );
}
