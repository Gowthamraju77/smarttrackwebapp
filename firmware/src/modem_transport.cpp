#include "modem_transport.h"

#include "config.h"

#include <cstring>

namespace smarttrack {
namespace {
bool hasHttpsScheme(const char* url) {
  return url != nullptr && std::strncmp(url, "https://", 8) == 0 && url[8] != '\0';
}
bool configured(const ModemConfig& config) {
  return hasHttpsScheme(config.apiBaseUrl) && config.caCertificate != nullptr &&
      config.caCertificate[0] != '\0' && config.tlsHostname != nullptr &&
      config.tlsHostname[0] != '\0' && config.deviceSecret != nullptr &&
      config.deviceSecret[0] != '\0' && config.clockValid;
}
} // namespace

ModemTransport::ModemTransport() = default;

bool ModemTransport::begin(const ModemConfig& config) {
  ready_ = false;
  // MODEM_ENABLED is a compile-time gate. In particular, the default build
  // never initializes UART pins 48/47, never drives PWRKEY, and never powers
  // or attaches a modem.
  if (!config::MODEM_ENABLED || !configured(config) || backend_ == nullptr) return false;
  if (config::MODEM_PWRKEY_PIN < -1) return false;
  // The backend owns the board-specific modem timing and must configure TLS
  // chain, hostname, and clock validation. No plaintext fallback is exposed.
  ready_ = backend_->begin(config::MODEM_RX_PIN, config::MODEM_TX_PIN,
                           config::MODEM_PWRKEY_PIN);
  return ready_;
}

bool ModemTransport::post(const ModemConfig& config, QueueKind kind,
                          const wire::Envelope& envelope,
                          TransportResponse& response) {
  response = TransportResponse();
  if (!ready_ || backend_ == nullptr || !configured(config)) return false;
  const char* path = kind == QueueKind::Sos ? config::API_SOS_PATH : config::API_INGEST_PATH;
  if (!backend_->postHttps(config, path, envelope, response)) return false;
  return response.connected && response.statusCode >= 200 && response.statusCode < 300;
}

} // namespace smarttrack
