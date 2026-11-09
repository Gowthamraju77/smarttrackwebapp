#pragma once

#include <stdint.h>
#include <string>

#include "offline_queue.h"

namespace smarttrack {

struct ModemConfig {
  const char* apiBaseUrl = nullptr; // must be https://
  const char* caCertificate = nullptr;
  const char* tlsHostname = nullptr;
  const char* deviceSecret = nullptr;
  bool clockValid = false;
};

struct TransportResponse {
  bool connected = false;
  int statusCode = 0;
  std::string body;
};

// A board-qualified modem backend can implement the AT/TLS exchange without
// changing queue semantics. The default backend is intentionally absent.
class IModemBackend {
 public:
  virtual ~IModemBackend() = default;
  virtual bool begin(int rxPin, int txPin, int pwrKeyPin) = 0;
  virtual bool postHttps(const ModemConfig& config, const char* path,
                         const wire::Envelope& envelope,
                         TransportResponse& response) = 0;
};

class ModemTransport {
 public:
  ModemTransport();
  void setBackend(IModemBackend* backend) { backend_ = backend; }
  bool begin(const ModemConfig& config);
  bool ready() const { return ready_; }
  bool post(const ModemConfig& config, QueueKind kind,
            const wire::Envelope& envelope, TransportResponse& response);

 private:
  IModemBackend* backend_ = nullptr;
  bool ready_ = false;
};

} // namespace smarttrack
