#pragma once

#include <cmath>
#include <cstdio>
#include "types.h"

namespace smarttrack { namespace ui {

inline void renderGps(Canvas& canvas, const State& state) {
  // This page deliberately hides coordinates once a fix is over five seconds old.
  constexpr uint32_t maxFixAgeMs = 5000;
  const bool validCoordinates = std::isfinite(state.latitude) &&
      std::isfinite(state.longitude) && state.latitude >= -90.0f &&
      state.latitude <= 90.0f && state.longitude >= -180.0f &&
      state.longitude <= 180.0f;
  const bool fresh = state.fixAgeMs <= maxFixAgeMs;
  const bool showPosition = state.gpsFix && validCoordinates && fresh;
  const bool showSpeed = showPosition && std::isfinite(state.speedMps) &&
      state.speedMps >= 0.0f;
  const bool showHdop = showPosition && std::isfinite(state.hdop) &&
      state.hdop > 0.0f;

  const char* status = "FRESH GPS FIX";
  const char* detail = "Decimal degrees | max fix age 5 s";
  uint16_t statusColor = ACCENT;
  if (!state.gpsFix) {
    status = "NO GPS FIX";
    detail = "Waiting for satellite position.";
    statusColor = WARN;
  } else if (!validCoordinates) {
    status = "INVALID GPS FIX";
    detail = "Coordinates rejected: invalid data.";
    statusColor = DANGER;
  } else if (!fresh) {
    status = "STALE GPS FIX";
    detail = "Position hidden until a fresh fix.";
    statusColor = WARN;
  }

  char latitude[16] = "--";
  char longitude[16] = "--";
  char speed[16] = "--";
  char hdop[16] = "--";
  char age[16] = "--";
  // All callers supply fixed buffers of at least three bytes. Reject truncated
  // values so an oversized reading cannot become a plausible partial number.
  const auto formatNumber = [](char* buffer, size_t capacity,
                               const char* format, double value) {
    const int length = std::snprintf(buffer, capacity, format, value);
    if (length < 0 || static_cast<size_t>(length) >= capacity) {
      buffer[0] = '-';
      buffer[1] = '-';
      buffer[2] = '\0';
    }
  };
  if (showPosition) {
    formatNumber(latitude, sizeof(latitude), "%+.6f", state.latitude);
    formatNumber(longitude, sizeof(longitude), "%+.6f", state.longitude);
  }
  if (showSpeed) {
    formatNumber(speed, sizeof(speed), "%.1f", state.speedMps);
  }
  if (showHdop) {
    formatNumber(hdop, sizeof(hdop), "%.1f", state.hdop);
  }
  if (state.gpsFix) {
    // Preserve milliseconds so the 5000/5001 freshness boundary stays visible.
    std::snprintf(age, sizeof(age), "%lu",
                  static_cast<unsigned long>(state.fixAgeMs));
  }

  canvas.fill(BG);
  canvas.text(12, 12, "GPS POSITION", FG, 2);
  canvas.text(242, 16, "MAX AGE 5s", MUTED);
  canvas.line(12, 34, 308, 34, MUTED);
  canvas.rect(12, 43, 296, 32, statusColor);
  canvas.text(22, 51, status, statusColor, 2);

  canvas.text(12, 85, "LATITUDE", MUTED);
  canvas.text(12, 98, latitude, showPosition ? FG : MUTED, 2);
  canvas.text(12, 124, "LONGITUDE", MUTED);
  canvas.text(12, 137, longitude, showPosition ? FG : MUTED, 2);
  canvas.line(12, 163, 308, 163, MUTED);

  canvas.text(12, 173, "SPEED (m/s)", MUTED);
  canvas.text(122, 173, "HDOP", MUTED);
  canvas.text(230, 173, "FIX AGE(ms)", MUTED);
  canvas.text(12, 189, speed, showSpeed ? FG : MUTED);
  canvas.text(122, 189, hdop, showHdop ? FG : MUTED);
  canvas.text(230, 189, age, state.gpsFix ? FG : MUTED);
  canvas.line(12, 213, 308, 213, MUTED);
  canvas.text(12, 224, detail, MUTED);
}

} }
