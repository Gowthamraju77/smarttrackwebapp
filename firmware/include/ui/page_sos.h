#pragma once
#include "types.h"

namespace smarttrack { namespace ui {

inline void renderSos(Canvas& canvas, const State& state) {
  canvas.fill(BG);
  canvas.text(12, 10, "EMERGENCY / SOS", FG, 2);
  canvas.text(12, 32, "Local emergency state", MUTED);

  const uint16_t statusColor = state.sosActive ? DANGER : MUTED;
  canvas.rect(12, 50, 296, 76, statusColor);
  if (state.sosActive) {
    canvas.text(24, 62, "SOS LATCHED", FG, 2);
    canvas.text(24, 86, "Emergency remains active", FG);
    // An acknowledgement never clears or resolves the local SOS latch.
    canvas.text(24, 106,
                state.sosAcknowledged ? "ACKNOWLEDGED - NOT RESOLVED"
                                      : "No acknowledgement reported",
                state.sosAcknowledged ? WARN : FG);
  } else {
    canvas.text(24, 62, "SOS INACTIVE", FG, 2);
    canvas.text(24, 86, "No emergency latched", MUTED);
    canvas.text(24, 106, "Use the SOS button to raise an alert", FG);
  }

  canvas.text(12, 138, state.online ? "Network: online" : "Network: offline",
              state.online ? ACCENT : WARN);
  // Neither connectivity nor a queue count is a server acceptance receipt.
  canvas.text(12, 152, "Link status is not delivery confirmation", MUTED);
  canvas.text(12, 170,
              state.gpsFix ? "GPS: fix reported; freshness not verified"
                           : "GPS: no fix available",
              state.gpsFix ? MUTED : WARN);

  canvas.line(12, 190, 307, 190, MUTED);
  canvas.text(12, 202, "Local SOS needs no network or GPS", FG);
  canvas.text(12, 218, "Acknowledgement is not resolution", WARN);
}

} }
