#pragma once
#include "types.h"

namespace smarttrack { namespace ui {

inline void renderResponder(Canvas& canvas, const State& state) {
  const bool acknowledged = state.sosAcknowledged;
  constexpr uint16_t ACK_GREEN = 0x02A0;
  const uint16_t ruleColor = acknowledged ? FG : MUTED;

  canvas.fill(acknowledged ? ACK_GREEN : BG);
  canvas.text(16, 18, acknowledged ? "SOS ACKNOWLEDGED" : "RESPONDER STATUS", FG, 2);
  canvas.line(16, 48, 304, 48, ruleColor);

  if (acknowledged) {
    canvas.rect(16, 66, 32, 32, FG);
    canvas.line(22, 81, 29, 88, FG);
    canvas.line(29, 88, 42, 74, FG);
    canvas.text(60, 72, "Acknowledgment reported", FG);
    canvas.text(16, 114, "RESPONDER", FG);

    // One size-2 line: at most 23 glyphs; read at most 24 source bytes.
    char responder[24] = {};
    size_t length = 0;
    if (state.responder != nullptr) {
      while (length < sizeof(responder) - 1 && state.responder[length] != '\0') {
        const unsigned char character = static_cast<unsigned char>(state.responder[length]);
        // Control characters and non-ASCII bytes cannot escape the line layout.
        responder[length] = character >= 32 && character <= 126
            ? static_cast<char>(character) : '?';
        ++length;
      }
      if (length == sizeof(responder) - 1 && state.responder[length] != '\0') {
        responder[length - 3] = '.';
        responder[length - 2] = '.';
        responder[length - 1] = '.';
      }
    }
    canvas.text(16, 134, length == 0 ? "Not provided" : responder, FG, 2);
  } else {
    canvas.text(16, 72, state.sosActive ? "Awaiting acknowledgment" : "No active SOS",
                state.sosActive ? WARN : FG);
    canvas.text(16, 104, "No acknowledgment reported.", FG);
    canvas.text(16, 134, "Responder: unavailable", MUTED);
  }

  canvas.line(16, 180, 304, 180, ruleColor);
  canvas.text(16, 194, "Acknowledgment does not confirm", FG);
  canvas.text(16, 210, "assistance or resolution.", FG);
}

} }
