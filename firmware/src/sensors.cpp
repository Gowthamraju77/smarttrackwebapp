#include "sensors.h"

#include "config.h"

#include <cmath>
#include <cstdlib>
#include <cstring>
#include <vector>

#ifdef ARDUINO
#include <Arduino.h>
#include <HardwareSerial.h>
#include <Wire.h>
#endif

namespace smarttrack {
namespace {
bool finite(double value) { return std::isfinite(value); }

bool parseDouble(const std::string& value, double& result) {
  if (value.empty()) return false;
  char* end = nullptr;
  result = std::strtod(value.c_str(), &end);
  return end != value.c_str() && *end == '\0' && finite(result);
}

bool checksumOk(const char* sentence) {
  if (sentence == nullptr || sentence[0] != '$') return false;
  const char* star = std::strchr(sentence, '*');
  if (star == nullptr || star <= sentence + 1 || star[1] == '\0' || star[2] == '\0') return false;
  unsigned checksum = 0;
  for (const char* p = sentence + 1; p < star; ++p) checksum ^= static_cast<unsigned char>(*p);
  char* end = nullptr;
  const unsigned supplied = std::strtoul(star + 1, &end, 16);
  return end == star + 3 && supplied <= 0xFFU && checksum == supplied;
}

std::vector<std::string> fields(const char* sentence) {
  const char* begin = sentence + 1;
  const char* end = std::strchr(begin, '*');
  std::vector<std::string> result;
  if (end == nullptr) return result;
  std::string current;
  for (const char* p = begin; p <= end; ++p) {
    if (*p == ',' || p == end) { result.push_back(current); current.clear(); }
    else current += *p;
  }
  return result;
}

bool coordinate(const std::string& raw, const std::string& hemisphere,
                bool latitude, double& value) {
  double degreesMinutes = 0.0;
  if (!parseDouble(raw, degreesMinutes) || hemisphere.size() != 1) return false;
  const double degrees = std::floor(degreesMinutes / 100.0);
  const double minutes = degreesMinutes - degrees * 100.0;
  if (minutes < 0.0 || minutes >= 60.0) return false;
  value = degrees + minutes / 60.0;
  if (hemisphere[0] == 'S' || hemisphere[0] == 'W') value = -value;
  if ((hemisphere[0] != 'N' && hemisphere[0] != 'S' && latitude) ||
      (hemisphere[0] != 'E' && hemisphere[0] != 'W' && !latitude)) return false;
  return finite(value) && (latitude ? value >= -90.0 && value <= 90.0
                                     : value >= -180.0 && value <= 180.0);
}
} // namespace

Sensors::Sensors() = default;

bool Sensors::begin() {
#ifdef ARDUINO
  Serial1.begin(9600, SERIAL_8N1, config::GPS_RX_PIN, config::GPS_TX_PIN);
  Wire.begin(config::I2C_SDA_PIN, config::I2C_SCL_PIN);
#endif
  snapshot_ = SensorSnapshot();
  lastGpsAtMs_ = 0;
  haveGpsTime_ = false;
  nmea_.clear();
  // MPU identity/calibration is board-specific and is intentionally not
  // claimed here. It remains unavailable until a qualified driver is added.
  return true;
}

void Sensors::update(uint32_t nowMs) {
#ifdef ARDUINO
  unsigned readCount = 0;
  while (Serial1.available() > 0 && readCount++ < 96U) {
    const char c = static_cast<char>(Serial1.read());
    if (c == '\n') {
      if (!nmea_.empty()) ingestNmea(nmea_.c_str(), nowMs);
      nmea_.clear();
    } else if (c != '\r' && nmea_.size() < 160U) nmea_ += c;
    else if (nmea_.size() >= 160U) nmea_.clear();
  }
#endif
  if (haveGpsTime_) {
    snapshot_.gpsAgeMs = nowMs - lastGpsAtMs_;
    if (snapshot_.gpsAgeMs > config::GPS_STALE_AFTER_MS) {
      snapshot_.gpsFix = false;
      snapshot_.gpsHasLatitude = snapshot_.gpsHasLongitude = false;
      snapshot_.gpsHasSpeed = snapshot_.gpsHasHdop = false;
    }
  }
}

bool Sensors::ingestNmea(const char* sentence, uint32_t receivedAtMs) {
  if (!checksumOk(sentence)) return false;
  const std::vector<std::string> f = fields(sentence);
  if (f.empty()) return false;
  const bool rmc = f[0].size() >= 3 && f[0].compare(f[0].size() - 3, 3, "RMC") == 0;
  const bool gga = f[0].size() >= 3 && f[0].compare(f[0].size() - 3, 3, "GGA") == 0;
  if (!rmc && !gga) return false;

  bool valid = false;
  double latitude = 0.0, longitude = 0.0;
  bool coordinates = false;
  if (rmc && f.size() >= 8U) {
    valid = f[2] == "A";
    coordinates = valid && coordinate(f[3], f[4], true, latitude) &&
                  coordinate(f[5], f[6], false, longitude);
    double knots = 0.0;
    if (valid && parseDouble(f[7], knots) && knots >= 0.0) {
      snapshot_.speedMps = knots * 0.514444444;
      snapshot_.gpsHasSpeed = finite(snapshot_.speedMps);
    } else snapshot_.gpsHasSpeed = false;
  } else if (gga && f.size() >= 9U) {
    long quality = std::strtol(f[6].c_str(), nullptr, 10);
    valid = quality > 0;
    coordinates = valid && coordinate(f[2], f[3], true, latitude) &&
                  coordinate(f[4], f[5], false, longitude);
    double parsedHdop = 0.0;
    snapshot_.gpsHasHdop = parseDouble(f[8], parsedHdop) && parsedHdop > 0.0;
    if (snapshot_.gpsHasHdop) snapshot_.hdop = parsedHdop;
  }
  if (!valid || !coordinates) {
    snapshot_.gpsFix = false;
    snapshot_.gpsHasLatitude = snapshot_.gpsHasLongitude = false;
    return true;
  }
  snapshot_.gpsFix = true;
  snapshot_.latitude = latitude;
  snapshot_.longitude = longitude;
  snapshot_.gpsHasLatitude = snapshot_.gpsHasLongitude = true;
  lastGpsAtMs_ = receivedAtMs;
  snapshot_.gpsAgeMs = 0;
  haveGpsTime_ = true;
  return true;
}

} // namespace smarttrack
