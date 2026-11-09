#include "wire_protocol.h"

#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace smarttrack { namespace wire {
namespace {
bool finite(double value) { return std::isfinite(value); }

std::string number(double value) {
  char buffer[32];
  if (!finite(value)) return "null";
  const int count = std::snprintf(buffer, sizeof(buffer), "%.9g", value);
  return count > 0 && static_cast<size_t>(count) < sizeof(buffer)
      ? std::string(buffer, static_cast<size_t>(count)) : "null";
}

void appendGps(std::string& out, const GpsFields& gps) {
  out += "{\"fix\":";
  out += gps.fix ? "true" : "false";
  out += ",\"lat\":";
  out += gps.fix && gps.hasLatitude ? number(gps.latitude) : "null";
  out += ",\"lon\":";
  out += gps.fix && gps.hasLongitude ? number(gps.longitude) : "null";
  out += ",\"speed_mps\":";
  out += gps.fix && gps.hasSpeed ? number(gps.speedMps) : "null";
  out += ",\"hdop\":";
  out += gps.fix && gps.hasHdop ? number(gps.hdop) : "null";
  out += ",\"age_ms\":";
  out += gps.fix && gps.hasAge ? std::to_string(gps.ageMs) : "null";
  out += "}";
}

void appendIdentity(std::string& out, const TelemetryFields& f) {
  out += "\"version\":1,\"device_id\":\"" + escapeJson(f.deviceId);
  out += "\",\"record_id\":\"" + escapeJson(f.recordId);
  out += "\",\"recorded_at\":";
  out += f.recordedAt.empty() ? "null" : "\"" + escapeJson(f.recordedAt) + "\"";
  out += ",\"boot_id\":\"" + escapeJson(f.bootId);
  out += "\",\"sequence\":" + std::to_string(f.sequence);
  out += ",\"uptime_ms\":" + std::to_string(f.uptimeMs);
}
} // namespace

uint32_t crc32(const uint8_t* bytes, size_t length) {
  uint32_t crc = 0xFFFFFFFFU;
  for (size_t i = 0; i < length; ++i) {
    crc ^= bytes[i];
    for (unsigned bit = 0; bit < 8; ++bit) {
      crc = (crc & 1U) != 0U ? (crc >> 1U) ^ 0xEDB88320U : crc >> 1U;
    }
  }
  return crc ^ 0xFFFFFFFFU;
}

std::string crc32Hex(uint32_t value) {
  char buffer[9];
  std::snprintf(buffer, sizeof(buffer), "%08x", static_cast<unsigned>(value));
  return std::string(buffer, 8);
}

std::string escapeJson(const std::string& value) {
  std::string result;
  result.reserve(value.size() + 8);
  static const char hex[] = "0123456789abcdef";
  for (unsigned char c : value) {
    switch (c) {
      case '"': result += "\\\""; break;
      case '\\': result += "\\\\"; break;
      case '\b': result += "\\b"; break;
      case '\f': result += "\\f"; break;
      case '\n': result += "\\n"; break;
      case '\r': result += "\\r"; break;
      case '\t': result += "\\t"; break;
      default:
        if (c < 0x20U) {
          result += "\\u00";
          result += hex[c >> 4U];
          result += hex[c & 0x0FU];
        } else result += static_cast<char>(c);
    }
  }
  return result;
}

Envelope makeEnvelope(const std::string& exactPayload) {
  return Envelope{exactPayload, crc32Hex(exactPayload)};
}

Receipt parseAcceptanceReceipt(const std::string& response,
                               const std::string& expectedRecordId) {
  Receipt result;
  const std::string accepted = "\"accepted\":true";
  const std::string duplicateTrue = "\"duplicate\":true";
  const std::string duplicateFalse = "\"duplicate\":false";
  const std::string key = "\"record_id\":\"";
  const size_t a = response.find(accepted);
  const size_t d = response.find(duplicateTrue);
  const size_t df = response.find(duplicateFalse);
  const size_t r = response.find(key);
  if (a == std::string::npos || r == std::string::npos ||
      (d == std::string::npos && df == std::string::npos)) return result;
  const size_t start = r + key.size();
  const size_t end = response.find('"', start);
  if (end == std::string::npos) return result;
  result.recordId = response.substr(start, end - start);
  result.accepted = true;
  result.duplicate = d != std::string::npos;
  result.valid = result.recordId == expectedRecordId;
  return result;
}

std::string serializeTelemetry(const TelemetryFields& f) {
  std::string out = "{";
  appendIdentity(out, f);
  out += ",\"gps\":";
  appendGps(out, f.gps);
  out += ",\"imu\":";
  if (!f.hasImu || !finite(f.accelMps2) || !finite(f.gyroDps)) out += "null";
  else out += "{\"accel_mps2\":" + number(f.accelMps2) +
              ",\"gyro_dps\":" + number(f.gyroDps) + "}";
  out += "}";
  return out;
}

std::string serializeSos(const TelemetryFields& f) {
  std::string out = "{";
  appendIdentity(out, f);
  out += ",\"event\":\"sos\",\"gps\":";
  appendGps(out, f.gps);
  out += "}";
  return out;
}

} } // namespace smarttrack::wire
