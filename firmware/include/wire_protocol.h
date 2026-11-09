#pragma once

#include <stdint.h>
#include <stddef.h>
#include <string>

namespace smarttrack { namespace wire {

// The API CRC is over the bytes of the already serialized payload.  Callers
// must not parse and reserialize the payload between these two operations.
uint32_t crc32(const uint8_t* bytes, size_t length);
inline uint32_t crc32(const std::string& payload) {
  return crc32(reinterpret_cast<const uint8_t*>(payload.data()), payload.size());
}
std::string crc32Hex(uint32_t value);
inline std::string crc32Hex(const std::string& payload) {
  return crc32Hex(crc32(payload));
}

struct Receipt {
  bool valid = false;
  bool accepted = false;
  bool duplicate = false;
  std::string recordId;
};

// A receipt is usable for queue removal only when all four fields are valid;
// in particular HTTP status alone is never an acknowledgment.
Receipt parseAcceptanceReceipt(const std::string& response,
                               const std::string& expectedRecordId);

struct Envelope {
  std::string payload;
  std::string crc32;
};

Envelope makeEnvelope(const std::string& exactPayload);
std::string escapeJson(const std::string& value);

struct GpsFields {
  bool fix = false;
  bool hasLatitude = false;
  bool hasLongitude = false;
  bool hasSpeed = false;
  bool hasHdop = false;
  bool hasAge = false;
  double latitude = 0.0;
  double longitude = 0.0;
  double speedMps = 0.0;
  double hdop = 0.0;
  uint32_t ageMs = 0;
};

struct TelemetryFields {
  std::string deviceId;
  std::string recordId;
  std::string recordedAt; // empty means JSON null (clock not synchronized).
  std::string bootId;
  uint32_t sequence = 0;
  uint32_t uptimeMs = 0;
  GpsFields gps;
  bool hasImu = false;
  double accelMps2 = 0.0;
  double gyroDps = 0.0;
};

std::string serializeTelemetry(const TelemetryFields& fields);
std::string serializeSos(const TelemetryFields& fields);

} } // namespace smarttrack::wire
