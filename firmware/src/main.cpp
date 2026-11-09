#include "config.h"
#include "modem_transport.h"
#include "offline_queue.h"
#include "sensors.h"
#include "ui/types.h"
#include "wire_protocol.h"

#ifdef ARDUINO
#include <Arduino.h>

namespace {
using smarttrack::OfflineQueue;
using smarttrack::QueueItem;
using smarttrack::QueueKind;
using smarttrack::Sensors;
using smarttrack::ModemConfig;
using smarttrack::ModemTransport;
using smarttrack::TransportResponse;
using smarttrack::wire::TelemetryFields;

OfflineQueue queue;
Sensors sensors;
ModemTransport transport;
smarttrack::ui::State displayState;
uint32_t sequence = 0;
uint32_t bootStartedAt = 0;
uint32_t lastTelemetryAt = 0;
uint32_t lastButtonPollAt = 0;
bool previousSosPressed = false;
bool previousUserPressed = false;
uint32_t sosPressedAt = 0;
uint32_t userPressedAt = 0;
bool sosHoldHandled = false;
bool userHoldHandled = false;
bool sosActive = false;
bool sosPendingInMemory = false;
std::string pendingSosId;
std::string pendingSosPayload;
std::string bootId;

#ifndef SMARTTRACK_DEVICE_ID
#define SMARTTRACK_DEVICE_ID "UNPROVISIONED"
#endif
#ifndef SMARTTRACK_API_URL
#define SMARTTRACK_API_URL ""
#endif
#ifndef SMARTTRACK_CA_CERTIFICATE
#define SMARTTRACK_CA_CERTIFICATE ""
#endif
#ifndef SMARTTRACK_TLS_HOSTNAME
#define SMARTTRACK_TLS_HOSTNAME ""
#endif
#ifndef SMARTTRACK_DEVICE_SECRET
#define SMARTTRACK_DEVICE_SECRET ""
#endif

ModemConfig modemConfig() {
  ModemConfig result;
  result.apiBaseUrl = SMARTTRACK_API_URL;
  result.caCertificate = SMARTTRACK_CA_CERTIFICATE;
  result.tlsHostname = SMARTTRACK_TLS_HOSTNAME;
  result.deviceSecret = SMARTTRACK_DEVICE_SECRET;
  // A board-qualified clock/NTP implementation must set this explicitly.
  result.clockValid = false;
  return result;
}

std::string makeRecordId() {
  return bootId + "-" + std::to_string(sequence);
}

TelemetryFields currentFields(const std::string& recordId) {
  const smarttrack::SensorSnapshot& sample = sensors.snapshot();
  TelemetryFields fields;
  fields.deviceId = SMARTTRACK_DEVICE_ID;
  fields.recordId = recordId;
  fields.bootId = bootId;
  fields.sequence = sequence;
  fields.uptimeMs = millis() - bootStartedAt;
  fields.gps.fix = sample.gpsFix;
  fields.gps.hasLatitude = sample.gpsFix && sample.gpsHasLatitude;
  fields.gps.hasLongitude = sample.gpsFix && sample.gpsHasLongitude;
  fields.gps.hasSpeed = sample.gpsFix && sample.gpsHasSpeed;
  fields.gps.hasHdop = sample.gpsFix && sample.gpsHasHdop;
  fields.gps.hasAge = sample.gpsFix;
  fields.gps.latitude = sample.latitude;
  fields.gps.longitude = sample.longitude;
  fields.gps.speedMps = sample.speedMps;
  fields.gps.hdop = sample.hdop;
  fields.gps.ageMs = sample.gpsAgeMs;
  fields.hasImu = sample.imuReady && sample.imuHasValues;
  fields.accelMps2 = sample.accelMps2;
  fields.gyroDps = sample.gyroDps;
  return fields;
}

void updateDisplayState() {
  const smarttrack::SensorSnapshot& sample = sensors.snapshot();
  displayState.gpsFix = sample.gpsFix;
  displayState.latitude = static_cast<float>(sample.latitude);
  displayState.longitude = static_cast<float>(sample.longitude);
  displayState.speedMps = static_cast<float>(sample.speedMps);
  displayState.hdop = static_cast<float>(sample.hdop);
  displayState.fixAgeMs = sample.gpsAgeMs;
  displayState.imuReady = sample.imuReady;
  displayState.acceleration = static_cast<float>(sample.accelMps2);
  displayState.gyroDps = static_cast<float>(sample.gyroDps);
  displayState.sdReady = queue.ready();
  displayState.queued = static_cast<uint32_t>(queue.pending());
  displayState.online = transport.ready();
  displayState.sosActive = sosActive;
  displayState.uptimeMs = millis() - bootStartedAt;
}

bool appendTelemetry() {
  if (!queue.ready()) return false;
  ++sequence;
  const std::string id = makeRecordId();
  const std::string payload = smarttrack::wire::serializeTelemetry(currentFields(id));
  if (!queue.append(QueueKind::Telemetry, id, payload)) {
    --sequence;
    return false;
  }
  return true;
}

void tryAppendPendingSos() {
  if (!sosPendingInMemory || !queue.ready()) return;
  if (queue.append(QueueKind::Sos, pendingSosId, pendingSosPayload)) {
    sosPendingInMemory = false;
    pendingSosId.clear();
    pendingSosPayload.clear();
  }
}

void triggerSos() {
  if (sosActive) return;
  sosActive = true;
  ++sequence;
  pendingSosId = makeRecordId();
  pendingSosPayload = smarttrack::wire::serializeSos(currentFields(pendingSosId));
  sosPendingInMemory = true;
  // This path does not inspect ML, IMU, GPS validity, or modem readiness.
  tryAppendPendingSos();
}

void pollButtons(uint32_t now) {
  if (now - lastButtonPollAt < smarttrack::config::BUTTON_DEBOUNCE_MS) return;
  lastButtonPollAt = now;
  const bool sosPressed = digitalRead(smarttrack::config::SOS_BUTTON_PIN) == LOW;
  const bool userPressed = digitalRead(smarttrack::config::USER_BUTTON_PIN) == LOW;
  // Both button actions are wrap-safe and non-blocking. A press edge starts a
  // timer; the event is latched only after the hardware contract's hold time.
  if (sosPressed) {
    if (!previousSosPressed) {
      sosPressedAt = now;
      sosHoldHandled = false;
    }
    if (!sosHoldHandled && now - sosPressedAt >= smarttrack::config::SOS_HOLD_MS) {
      triggerSos();
      sosHoldHandled = true;
    }
  } else {
    sosPressedAt = now;
    sosHoldHandled = false;
  }
  if (userPressed) {
    if (!previousUserPressed) {
      userPressedAt = now;
      userHoldHandled = false;
    }
    if (!userHoldHandled && sosActive && now - userPressedAt >= smarttrack::config::USER_LONGPRESS_MS) {
      // Clearing the local latch does not erase the server-side SOS event;
      // the responder lifecycle remains independently auditable.
      sosActive = false;
      userHoldHandled = true;
    }
  } else {
    userPressedAt = now;
    userHoldHandled = false;
  }
  previousSosPressed = sosPressed;
  previousUserPressed = userPressed;
}

void transmitOne() {
  if (!transport.ready()) return;
  QueueItem item;
  if (!queue.peek(item)) return;
  const smarttrack::wire::Envelope envelope = smarttrack::wire::makeEnvelope(item.payload);
  TransportResponse response;
  if (!transport.post(modemConfig(), item.kind, envelope, response)) return;
  const smarttrack::wire::Receipt receipt = smarttrack::wire::parseAcceptanceReceipt(
      response.body, item.recordId);
  // Exact accepted/record_id/duplicate matching is the only removal boundary.
  queue.acknowledge(receipt);
}
} // namespace

