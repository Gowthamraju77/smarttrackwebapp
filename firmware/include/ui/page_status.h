#pragma once

#include "types.h"

namespace smarttrack { namespace ui {
namespace status_detail {

inline void formatUnsigned(uint32_t value, char (&output)[11]) {
  char reversed[10];
  size_t length = 0;
  do {
    reversed[length++] = static_cast<char>('0' + value % 10);
    value /= 10;
  } while (value != 0);
  for (size_t i = 0; i < length; ++i) {
    output[i] = reversed[length - i - 1];
  }
  output[length] = '\0';
}

inline void copyDeviceId(const char* source, char (&output)[33]) {
  if (source == nullptr || source[0] == '\0') {
    source = "Unprovisioned";
  }
  size_t length = 0;
  while (length < 32 && source[length] != '\0') {
    const unsigned char glyph = static_cast<unsigned char>(source[length]);
    // Control characters and multibyte text cannot escape the fixed text row.
    output[length++] = glyph >= 32 && glyph <= 126 ? static_cast<char>(glyph) : '?';
  }
  if (length == 32 && source[length] != '\0') {
    output[29] = '.';
    output[30] = '.';
    output[31] = '.';
  }
  output[length] = '\0';
}

} // namespace status_detail

inline void renderStatus(Canvas& canvas, const State& state) {
  // Comparisons also reject NaN/infinite coordinates without a math dependency.
  const bool coordinatesValid = state.latitude >= -90.0f && state.latitude <= 90.0f
    && state.longitude >= -180.0f && state.longitude <= 180.0f;
  const bool usableFix = state.gpsFix && coordinatesValid;
  char deviceId[33];
  char count[11];
  status_detail::copyDeviceId(state.deviceId, deviceId);
  status_detail::formatUnsigned(state.queued, count);

  canvas.fill(BG);
  canvas.text(12, 10, "DEVICE STATUS", ACCENT, 2);
  canvas.text(12, 34, "ID:", MUTED);
  canvas.text(36, 34, deviceId, FG);
  canvas.line(12, 48, 307, 48, MUTED);

  canvas.text(12, 62, "GPS", MUTED);
  if (usableFix) {
    // A fix is reported, not promised fresh; show its exact age, including zero.
    char age[11];
    status_detail::formatUnsigned(state.fixAgeMs, age);
    canvas.text(108, 56, "FIX REPORTED", ACCENT, 2);
    canvas.text(108, 78, "Age ms:", MUTED);
    canvas.text(164, 78, age, FG);
  } else if (state.gpsFix) {
    canvas.text(108, 56, "INVALID FIX", DANGER, 2);
    canvas.text(108, 78, "Coordinates invalid", MUTED);
  } else {
    canvas.text(108, 56, "NO FIX", WARN, 2);
    canvas.text(108, 78, "Position unavailable", MUTED);
  }
  canvas.line(12, 96, 307, 96, MUTED);

  canvas.text(12, 110, "NETWORK", MUTED);
  canvas.text(108, 104, state.online ? "ONLINE" : "OFFLINE",
    state.online ? ACCENT : WARN, 2);
  canvas.text(108, 126, state.online ? "Link status only" : "No active connection", MUTED);
  canvas.line(12, 144, 307, 144, MUTED);

  canvas.text(12, 158, "SD CARD", MUTED);
  canvas.text(108, 152, state.sdReady ? "READY" : "NOT READY",
    state.sdReady ? ACCENT : WARN, 2);
  canvas.text(108, 174, state.sdReady ? "Storage reported ready" : "Storage unavailable", MUTED);
  canvas.line(12, 192, 307, 192, MUTED);

  canvas.text(12, 206, "QUEUED RECORDS", MUTED);
  canvas.text(156, 202, count, FG, 2);
  canvas.text(12, 224, "Delivery needs a server receipt", MUTED);
}

} } // namespace smarttrack::ui
