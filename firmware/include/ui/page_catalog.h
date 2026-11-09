#pragma once

#include "types.h"
#include "page_boot.h"
#include "page_status.h"
#include "page_gps.h"
#include "page_motion.h"
#include "page_map.h"
#include "page_journey.h"
#include "page_sos.h"
#include "page_responder.h"
#include "page_diagnostics.h"

namespace smarttrack { namespace ui {

// Explicit transitions avoid out-of-range arithmetic on the uint8_t enum.
// Both directions wrap through all pages and recover invalid values to Status.
inline Page nextPage(Page page) {
  switch (page) {
    case Page::Boot: return Page::Status;
    case Page::Status: return Page::Gps;
    case Page::Gps: return Page::Motion;
    case Page::Motion: return Page::Map;
    case Page::Map: return Page::Journey;
    case Page::Journey: return Page::Sos;
    case Page::Sos: return Page::Responders;
    case Page::Responders: return Page::Diagnostics;
    case Page::Diagnostics: return Page::Boot;
    default: return Page::Status;
  }
}

inline Page previousPage(Page page) {
  switch (page) {
    case Page::Boot: return Page::Diagnostics;
    case Page::Status: return Page::Boot;
    case Page::Gps: return Page::Status;
    case Page::Motion: return Page::Gps;
    case Page::Map: return Page::Motion;
    case Page::Journey: return Page::Map;
    case Page::Sos: return Page::Journey;
    case Page::Responders: return Page::Sos;
    case Page::Diagnostics: return Page::Responders;
    default: return Page::Status;
  }
}

inline void renderPage(Canvas& canvas, Page page, const State& state) {
  // An acknowledgement is not resolution. Keep the emergency visible until
  // its owner clears the active latch, without changing the requested page.
  if (state.sosActive) {
    renderSos(canvas, state);
    return;
  }

  switch (page) {
    case Page::Boot: renderBoot(canvas, state); return;
    case Page::Status: renderStatus(canvas, state); return;
    case Page::Gps: renderGps(canvas, state); return;
    case Page::Motion: renderMotion(canvas, state); return;
    case Page::Map: renderMap(canvas, state); return;
    case Page::Journey: renderJourney(canvas, state); return;
    case Page::Sos: renderSos(canvas, state); return;
    case Page::Responders: renderResponder(canvas, state); return;
    case Page::Diagnostics: renderDiagnostics(canvas, state); return;
    default: renderStatus(canvas, state); return;
  }
}

// Catalogs are included by static display-contract checks alongside pages.  A
// small named renderer keeps that interface explicit without making the
// catalog a separate screen or changing page dispatch semantics.
inline void renderCatalog(Canvas& canvas, const State& state) {
  renderPage(canvas, Page::Status, state);
}

} } // namespace smarttrack::ui
