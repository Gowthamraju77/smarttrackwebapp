#include <Arduino.h>
#include <SPI.h>
#include <initializer_list>

// GPS Tracker hardware contract: ILI9341, 320x240 landscape.
constexpr int TFT_SCK = 12;
constexpr int TFT_MOSI = 11;
constexpr int TFT_MISO = 13;
constexpr int TFT_CS = 10;
constexpr int TFT_DC = 9;
constexpr int TFT_RST = 8;
constexpr int TFT_BACKLIGHT = 5;
constexpr int PERIPHERAL_ENABLE = 21;

constexpr uint16_t BLACK = 0x0000;
constexpr uint16_t BLUE = 0x001F;
constexpr uint16_t RED = 0xF800;
constexpr uint16_t GREEN = 0x07E0;
constexpr uint16_t CYAN = 0x07FF;
constexpr uint16_t MAGENTA = 0xF81F;
constexpr uint16_t YELLOW = 0xFFE0;
constexpr uint16_t WHITE = 0xFFFF;

constexpr uint16_t SCREEN_WIDTH = 320;
constexpr uint16_t SCREEN_HEIGHT = 240;

void writeCommandWithData(uint8_t command, const uint8_t* data, size_t length) {
  digitalWrite(TFT_CS, LOW);
  digitalWrite(TFT_DC, LOW);
  SPI.transfer(command);
  digitalWrite(TFT_DC, HIGH);
  while (length-- != 0) SPI.transfer(*data++);
  digitalWrite(TFT_CS, HIGH);
}

void writeCommand(uint8_t command) {
  writeCommandWithData(command, nullptr, 0);
}

void commandData(uint8_t command, std::initializer_list<uint8_t> data) {
  digitalWrite(TFT_CS, LOW);
  digitalWrite(TFT_DC, LOW);
  SPI.transfer(command);
  digitalWrite(TFT_DC, HIGH);
  for (const uint8_t value : data) SPI.transfer(value);
  digitalWrite(TFT_CS, HIGH);
}

void setAddressWindow(uint16_t x0, uint16_t y0, uint16_t x1, uint16_t y1) {
  const uint8_t columns[] = {
    static_cast<uint8_t>(x0 >> 8), static_cast<uint8_t>(x0 & 0xff),
    static_cast<uint8_t>(x1 >> 8), static_cast<uint8_t>(x1 & 0xff)
  };
  const uint8_t rows[] = {
    static_cast<uint8_t>(y0 >> 8), static_cast<uint8_t>(y0 & 0xff),
    static_cast<uint8_t>(y1 >> 8), static_cast<uint8_t>(y1 & 0xff)
  };
  writeCommandWithData(0x2A, columns, sizeof(columns)); // Column address set
  writeCommandWithData(0x2B, rows, sizeof(rows));       // Page address set
  writeCommand(0x2C); // Memory write
}

void fillRect(uint16_t x, uint16_t y, uint16_t width, uint16_t height,
              uint16_t color) {
  if (x >= SCREEN_WIDTH || y >= SCREEN_HEIGHT || width == 0 || height == 0) return;
  const uint16_t x1 = min<uint16_t>(SCREEN_WIDTH - 1, x + width - 1);
  const uint16_t y1 = min<uint16_t>(SCREEN_HEIGHT - 1, y + height - 1);
  setAddressWindow(x, y, x1, y1);

  digitalWrite(TFT_DC, HIGH);
  digitalWrite(TFT_CS, LOW);
  const uint8_t high = static_cast<uint8_t>(color >> 8);
  const uint8_t low = static_cast<uint8_t>(color & 0xff);
  const uint32_t count = static_cast<uint32_t>(x1 - x + 1) * (y1 - y + 1);
  for (uint32_t pixel = 0; pixel < count; ++pixel) {
    SPI.transfer(high);
    SPI.transfer(low);
  }
  digitalWrite(TFT_CS, HIGH);
}

void drawRect(uint16_t x, uint16_t y, uint16_t width, uint16_t height,
              uint16_t color) {
  if (width < 2 || height < 2) return;
  fillRect(x, y, width, 2, color);
  fillRect(x, y + height - 2, width, 2, color);
  fillRect(x, y, 2, height, color);
  fillRect(x + width - 2, y, 2, height, color);
}

void drawGrid() {
  fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, BLACK);
  drawRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, WHITE);
  for (uint16_t x = 20; x < SCREEN_WIDTH; x += 20) fillRect(x, 0, 1, SCREEN_HEIGHT, BLUE);
  for (uint16_t y = 20; y < SCREEN_HEIGHT; y += 20) fillRect(0, y, SCREEN_WIDTH, 1, GREEN);
  fillRect(4, 4, 80, 16, RED);
  fillRect(120, 4, 80, 16, YELLOW);
  fillRect(236, 4, 80, 16, CYAN);
}

