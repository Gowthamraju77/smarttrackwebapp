// Standalone host test; no Arduino, display hardware, or test framework needed.
// From the repository root:
// g++ -std=c++11 -Wall -Wextra -Werror -pedantic -I firmware/include firmware/test/test_ui.cpp -o test_ui
// ./test_ui

#include <cstdio>
#include <cstdlib>
#include <string>
#include <vector>

#include "ui/page_catalog.h"
#include "ui/page_catalog.h" // The public catalog must also be safe to re-include.

namespace {

using namespace smarttrack::ui;

void check(bool condition, const char* expression, int line) {
  if (!condition) {
    std::fprintf(stderr, "test_ui.cpp:%d: %s\n", line, expression);
    std::exit(EXIT_FAILURE);
  }
}

// Keep checks active in release builds as well as debug builds.
#define CHECK(expression) check((expression), #expression, __LINE__)

enum class Operation { Fill, Text, Rect, Line };

struct DrawCall {
  Operation operation;
  int x;
  int y;
  int a;
  int b;
  uint16_t color;
  uint8_t size;
  std::string value;

  bool operator==(const DrawCall& other) const {
    return operation == other.operation && x == other.x && y == other.y &&
        a == other.a && b == other.b && color == other.color &&
        size == other.size && value == other.value;
  }
};

struct RecordingCanvas : Canvas {
  std::vector<DrawCall> calls;

  void fill(uint16_t color) override {
    calls.push_back({Operation::Fill, 0, 0, 0, 0, color, 0, ""});
  }

  void text(int x, int y, const char* value, uint16_t color,
            uint8_t size = 1) override {
    CHECK(value != nullptr);
    // Renderers use local formatting buffers; capture their contents now.
    calls.push_back({Operation::Text, x, y, 0, 0, color, size, value});
  }

  void rect(int x, int y, int width, int height, uint16_t color) override {
    calls.push_back({Operation::Rect, x, y, width, height, color, 0, ""});
  }

  void line(int x1, int y1, int x2, int y2, uint16_t color) override {
    calls.push_back({Operation::Line, x1, y1, x2, y2, color, 0, ""});
  }
};

typedef void (*Renderer)(Canvas&, const State&);

struct PageCase {
  Page page;
  Renderer render;
};

const PageCase pages[] = {
  {Page::Boot, renderBoot},
  {Page::Status, renderStatus},
  {Page::Gps, renderGps},
  {Page::Motion, renderMotion},
  {Page::Map, renderMap},
  {Page::Journey, renderJourney},
  {Page::Sos, renderSos},
  {Page::Responders, renderResponder},
  {Page::Diagnostics, renderDiagnostics}
};
const size_t pageCount = sizeof(pages) / sizeof(pages[0]);

bool knownPage(Page page) {
  for (size_t i = 0; i < pageCount; ++i) {
    if (pages[i].page == page) return true;
  }
  return false;
}

void expectRendering(Page requested, Renderer expected, const State& state) {
  RecordingCanvas actual;
  RecordingCanvas reference;
  expected(reference, state);
  renderPage(actual, requested, state);
  CHECK(!reference.calls.empty());
  // Compare the whole paint: an ordinary page painted before an SOS overlay,
  // a second renderer, or lost State fields must not pass a title-only check.
  CHECK(actual.calls == reference.calls);
}

State populatedState() {
  State state;
  state.gpsFix = true;
  state.online = true;
  state.sdReady = true;
  state.imuReady = true;
  state.trustAvailable = true;
  state.navigationAvailable = true;
  state.mapAvailable = true;
  // Synthetic test inputs only; these are not a person's location or readings.
  state.latitude = 0.0f;
  state.longitude = 0.0f;
  state.speedMps = 2.5f;
  state.hdop = 1.2f;
  state.acceleration = 9.8f;
  state.gyroDps = 1.5f;
  state.trust = 0.75f;
  state.fixAgeMs = 120;
  state.queued = 42;
  state.uptimeMs = 123456;
  state.journeySeconds = 3661;
  state.distanceMeters = 1250.0f;
  state.deviceId = "TEST-DEVICE";
  state.responder = "TEST-RESPONDER";
  state.instruction = "Test instruction";
  state.fault = "Synthetic test fault";
  return state;
}

void testNavigation() {
  for (size_t i = 0; i < pageCount; ++i) {
    const Page current = pages[i].page;
    CHECK(nextPage(current) == pages[(i + 1) % pageCount].page);
    CHECK(previousPage(current) == pages[(i + pageCount - 1) % pageCount].page);
    CHECK(previousPage(nextPage(current)) == current);
    CHECK(nextPage(previousPage(current)) == current);

    Page forward = current;
    Page backward = current;
    for (size_t step = 0; step < pageCount; ++step) {
      forward = nextPage(forward);
      backward = previousPage(backward);
    }
    CHECK(forward == current);
    CHECK(backward == current);
  }

  // Exhaust the fixed underlying byte, including its upper bound (255).
  for (unsigned int raw = 0; raw < 256; ++raw) {
    const Page page = static_cast<Page>(raw);
    CHECK(knownPage(nextPage(page)));
    CHECK(knownPage(previousPage(page)));
    if (!knownPage(page)) {
      CHECK(nextPage(page) == Page::Status);
      CHECK(previousPage(page) == Page::Status);
    }
  }
}

void testDispatch() {
  const State empty;
  State populated = populatedState();
  for (size_t i = 0; i < pageCount; ++i) {
    expectRendering(pages[i].page, pages[i].render, empty);
    expectRendering(pages[i].page, pages[i].render, populated);
  }

  // An acknowledgement by itself does not force an inactive SOS screen.
  populated.sosAcknowledged = true;
  for (size_t i = 0; i < pageCount; ++i) {
    expectRendering(pages[i].page, pages[i].render, populated);
  }

  for (unsigned int raw = 0; raw < 256; ++raw) {
    const Page page = static_cast<Page>(raw);
    if (!knownPage(page)) {
      expectRendering(page, renderStatus, empty);
      expectRendering(page, renderStatus, populated);
    }
  }
}

void testSosPriority() {
  // First exercise the offline/no-GPS/no-ML case, then available services.
  for (int services = 0; services < 2; ++services) {
    State state = services == 0 ? State() : populatedState();
    state.sosActive = true;
    for (int acknowledged = 0; acknowledged < 2; ++acknowledged) {
      state.sosAcknowledged = acknowledged != 0;
      for (unsigned int raw = 0; raw < 256; ++raw) {
        expectRendering(static_cast<Page>(raw), renderSos, state);
      }
    }
  }
}

void testSosRelease() {
  State state = populatedState();
  for (size_t i = 0; i < pageCount; ++i) {
    state.sosActive = false;
    state.sosAcknowledged = false;
    expectRendering(pages[i].page, pages[i].render, state);
    state.sosActive = true;
    expectRendering(pages[i].page, renderSos, state);
    state.sosAcknowledged = true;
    expectRendering(pages[i].page, renderSos, state);
    state.sosActive = false;
    expectRendering(pages[i].page, pages[i].render, state);
  }
}

} // namespace

int main() {
  testNavigation();
  testDispatch();
  testSosPriority();
  testSosRelease();
  std::puts("UI catalog: navigation, dispatch, invalid pages, SOS priority/release passed");
  return EXIT_SUCCESS;
}
