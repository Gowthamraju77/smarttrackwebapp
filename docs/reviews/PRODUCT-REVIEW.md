# SmartTrack: first-product display review

Reviewed 2026-11-04. This is a source-based walkthrough by a parallel product
review agent, using the installed launcher's source and project handoff, followed
by inspection of the updated firmware's rendered screenshots. It is not a
physical usability study or a claim that an agent touched the device. Firmware
build and physical-device evidence belong in the installation report.

## Product direction

Make the device answer three questions quickly: **Where am I? Is that reading
current? What can I do next?** A dependable GPS tracker with a readable screen,
predictable taps and clear connection state is the first release. More apps are
useful only when the sensing, power and storage behind them actually work.

The existing hardware is an ESP32-S3, a 320 × 240 SPI display and an
XPT2046-compatible resistive touch controller. Its touch panel needs physical
contact pressure. Firmware can remove avoidable waiting and missed taps, but
cannot give this panel capacitive glass behavior. A brief deliberate tap with a
fingertip, fingernail or stylus is the interaction to validate. Holding a target
still remains useful during calibration; ordinary navigation should not require
a hold.

## Walkthrough from three user perspectives

| Perspective and task | Friction in the previous display | Product requirement |
| --- | --- | --- |
| First-time owner opening GPS | An icon grid provides no immediate location readiness; `Offline` can suggest the whole device is broken while USB works. | Show GPS readiness on Home and name the actual connection: `Wi-Fi on/off`. Hide stale coordinates. |
| Person checking the tracker outdoors | Tiny 28 px Back/Home controls and small icons are difficult to hit; weak feedback invites repeat taps. | Keep large app tiles; use 44 px navigation buttons, stronger icons, contrast and an obvious pressed state. Validate outdoors with real fingers. |
| Builder diagnosing a problem | Technical data is available but healthy UI could be mistaken for healthy sensors or working emergency delivery. | Retain explicit missing-sensor states, clearly label the laptop-dependent map, and expose diagnostics separately from everyday controls. |

## Implemented display changes in this revision

- Home retains six familiar apps in the same order, with 24 px icons, 96 × 72 px
  tiles, readable captions and restrained accent colors on a dark background.
- Back and Home become labeled 96 × 44 px targets, with a 6 px gap. Calibration
  keeps its existing full-screen target coordinates. The content area is resized
  to leave room for navigation, and app rows are adjusted to fit.
- Buttons gain a contrasting pressed background and border. Button scrolling and
  automatic focus scrolling are disabled; ordinary actions still use a click on
  release. Press feedback must be checked on hardware alongside the touch fix.
- Home's lower status reads `GPS ready` only when the current firmware reports a
  fix; otherwise it says `Seeking GPS`. The header says `Wi-Fi on/off`, which does
  not claim USB, cellular or Internet connectivity.
- The map retains its 288 × 144 image and visible provider attribution. Its state
  appears over the top of the image; stale or absent maps remain hidden with the
  laptop dependency explained.
- Stopwatch controls are 48 px high. Settings use everyday labels; RTOS/library
  names are engineering documentation rather than the main settings heading.

These are lightweight LVGL objects and style changes. No bitmap assets,
animation loops, extra screen buffers or network requests were added for the
visual refresh. Touch sampling and task scheduling are handled by the other
workstreams and must be verified together with this layout.

## Feature priorities

| Priority | Feature | Value and honest release condition |
| --- | --- | --- |
| P0 | Brief taps, immediate feedback, one action per press | The primary reliability fix. Measure under GPS/USB/map traffic; prevent repeated actions during a hold and prevent calibration touches activating an app. |
| P0 | GPS fix, reading age and clear stale states | Prevent confusing a remembered position with the current one. Current launcher hides unavailable coordinates; richer age/accuracy wording is a proposed follow-up. HDOP is not a distance accuracy estimate. |
| P0 | Robust boot and saved calibration | The screen must recover and remain usable without the laptop. Calibration already uses NVS; test reboot, failed setup and interrupted update paths. |
| P0 | Missing-sensor and connection diagnostics | GPS, MPU, modem and map have independent health. The launcher must continue to show failures plainly. Current MPU and modem communication issues remain separate hardware work. |
| P1 | Trip start/stop, duration, distance and history | More valuable for a tracker than adding unrelated apps. Requires validated GPS filtering, persistent storage and a power-loss-safe record format. SD chip-select is currently unassigned; this is not implemented. |
| P1 | Battery/charging status and screen dimming | Makes the tracker feel portable and predictable. Verify the battery gauge/ADC circuit and backlight drive before showing percentages or promising dimming. No fabricated battery icon. |
| P1 | Return-to-start and saved places | Useful even without rich maps. Requires validated coordinate storage, direction/distance calculations and clear low-confidence states. A bearing arrow is not turn-by-turn navigation. |
| P1 | Simple connection/setup flow | A clear USB/Wi-Fi status page and pairing instructions reduce setup friction. Separate local GPS operation from laptop map and cloud relay availability. |
| P2 | Geofence and movement alerts | Requires tested GPS confidence logic, working motion readings when used and controlled false alarms. Let users inspect and cancel an alert. |
| P2 | SOS/contact delivery with acknowledgement | Only expose as a functioning product feature after the modem or relay can deliver, retry and report receipt. A button alone is not emergency delivery. |

Battery sensing, trip storage, geofencing, standalone maps, cellular messages and
SOS are **proposals**, not features delivered by this display revision. The
remote web application's routes and UI contracts also do not establish that
these device capabilities work end to end.

## Acceptance checks for the first display release

1. After calibration, make 20 brief taps across all Home tiles and both navigation
   buttons. Record misses and wrong destinations. Repeat with active map
   transfers and GPS traffic; goal: every deliberate valid tap produces one
   action, with visible feedback targeted below 100 ms. This is a target until
   measured on the real panel.
2. Hold a button for two seconds: it should show feedback without repeatedly
   triggering. Slide off before release: it should cancel rather than open the
   neighboring app. Release and tap again immediately to check debounce timing.
3. Inspect Home, GPS, Motion, Cellular, Map, Stopwatch and Settings for clipped
   text and overlaps. Render-buffer screenshots can prove layout; they cannot
   prove sunlight readability, backlight appearance or physical touch feel.
4. Disconnect the map server and remove GPS reception separately. Check that
   Home, GPS and Map state remain truthful and navigation stays responsive.
5. Reboot, confirm calibration persists, then run calibration again and cancel.
   Confirm the previous valid mapping remains available and target presses do
   not activate apps beneath them.

## Rendered-screen review

After the integrated firmware was installed, the review agent inspected all
seven screenshots in `product-touch-install/`: Home, GPS, Motion, Cellular, Map,
Stopwatch and Settings. No text clipping or control overlaps were visible. The
larger icons, navigation controls, GPS heading and settings controls fit the
320 × 240 output. Missing MPU and modem states were clearly visible. The Map
capture showed the unavailable state; its live image overlay was not visually
verified. That unavailable state repeats the laptop requirement in its status
line and center message, a minor future copy improvement. These captures do not
verify physical tap feel, pressed feedback timing or display readability in
sunlight.

The recommended next hardware choice for phone-like light-touch behavior is a
capacitive panel/controller. It requires a compatible display assembly and a
new input driver/wiring check, so it is a future hardware decision rather than a
firmware setting for the existing resistive panel.
