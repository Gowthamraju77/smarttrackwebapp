#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string>
#include <vector>

#include "wire_protocol.h"

namespace smarttrack {

enum class QueueKind : uint8_t { Telemetry = 0, Sos = 1 };

struct QueueItem {
  QueueKind kind = QueueKind::Telemetry;
  std::string recordId;
  std::string payload; // exact bytes handed to wire::makeEnvelope
};

// The queue data and acknowledgment files are append-only.  Acknowledging a
// record appends its ID to the ack journal; it never truncates or rewrites the
// unsent payload.  A record is removable from the pending view only after a
// valid accepted/ID-matching receipt has been made durable.
class OfflineQueue {
 public:
  OfflineQueue();

  // Host tests may provide a temporary path. On hardware the default path is
  // the SD path from config.h; begin() fails when the CS pin is -1.
  bool begin(const char* queuePath = nullptr, const char* ackPath = nullptr);
  bool ready() const { return ready_; }
  bool append(QueueKind kind, const std::string& recordId,
              const std::string& exactPayload);
  bool peek(QueueItem& item) const;
  size_t pending() const;
  bool acknowledge(const wire::Receipt& receipt);
  void close();

 private:
  struct StoredItem {
    QueueItem item;
    bool acknowledged = false;
  };

  bool ready_ = false;
  std::string queuePath_;
  std::string ackPath_;
  std::vector<StoredItem> items_;
  bool load();
  bool appendAck(const std::string& recordId);
  const StoredItem* firstPending() const;
};

} // namespace smarttrack