void initializeIli9341() {
  digitalWrite(TFT_RST, LOW);
  delay(20);
  digitalWrite(TFT_RST, HIGH);
  delay(120);

  writeCommand(0x01); // Software reset
  delay(150);
  writeCommand(0x11); // Sleep out
  delay(120);
  // Standard ILI9341 power, timing, and gamma setup used by mature drivers.
  commandData(0xEF, {0x03, 0x80, 0x02});
  commandData(0xCF, {0x00, 0xC1, 0x30});
  commandData(0xED, {0x64, 0x03, 0x12, 0x81});
  commandData(0xE8, {0x85, 0x00, 0x78});
  commandData(0xCB, {0x39, 0x2C, 0x00, 0x34, 0x02});
  commandData(0xF7, {0x20});
  commandData(0xEA, {0x00, 0x00});
  commandData(0xC0, {0x23});
  commandData(0xC1, {0x10});
  commandData(0xC5, {0x3E, 0x28});
  commandData(0xC7, {0x86});
  commandData(0x36, {0x28}); // Landscape orientation, BGR
  commandData(0x3A, {0x55}); // 16-bit RGB565
  commandData(0xB1, {0x00, 0x13});
  commandData(0xB6, {0x08, 0x82, 0x27});
  commandData(0xF2, {0x00});
  commandData(0x26, {0x01});
  commandData(0xE0, {0x0F, 0x31, 0x2B, 0x0C, 0x0E, 0x08, 0x4E, 0xF1,
                      0x37, 0x07, 0x10, 0x03, 0x0E, 0x09, 0x00});
  commandData(0xE1, {0x00, 0x0E, 0x14, 0x03, 0x11, 0x07, 0x31, 0xC1,
                      0x48, 0x08, 0x0F, 0x0C, 0x31, 0x36, 0x0F});
  writeCommand(0x11); // Sleep out
  delay(120);
  writeCommand(0x29); // Display on
  delay(20);
}

void printTestHeader() {
  Serial.println();
  Serial.println("GPS Tracker ILI9341 display test");
  Serial.printf("Chip: %s revision %d\n", ESP.getChipModel(), ESP.getChipRevision());
  Serial.printf("Pins SCK=%d MOSI=%d MISO=%d CS=%d DC=%d RST=%d BL=%d\n",
                TFT_SCK, TFT_MOSI, TFT_MISO, TFT_CS, TFT_DC, TFT_RST,
                TFT_BACKLIGHT);
  Serial.printf("Expected dimensions: %u x %u pixels\n", SCREEN_WIDTH, SCREEN_HEIGHT);
}

void setup() {
  Serial.begin(115200);
  delay(800);
  printTestHeader();

  pinMode(TFT_CS, OUTPUT);
  pinMode(TFT_DC, OUTPUT);
  pinMode(TFT_RST, OUTPUT);
  pinMode(TFT_BACKLIGHT, OUTPUT);
  pinMode(14, OUTPUT); // XPT2046 touch CS; keep the shared-bus slave deselected.
  pinMode(PERIPHERAL_ENABLE, OUTPUT);

  // Active-low peripheral rail: start safe/off, then enable for the display.
  digitalWrite(TFT_CS, HIGH);
  digitalWrite(TFT_DC, HIGH);
  digitalWrite(TFT_RST, HIGH);
  digitalWrite(TFT_BACKLIGHT, LOW);
  digitalWrite(14, HIGH);
  digitalWrite(PERIPHERAL_ENABLE, HIGH);
  delay(20);
  digitalWrite(PERIPHERAL_ENABLE, LOW);
  delay(100);
  SPI.begin(TFT_SCK, TFT_MISO, TFT_MOSI, TFT_CS);
  SPI.beginTransaction(SPISettings(20000000, MSBFIRST, SPI_MODE0));
  initializeIli9341();

  Serial.println("Pattern: steady white, backlight LOW");
  digitalWrite(TFT_BACKLIGHT, LOW);
  fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT, WHITE);
  digitalWrite(TFT_BACKLIGHT, LOW);
  SPI.endTransaction();

  Serial.println("DISPLAY_WHITE_PASS");
  Serial.println("Display should remain solid white with inverted backlight polarity.");
}

void loop() {
  static uint32_t lastHeartbeat = 0;
  if (millis() - lastHeartbeat >= 2000) {
    lastHeartbeat = millis();
    Serial.printf("DISPLAY_HEARTBEAT %lu\n", static_cast<unsigned long>(millis()));
  }
}
