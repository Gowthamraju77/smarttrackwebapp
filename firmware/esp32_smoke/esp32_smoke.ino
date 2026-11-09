#include <Arduino.h>

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println();
  Serial.println("ESP32_SMOKE_BOOT_OK");
  Serial.printf("chip=%s revision=%d cores=%d cpu=%uMHz flash=%u psram=%u\n",
                ESP.getChipModel(), ESP.getChipRevision(), ESP.getChipCores(),
                ESP.getCpuFreqMHz(), ESP.getFlashChipSize(), ESP.getPsramSize());
  Serial.println("ESP32_SMOKE_HEARTBEAT_START");
}

void loop() {
  static uint32_t last = 0;
  if (millis() - last >= 1000) {
    last = millis();
    Serial.printf("ESP32_SMOKE_TICK %lu\n", static_cast<unsigned long>(millis()));
  }
}
