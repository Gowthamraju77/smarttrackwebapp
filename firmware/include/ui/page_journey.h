#pragma once

#include <float.h>
#include "types.h"

namespace smarttrack { namespace ui {
namespace journey_detail {

// Callers reserve ten digits plus a terminator for each uint32_t value.
inline char* appendUnsigned(char* output, uint32_t value, uint8_t minimumDigits = 1) {
  char reversed[10];
  size_t length = 0;
  do {
    reversed[length++] = static_cast<char>('0' + value % 10u);
    value /= 10u;
  } while (value != 0u);
  while (length < minimumDigits) reversed[length++] = '0';
  while (length != 0) *output++ = reversed[--length];
  *output = '\0';
  return output;
}

} // namespace journey_detail

inline void renderJourney(Canvas& canvas, const State& state) {
  char distance[24] = {};
  const char* distanceText = "Unavailable";
  uint16_t distanceColor = WARN;
  // Journey totals can remain useful without a current GPS fix. The shared
  // state has no separate journey-validity bit; do not infer one from gpsFix.
  if (state.distanceMeters >= 0.0f && state.distanceMeters <= FLT_MAX) {
    const bool kilometres = state.distanceMeters >= 1000.0f;
    const double roundedTenths = (kilometres
      ? static_cast<double>(state.distanceMeters) / 100.0
      : static_cast<double>(state.distanceMeters) * 10.0) + 0.5;
    // Check before conversion, including huge finite inputs. A truncated or
    // overflowing number must never look like a plausible journey distance.
    if (roundedTenths < 4294967296.0) {
      const uint32_t tenths = static_cast<uint32_t>(roundedTenths);
      char* next = journey_detail::appendUnsigned(distance, tenths / 10u);
      *next++ = '.';
      *next++ = static_cast<char>('0' + tenths % 10u);
      *next++ = ' ';
      if (kilometres) *next++ = 'k';
      *next++ = 'm';
      *next = '\0';
      distanceText = distance;
      distanceColor = FG;
    } else {
      distanceText = "Out of range";
    }
  }

  // Hours deliberately do not wrap at 24. UINT32_MAX seconds needs at most
  // seven hour digits, so the full h:mm:ss value fits without truncation.
  char duration[16];
  char* next = journey_detail::appendUnsigned(duration, state.journeySeconds / 3600u, 2);
  *next++ = ':';
  next = journey_detail::appendUnsigned(next, state.journeySeconds / 60u % 60u, 2);
  *next++ = ':';
  journey_detail::appendUnsigned(next, state.journeySeconds % 60u, 2);

  // Three size-one rows of 48 standard 6x8 glyphs stay inside the display.
  // Reads are bounded to 145 bytes, including the truncation lookahead.
  constexpr size_t columns = 48;
  constexpr size_t rows = 3;
  char instruction[rows][columns + 1] = {};
  bool hasInstruction = false;
  if (state.navigationAvailable && state.instruction != nullptr) {
    size_t copied = 0;
    for (; copied < rows * columns; ++copied) {
      const unsigned char value = static_cast<unsigned char>(state.instruction[copied]);
      if (value == 0) break;
      // Flatten control characters and unsupported bytes so supplied text
      // cannot move the canvas cursor beyond the navigation panel.
      const char glyph = value < 32 ? ' ' : value <= 126 ? static_cast<char>(value) : '?';
      instruction[copied / columns][copied % columns] = glyph;
      if (glyph != ' ') hasInstruction = true;
    }
    if (copied == rows * columns && state.instruction[copied] != '\0') {
      instruction[rows - 1][columns - 3] = '.';
      instruction[rows - 1][columns - 2] = '.';
      instruction[rows - 1][columns - 1] = '.';
    }
  }

  canvas.fill(BG);
  canvas.text(12, 12, "JOURNEY", FG, 2);
  canvas.text(12, 34, "Reported journey totals", MUTED);
  canvas.line(12, 48, 308, 48, MUTED);

  canvas.text(12, 60, "DISTANCE", MUTED);
  canvas.text(12, 75, distanceText, distanceColor, 2);
  canvas.text(12, 105, "DURATION (h:mm:ss)", MUTED);
  canvas.text(12, 120, duration, FG, 2);
  canvas.line(12, 146, 308, 146, MUTED);

  canvas.text(12, 157, "NAVIGATION", MUTED);
  if (hasInstruction) {
    for (size_t row = 0; row < rows; ++row) {
      if (instruction[row][0] != '\0') {
        canvas.text(12, 174 + static_cast<int>(row) * 16, instruction[row], FG);
      }
    }
  } else {
    canvas.text(12, 174, "Navigation unavailable", WARN);
    canvas.text(12, 190, state.navigationAvailable ? "No instruction supplied"
                                                 : "No turn guidance available", MUTED);
  }
  canvas.text(12, 226, "Totals are supplied by the tracker", MUTED);
}

} } // namespace smarttrack::ui
