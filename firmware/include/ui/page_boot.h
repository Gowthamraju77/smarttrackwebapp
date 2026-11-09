#ifndef SMARTTRACK_UI_PAGE_BOOT_H
#define SMARTTRACK_UI_PAGE_BOOT_H

#include "types.h"

namespace smarttrack { namespace ui {

inline void renderBoot(Canvas& canvas, const State& state) {
  canvas.fill(BG);
  canvas.text(16, 14, "SmartTrack", FG, 2);
  canvas.text(16, 38, "STARTUP / REPORTED CAPABILITIES", MUTED);
  canvas.line(16, 54, 303, 54, MUTED);

  // A reported fix does not establish its freshness or sensor self-test status.
  canvas.text(16, 66, "GPS fix", FG);
  canvas.text(168, 66, state.gpsFix ? "Fix reported" : "No fix",
              state.gpsFix ? ACCENT : WARN);
  canvas.text(16, 82, "Network", FG);
  canvas.text(168, 82, state.online ? "Online" : "Offline",
              state.online ? ACCENT : WARN);
  canvas.text(16, 98, "SD storage", FG);
  canvas.text(168, 98, state.sdReady ? "Ready" : "Not ready",
              state.sdReady ? ACCENT : WARN);
  canvas.text(16, 114, "Motion sensor", FG);
  canvas.text(168, 114, state.imuReady ? "Ready" : "Not ready",
              state.imuReady ? ACCENT : WARN);
  canvas.text(16, 130, "Trust model", FG);
  canvas.text(168, 130, state.trustAvailable ? "Available" : "Unavailable",
              state.trustAvailable ? ACCENT : MUTED);
  canvas.text(16, 146, "Map data", FG);
  canvas.text(168, 146, state.mapAvailable ? "Available" : "Unavailable",
              state.mapAvailable ? ACCENT : MUTED);
  canvas.text(16, 162, "Navigation", FG);
  canvas.text(168, 162, state.navigationAvailable ? "Available" : "Unavailable",
              state.navigationAvailable ? ACCENT : MUTED);

  canvas.line(16, 182, 303, 182, MUTED);
  const bool hasFault = state.fault != nullptr && state.fault[0] != '\0';
  canvas.text(16, 194,
              hasFault ? "Fault reported - see Diagnostics" : "No fault reported",
              hasFault ? DANGER : MUTED);

  // Neither network availability nor a local SOS implies a delivery receipt.
  if (state.sosActive) {
    canvas.text(16, 216,
                state.sosAcknowledged ? "SOS acknowledged" : "SOS active - no acknowledgement",
                state.sosAcknowledged ? ACCENT : DANGER);
  } else {
    canvas.text(16, 216, "SOS inactive", MUTED);
  }
}

} }  // namespace smarttrack::ui

#endif  // SMARTTRACK_UI_PAGE_BOOT_H
