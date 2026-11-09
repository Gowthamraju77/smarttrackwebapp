#pragma once
#include "types.h"
#include <float.h>

namespace smarttrack { namespace ui {

namespace motion_detail {

// Fixed-point for ordinary readings, scientific notation for very small/large
// ones. At most nine ASCII glyphs plus NUL; no heap or printf float machinery.
inline bool formatMetric(float reading, char (&output)[16]) {
  output[0] = '\0';
  // This rejects both infinities and NaN without casting them to an integer.
  if (!(reading >= -FLT_MAX && reading <= FLT_MAX)) return false;

  double magnitude = static_cast<double>(reading);
  size_t length = 0;
  if (magnitude < 0) {
    output[length++] = '-';
    magnitude = -magnitude;
  }

  const bool scientific = magnitude != 0 &&
      (magnitude < 0.01 || magnitude >= 9999.995);
  int exponent = 0;
  if (scientific) {
    // The ESP32 float range, including subnormals, needs at most 45 shifts.
    for (uint8_t i = 0; i < 45 && magnitude >= 10; ++i) {
      magnitude /= 10;
      ++exponent;
    }
    for (uint8_t i = 0; i < 45 && magnitude < 1; ++i) {
      magnitude *= 10;
      --exponent;
    }
  }

  uint32_t hundredths = static_cast<uint32_t>(magnitude * 100 + 0.5);
  if (scientific && hundredths >= 1000) {
    hundredths = 100;
    ++exponent;
  }
  uint32_t whole = hundredths / 100;
  uint32_t divisor = 1;
  for (uint8_t i = 0; i < 3 && whole / divisor >= 10; ++i) divisor *= 10;
  do {
    output[length++] = static_cast<char>('0' + whole / divisor);
    whole %= divisor;
    divisor /= 10;
  } while (divisor != 0);
  output[length++] = '.';
  output[length++] = static_cast<char>('0' + hundredths / 10 % 10);
  output[length++] = static_cast<char>('0' + hundredths % 10);

  if (scientific) {
    output[length++] = 'e';
    output[length++] = exponent < 0 ? '-' : '+';
    const unsigned int power = static_cast<unsigned int>(exponent < 0 ? -exponent : exponent);
    output[length++] = static_cast<char>('0' + power / 10);
    output[length++] = static_cast<char>('0' + power % 10);
  }
  output[length] = '\0';
  return true;
}

}  // namespace motion_detail

inline void renderMotion(Canvas& canvas, const State& state) {
  char acceleration[16] = {};
  char angularSpeed[16] = {};
  const bool accelerationValid = state.imuReady &&
      motion_detail::formatMetric(state.acceleration, acceleration);
  const bool gyroValid = state.imuReady &&
      motion_detail::formatMetric(state.gyroDps, angularSpeed);

  canvas.fill(BG);
  canvas.text(12, 12, "MOTION / IMU", FG, 2);
  canvas.text(12, 36,
              !state.imuReady ? "IMU unavailable" :
              (accelerationValid && gyroValid ? "IMU ready / reported readings"
                                              : "IMU ready / invalid reading"),
              accelerationValid && gyroValid ? ACCENT : WARN);
  canvas.line(12, 54, 307, 54, MUTED);

  canvas.rect(12, 66, 296, 58, accelerationValid ? ACCENT : MUTED);
  canvas.text(24, 76, "ACCELERATION", MUTED);
  canvas.text(24, 96, accelerationValid ? acceleration : "Unavailable",
              accelerationValid ? FG : WARN, 2);
  canvas.text(240, 100, "m/s^2", MUTED);

  canvas.rect(12, 136, 296, 58, gyroValid ? ACCENT : MUTED);
  canvas.text(24, 146, "ANGULAR SPEED", MUTED);
  canvas.text(24, 166, gyroValid ? angularSpeed : "Unavailable",
              gyroValid ? FG : WARN, 2);
  canvas.text(240, 170, "deg/s", MUTED);

  // State has no IMU timestamp, so these values cannot establish freshness.
  canvas.text(12, 214, "Sample age is not provided", MUTED);
}

} }  // namespace smarttrack::ui
