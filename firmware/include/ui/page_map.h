#pragma once
#include <stdio.h>
#include "types.h"

namespace smarttrack { namespace ui {

inline void renderMap(Canvas& canvas, const State& state) {
  // gpsFix is the only supplied validity bit; coordinates alone cannot prove
  // that a retained position exists. Bounds also reject NaN and infinity.
  const bool validPosition = state.gpsFix &&
      state.latitude >= -90.0f && state.latitude <= 90.0f &&
      state.longitude >= -180.0f && state.longitude <= 180.0f;

  canvas.fill(BG);
  canvas.text(12, 10, "MAP", FG, 2);
  canvas.text(12, 33, "Road map unavailable", WARN);

  // State supplies neither geometry nor a provider. Its availability flag
  // must not be turned into invented roads, tiles, or a route line.
  canvas.rect(10, 51, 300, 75, MUTED);
  canvas.text(20, 62, state.mapAvailable ? "Map data: reported available"
                                           : "Map data: unavailable",
              state.mapAvailable ? FG : WARN);
  canvas.text(20, 80, "Provider: not supplied", WARN);
  canvas.text(20, 98, "Licensed data + renderer required", MUTED);

  canvas.rect(10, 138, 300, 82, MUTED);
  canvas.text(20, 148, "LAST-KNOWN POSITION", FG);
  if (validPosition) {
    char text[48];
    snprintf(text, sizeof(text), "Lat %+.5f  Lon %+.5f",
             static_cast<double>(state.latitude),
             static_cast<double>(state.longitude));
    canvas.text(20, 164, text, FG);
    snprintf(text, sizeof(text), "Fix age: %lu.%03lu s",
             static_cast<unsigned long>(state.fixAgeMs / 1000u),
             static_cast<unsigned long>(state.fixAgeMs % 1000u));
    canvas.text(20, 180, text, MUTED);
    canvas.text(20, 196, "GPS fix reported; check age", ACCENT);
  } else {
    canvas.text(20, 164, "Position unavailable", WARN);
    canvas.text(20, 180, state.gpsFix ? "Invalid GPS coordinates"
                                       : "No GPS fix", MUTED);
    canvas.text(20, 196, "No verified retained position", MUTED);
  }
  canvas.text(12, 229, "Roads are not loaded on this page", MUTED);
}

} }