void setup() {
  bootStartedAt = millis();
  bootId = std::string("boot-") + std::to_string(static_cast<unsigned long>(bootStartedAt));
  pinMode(smarttrack::config::PERIPHERAL_ENABLE_PIN, OUTPUT);
  // Active-low P-FET: HIGH is the software-safe disabled level.
  digitalWrite(smarttrack::config::PERIPHERAL_ENABLE_PIN, HIGH);
  pinMode(smarttrack::config::SOS_BUTTON_PIN, INPUT_PULLUP);
  pinMode(smarttrack::config::USER_BUTTON_PIN, INPUT_PULLUP);
  previousSosPressed = digitalRead(smarttrack::config::SOS_BUTTON_PIN) == LOW;
  previousUserPressed = digitalRead(smarttrack::config::USER_BUTTON_PIN) == LOW;
  // The active-low P-FET is kept disabled during GPIO reset, then enabled
  // before sensor startup. Buttons remain on the always-on domain.
  digitalWrite(smarttrack::config::PERIPHERAL_ENABLE_PIN, LOW);
  sensors.begin();
  queue.begin();
  transport.begin(modemConfig());
  lastTelemetryAt = bootStartedAt;
}

void loop() {
  const uint32_t now = millis();
  sensors.update(now);
  pollButtons(now);
  tryAppendPendingSos();
  if (!sosActive && now - lastTelemetryAt >= smarttrack::config::TELEMETRY_PERIOD_MS) {
    lastTelemetryAt = now;
    appendTelemetry();
  }
  transmitOne();
  updateDisplayState();
  // No delay: GPS parsing, SOS latch, and retry work remain cooperative.
}

#else
// Host translation units can inspect and compile the protocol/queue/sensor
// implementation without providing an Arduino core or pretending hardware
// exists. The real entry points are setup()/loop() in an Arduino build.
int smarttrack_firmware_host_translation_unit = 0;
#endif
