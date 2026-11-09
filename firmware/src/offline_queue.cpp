#include "offline_queue.h"

#include "config.h"

#include <cstdio>
#include <cstdlib>
#include <cstring>

#if defined(ARDUINO)
#include <Arduino.h>
#if SMARTTRACK_SD_CS_PIN >= 0
#include <SD.h>
#endif
#else
#include <sys/types.h>
#if defined(_WIN32)
#include <io.h>
#define SMARTTRACK_FSYNC _commit
#else
#include <unistd.h>
#define SMARTTRACK_FSYNC fsync
#endif
#endif

namespace smarttrack {
namespace {
const char* pathOr(const char* supplied, const char* fallback) {
  return supplied != nullptr && supplied[0] != '\0' ? supplied : fallback;
}

bool safeToken(const std::string& value) {
  return !value.empty() && value.find('|') == std::string::npos &&
         value.find('\n') == std::string::npos && value.find('\r') == std::string::npos;
}

bool parseUnsigned(const std::string& text, size_t& value) {
  if (text.empty()) return false;
  char* end = nullptr;
  const unsigned long parsed = std::strtoul(text.c_str(), &end, 10);
  if (end == text.c_str() || *end != '\0') return false;
  value = static_cast<size_t>(parsed);
  return true;
}

bool parseHex(const std::string& text, uint32_t& value) {
  if (text.size() != 8U) return false;
  char* end = nullptr;
  const unsigned long parsed = std::strtoul(text.c_str(), &end, 16);
  if (end != text.c_str() + text.size() || parsed > 0xFFFFFFFFUL) return false;
  value = static_cast<uint32_t>(parsed);
  return true;
}
} // namespace

OfflineQueue::OfflineQueue() = default;

bool OfflineQueue::begin(const char* queuePath, const char* ackPath) {
  close();
  queuePath_ = pathOr(queuePath, config::QUEUE_PATH);
  ackPath_ = pathOr(ackPath, config::ACK_PATH);
#if defined(ARDUINO)
#if SMARTTRACK_SD_CS_PIN >= 0
  if (!SD.begin(config::SD_CS_PIN)) return false;
  File queue = SD.open(queuePath_.c_str(), FILE_APPEND);
  if (!queue) return false;
  queue.close();
  File ack = SD.open(ackPath_.c_str(), FILE_APPEND);
  if (!ack) return false;
  ack.close();
#else
  (void)queuePath;
  (void)ackPath;
  return false;
#endif
#else
  FILE* queue = std::fopen(queuePath_.c_str(), "ab");
  FILE* ack = std::fopen(ackPath_.c_str(), "ab");
  if (queue == nullptr || ack == nullptr) {
    if (queue != nullptr) std::fclose(queue);
    if (ack != nullptr) std::fclose(ack);
    return false;
  }
  std::fclose(queue);
  std::fclose(ack);
#endif
  ready_ = load();
  return ready_;
}

bool OfflineQueue::load() {
  items_.clear();
#if defined(ARDUINO) && SMARTTRACK_SD_CS_PIN >= 0
  File queue = SD.open(queuePath_.c_str(), FILE_READ);
  if (!queue) return false;
  while (queue.available()) {
    String line = queue.readStringUntil('\n');
    std::string source(line.c_str());
    if (!source.empty() && source.back() == '\r') source.pop_back();
    const size_t a = source.find('|');
    const size_t b = a == std::string::npos ? std::string::npos : source.find('|', a + 1U);
    const size_t c = b == std::string::npos ? std::string::npos : source.find('|', b + 1U);
    const size_t d = c == std::string::npos ? std::string::npos : source.find('|', c + 1U);
    const size_t e = d == std::string::npos ? std::string::npos : source.find('|', d + 1U);
    if (a != 2U || b == std::string::npos || c == std::string::npos ||
        d == std::string::npos || e == std::string::npos || source.substr(0, a) != "Q1") continue;
    size_t length = 0; uint32_t expectedCrc = 0;
    const std::string payload = source.substr(e + 1U);
    if ((source[a + 1U] != 'T' && source[a + 1U] != 'S') ||
        !safeToken(source.substr(a + 2U, b - a - 2U)) ||
        !parseUnsigned(source.substr(b + 1U, c - b - 1U), length) ||
        !parseHex(source.substr(c + 1U, d - c - 1U), expectedCrc) ||
        length != payload.size() || smarttrack::wire::crc32(payload) != expectedCrc) continue;
    items_.push_back(StoredItem{QueueItem{source[a + 1U] == 'S' ? QueueKind::Sos : QueueKind::Telemetry,
                                          source.substr(a + 2U, b - a - 2U), payload}, false});
  }
  queue.close();
  File ack = SD.open(ackPath_.c_str(), FILE_READ);
  if (ack) {
    while (ack.available()) {
      String line = ack.readStringUntil('\n');
      const std::string id(line.c_str());
      for (StoredItem& item : items_) if (item.item.recordId == id) item.acknowledged = true;
    }
    ack.close();
  }
#else
  FILE* queue = std::fopen(queuePath_.c_str(), "rb");
  if (queue == nullptr) return false;
  char* line = nullptr;
  size_t capacity = 0;
  while (getline(&line, &capacity, queue) >= 0) {
    std::string source(line);
    if (!source.empty() && source.back() == '\n') source.pop_back();
    if (!source.empty() && source.back() == '\r') source.pop_back();
    const size_t a = source.find('|');
    const size_t b = a == std::string::npos ? std::string::npos : source.find('|', a + 1U);
    const size_t c = b == std::string::npos ? std::string::npos : source.find('|', b + 1U);
    const size_t d = c == std::string::npos ? std::string::npos : source.find('|', c + 1U);
    const size_t e = d == std::string::npos ? std::string::npos : source.find('|', d + 1U);
    if (a != 2U || b == std::string::npos || c == std::string::npos ||
        d == std::string::npos || e == std::string::npos || source.substr(0, a) != "Q1") continue;
    size_t length = 0; uint32_t expectedCrc = 0;
    const std::string payload = source.substr(e + 1U);
    if ((source[a + 1U] != 'T' && source[a + 1U] != 'S') ||
        !safeToken(source.substr(a + 2U, b - a - 2U)) ||
        !parseUnsigned(source.substr(b + 1U, c - b - 1U), length) ||
        !parseHex(source.substr(c + 1U, d - c - 1U), expectedCrc) ||
        length != payload.size() || smarttrack::wire::crc32(payload) != expectedCrc) continue;
    items_.push_back(StoredItem{QueueItem{source[a + 1U] == 'S' ? QueueKind::Sos : QueueKind::Telemetry,
                                          source.substr(a + 2U, b - a - 2U), payload}, false});
  }
  if (line != nullptr) std::free(line);
  std::fclose(queue);
  FILE* ack = std::fopen(ackPath_.c_str(), "rb");
  if (ack != nullptr) {
    char ackLine[256];
    while (std::fgets(ackLine, sizeof(ackLine), ack) != nullptr) {
      std::string id(ackLine);
      while (!id.empty() && (id.back() == '\n' || id.back() == '\r')) id.pop_back();
      for (StoredItem& item : items_) if (item.item.recordId == id) item.acknowledged = true;
    }
    std::fclose(ack);
  }
#endif
  return true;
}

bool OfflineQueue::append(QueueKind kind, const std::string& recordId,
                          const std::string& exactPayload) {
  if (!ready_ || !safeToken(recordId) || exactPayload.find('\n') != std::string::npos ||
      exactPayload.find('\r') != std::string::npos) return false;
  const char kindChar = kind == QueueKind::Sos ? 'S' : 'T';
  const std::string line = std::string("Q1|") + kindChar + "|" + recordId + "|" +
      std::to_string(exactPayload.size()) + "|" + wire::crc32Hex(exactPayload) + "|" +
      exactPayload + "\n";
#if defined(ARDUINO) && SMARTTRACK_SD_CS_PIN >= 0
  File file = SD.open(queuePath_.c_str(), FILE_APPEND);
  if (!file) return false;
  const size_t written = file.print(line.c_str());
  file.flush();
  file.close();
  if (written != line.size()) return false;
#else
  FILE* file = std::fopen(queuePath_.c_str(), "ab");
  if (file == nullptr || std::fwrite(line.data(), 1, line.size(), file) != line.size()) {
    if (file != nullptr) std::fclose(file);
    return false;
  }
  std::fflush(file);
  SMARTTRACK_FSYNC(fileno(file));
  std::fclose(file);
#endif
  items_.push_back(StoredItem{QueueItem{kind, recordId, exactPayload}, false});
  return true;
}

const OfflineQueue::StoredItem* OfflineQueue::firstPending() const {
  for (const StoredItem& item : items_) if (!item.acknowledged) return &item;
  return nullptr;
}

bool OfflineQueue::peek(QueueItem& item) const {
  const StoredItem* pending = firstPending();
  if (pending == nullptr) return false;
  item = pending->item;
  return true;
}

size_t OfflineQueue::pending() const {
  size_t result = 0;
  for (const StoredItem& item : items_) if (!item.acknowledged) ++result;
  return result;
}

bool OfflineQueue::appendAck(const std::string& recordId) {
  const std::string line = recordId + "\n";
#if defined(ARDUINO) && SMARTTRACK_SD_CS_PIN >= 0
  File file = SD.open(ackPath_.c_str(), FILE_APPEND);
  if (!file) return false;
  const size_t written = file.print(line.c_str());
  file.flush(); file.close();
  return written == line.size();
#else
  FILE* file = std::fopen(ackPath_.c_str(), "ab");
  if (file == nullptr || std::fwrite(line.data(), 1, line.size(), file) != line.size()) {
    if (file != nullptr) std::fclose(file);
    return false;
  }
  std::fflush(file);
  const int syncResult = SMARTTRACK_FSYNC(fileno(file));
  std::fclose(file);
  return syncResult == 0;
#endif
}

bool OfflineQueue::acknowledge(const wire::Receipt& receipt) {
  StoredItem* target = nullptr;
  for (StoredItem& item : items_) {
    if (!item.acknowledged) { target = &item; break; }
  }
  if (target == nullptr || !receipt.valid || !receipt.accepted ||
      receipt.recordId != target->item.recordId) return false;
  if (!appendAck(target->item.recordId)) return false;
  target->acknowledged = true;
  return true;
}

void OfflineQueue::close() {
  ready_ = false;
  items_.clear();
  queuePath_.clear();
  ackPath_.clear();
}

} // namespace smarttrack
