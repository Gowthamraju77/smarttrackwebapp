#pragma once
#include <stdint.h>
#include <stddef.h>

namespace smarttrack { namespace ui {
enum class Page : uint8_t { Boot, Status, Gps, Motion, Map, Journey, Sos, Responders, Diagnostics };
struct State {
  bool gpsFix=false, online=false, sdReady=false, imuReady=false, sosActive=false, sosAcknowledged=false;
  bool trustAvailable=false, navigationAvailable=false, mapAvailable=false;
  float latitude=0, longitude=0, speedMps=0, hdop=0, acceleration=0, gyroDps=0, trust=0;
  uint32_t fixAgeMs=0, queued=0, uptimeMs=0, journeySeconds=0;
  float distanceMeters=0;
  const char* deviceId="Unprovisioned";
  const char* responder="";
  const char* instruction="Navigation unavailable";
  const char* fault="";
};
struct Canvas {
  virtual ~Canvas() = default;
  virtual void fill(uint16_t color)=0;
  virtual void text(int x,int y,const char* value,uint16_t color,uint8_t size=1)=0;
  virtual void rect(int x,int y,int width,int height,uint16_t color)=0;
  virtual void line(int x1,int y1,int x2,int y2,uint16_t color)=0;
};
constexpr uint16_t BG=0x0841, FG=0xFFFF, MUTED=0xAD55, ACCENT=0x07D3, WARN=0xFD20, DANGER=0xF800;
} }
