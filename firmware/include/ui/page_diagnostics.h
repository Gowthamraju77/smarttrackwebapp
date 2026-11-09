#pragma once
#include "types.h"

namespace smarttrack { namespace ui {

inline void renderDiagnostics(Canvas& canvas, const State& state) {
  // A uint32_t queue depth needs at most ten decimal digits and a terminator.
  char queueBuffer[11];
  char* queueText = queueBuffer + sizeof(queueBuffer) - 1;
  *queueText = '\0';
  uint32_t remaining = state.queued;
  do {
    *--queueText = static_cast<char>('0' + remaining % 10);
    remaining /= 10;
  } while (remaining != 0);

  // uint32_t milliseconds span fewer than 50 days, so each field fits two digits.
  const uint32_t seconds = state.uptimeMs / 1000;
  char uptimeText[] = "00d 00h 00m 00s";
  const auto twoDigits = [](char* output, uint32_t value) {
    output[0] = static_cast<char>('0' + value / 10);
    output[1] = static_cast<char>('0' + value % 10);
  };
  twoDigits(uptimeText, seconds / 86400);
  twoDigits(uptimeText + 4, seconds / 3600 % 24);
  twoDigits(uptimeText + 8, seconds / 60 % 60);
  twoDigits(uptimeText + 12, seconds % 60);

  canvas.fill(BG);
  canvas.text(12, 12, "DIAGNOSTICS", FG, 2);
  canvas.line(12, 34, 308, 34, MUTED);

  canvas.text(12, 46, "QUEUED RECORDS", MUTED);
  canvas.text(12, 62, queueText, state.queued != 0 ? WARN : FG, 2);
  canvas.text(168, 46, "UPTIME", MUTED);
  canvas.text(168, 66, uptimeText, FG);
  canvas.line(12, 88, 308, 88, MUTED);

  canvas.text(12, 100, "LINK", MUTED);
  canvas.text(56, 100, state.online ? "Online" : "Offline", state.online ? ACCENT : WARN);
  canvas.text(168, 100, "SD", MUTED);
  canvas.text(208, 100, state.sdReady ? "Ready" : "Not ready", state.sdReady ? ACCENT : WARN);
  canvas.text(12, 120, "GPS", MUTED);
  canvas.text(56, 120, state.gpsFix ? "Fix reported" : "No fix", state.gpsFix ? ACCENT : WARN);
  canvas.text(168, 120, "IMU", MUTED);
  canvas.text(208, 120, state.imuReady ? "Ready" : "Not ready", state.imuReady ? ACCENT : WARN);
  canvas.line(12, 140, 308, 140, MUTED);
  canvas.text(12, 151, "FAULT", MUTED);

  if (state.fault == nullptr || state.fault[0] == '\0') {
    canvas.text(12, 168, "None reported", MUTED);
    return;
  }

  // Three lines of 48 standard 6x8 size-one glyphs fit within 320x240. Inspect
  // at most 145 source bytes, including the single-byte truncation lookahead.
  constexpr size_t columns = 48;
  constexpr size_t rows = 3;
  char faultLines[rows][columns + 1] = {};
  size_t copied = 0;
  for (; copied < rows * columns; ++copied) {
    const uint8_t value = static_cast<uint8_t>(state.fault[copied]);
    if (value == 0) break;
    // Keep control characters from moving the canvas cursor outside this page.
    faultLines[copied / columns][copied % columns] =
      value == '\n' || value == '\r' || value == '\t' ? ' ' :
      (value >= 32 && value <= 126 ? static_cast<char>(value) : '?');
  }
  if (copied == rows * columns && state.fault[copied] != '\0') {
    faultLines[rows - 1][columns - 3] = '.';
    faultLines[rows - 1][columns - 2] = '.';
    faultLines[rows - 1][columns - 1] = '.';
  }
  for (size_t row = 0; row < rows; ++row) {
    if (faultLines[row][0] != '\0') {
      canvas.text(12, 168 + static_cast<int>(row) * 15, faultLines[row], DANGER);
    }
  }
}

} }
