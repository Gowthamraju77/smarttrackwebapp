#pragma once

#include <stdint.h>
#include <string>

namespace smarttrack {

struct SensorSnapshot {
  bool gpsFix = false;
  bool gpsHasLatitude = false;
  bool gpsHasLongitude = false;
  bool gpsHasSpeed = false;
  bool gpsHasHdop = false;
  double latitude = 0.0;
  double longitude = 0.0;
  double speedMps = 0.0;
  double hdop = 0.0;
  uint32_t gpsAgeMs = 0;
  bool imuReady = false;
  bool imuHasValues = false;
  double accelMps2 = 0.0;
  double gyroDps = 0.0;
};

class Sensors {
 public:
  Sensors();
  bool begin();
  void update(uint32_t nowMs);
  const SensorSnapshot& snapshot() const { return snapshot_; }

  // Public for host checks and for board-specific serial adapters. The parser
  // accepts only checksum-valid RMC/GGA sentences and never invents a fix.
  bool ingestNmea(const char* sentence, uint32_t receivedAtMs);

 private:
  SensorSnapshot snapshot_;
  uint32_t lastGpsAtMs_ = 0;
  bool haveGpsTime_ = false;
  std::string nmea_;
};

} // namespace smarttrack
