#pragma once

// SmartTrack board contract.  A pin which is not present on the supplied
// schematic is deliberately disabled rather than guessed.
#include <stdint.h>

#ifndef SMARTTRACK_MODEM_ENABLED
#define SMARTTRACK_MODEM_ENABLED 0
#endif
#ifndef SMARTTRACK_SD_CS_PIN
#define SMARTTRACK_SD_CS_PIN -1
#endif
#ifndef SMARTTRACK_MODEM_PWRKEY_PIN
#define SMARTTRACK_MODEM_PWRKEY_PIN -1
#endif

namespace smarttrack { namespace config {
constexpr int GPS_RX_PIN = 6;
constexpr int GPS_TX_PIN = 7;
constexpr int I2C_SDA_PIN = 17;
constexpr int I2C_SCL_PIN = 18;

constexpr int TFT_SCK_PIN = 12;
constexpr int TFT_MOSI_PIN = 11;
constexpr int TFT_MISO_PIN = 13;
constexpr int TFT_CS_PIN = 10;
constexpr int TFT_DC_PIN = 9;
constexpr int TFT_RST_PIN = 8;
constexpr int TOUCH_CS_PIN = 14;
constexpr int TOUCH_IRQ_PIN = 15;
constexpr int TFT_BACKLIGHT_PIN = 5;

constexpr int SOS_BUTTON_PIN = 1;
constexpr int USER_BUTTON_PIN = 2;
// GPIO21 controls an active-low P-FET.  This is not the TPS22918 control.
constexpr int PERIPHERAL_ENABLE_PIN = 21;
constexpr bool PERIPHERAL_ENABLE_ACTIVE_LOW = true;

// These UART pins are reserved by the board contract.  They are not touched
// unless a deliberately enabled, board-qualified modem build is supplied.
constexpr int MODEM_RX_PIN = 48;
constexpr int MODEM_TX_PIN = 47;
constexpr int MODEM_PWRKEY_PIN = SMARTTRACK_MODEM_PWRKEY_PIN;
constexpr int SD_CS_PIN = SMARTTRACK_SD_CS_PIN;
constexpr bool MODEM_ENABLED = SMARTTRACK_MODEM_ENABLED != 0;

constexpr uint32_t GPS_STALE_AFTER_MS = 5000U;
constexpr uint32_t TELEMETRY_PERIOD_MS = 10000U;
constexpr uint32_t BUTTON_DEBOUNCE_MS = 35U;
constexpr uint32_t SOS_HOLD_MS = 1200U;
constexpr uint32_t USER_LONGPRESS_MS = 2000U;
constexpr const char* QUEUE_PATH = "/smarttrack.queue";
constexpr const char* ACK_PATH = "/smarttrack.queue.ack";
constexpr const char* API_INGEST_PATH = "/api/ingest";
constexpr const char* API_SOS_PATH = "/api/sos";

static_assert(MODEM_PWRKEY_PIN == -1 || MODEM_ENABLED,
              "A modem PWRKEY must not be enabled without an explicit modem build");
static_assert(SD_CS_PIN == -1 || SD_CS_PIN >= 0,
              "SD CS must be -1 or a board-qualified GPIO");
} } // namespace smarttrack::config
