# Verification record

## Location-only and location-with-trail views - 2026-11-06

Every shared `LiveMap` now offers `Location only` and `Location + trail` next
to 2D/3D. This covers Dashboard, Live map, Journey, Navigation with a selected
route, and Devices. The existing trail view remains the default. The selected
mode persists in this browser, follows navigation/reloads, and synchronizes
between tabs. If storage writes fail, selection still works in the current tab.

Location-only hides both device trail layers, the trail legend and Fit captured
trail control. The location marker remains available. Raw capture collection,
the automatic position filter and planned navigation routes are unchanged.

`npm run build` passed with the existing autoprefixer warning about `end` in
`hardware-status.module.css`. All ten final verification rounds passed:

- `node node_modules/typescript/bin/tsc --noEmit`
- `node --test tests/stationary-map.test.mjs tests/signal-stabilization.test.mjs` (34 tests)
- `node .local/trail-mode-check.cjs`

The temporary browser check uses synthetic GPS/roads and directly reads the
WebGL canvas: 900 trail pixels displayed, zero hidden, 900 restored. It exercises
both controls in all five sections, reloads, cross-tab updates, keyboard Enter,
historical position, retained captures, storage quota failure, and widths 320,
360, 390 and 768 without overflow or overlapping controls. No browser runtime
errors occurred. Initial assertions using element screenshots also captured
overlaid controls; the final check waits for rendering and reads the canvas
bitmap itself. Those initial failures and all ten final command receipts are
retained in [MAP_TRAIL_VERIFICATION.json](MAP_TRAIL_VERIFICATION.json).

Deployment `dpl_2yfjB6evtfBuwTvsGGYcK1DoMtfd` reached READY and was aliased to
`https://smarttrackwebapp.vercel.app`. The same browser check passed against
the production URL in all five sections, with synthetic GPS/roads, zero browser
errors and the same 900/0/900 canvas pixel counts. Receipt:
[MAP_TRAIL_HOSTED.json](MAP_TRAIL_HOSTED.json). A separate actual `/api/live`
request returned HTTP 200 with retained stale observations; upstream `/infoesp`
reported `waiting`. Fresh physical telemetry was not available for this check.

## Automatic MPU-aware map positioning - 2026-11-05

Resumed the interrupted session's `stationary-map.ts` implementation and connected
it to the shared map provider. Five independent quiet MPU samples spanning at
least four seconds allow a GPS hold. The representative position is an actual
observation in the densest 12 m cluster (at least 60% support), rather than a
fabricated road junction. A bounded 12-second sample window supports both fast
USB streams and roughly two-second feed updates. Movement is measured relative
to the quiet MPU baseline because the current sensor reports a substantial gyro
offset. Supplied physical vectors are used when fresh and complete; unscaled
serial registers use explicit relative/count thresholds.

MPU movement releases the position immediately, including GPS movement below the
old 3 m deadband. Missing, stale, saturated or repeated MPU evidence cannot keep
the hold alive. Reconnects, counter resets and GPS gaps establish new baselines.
Consistent departure beyond the 40 m region releases a hold even during smooth
travel, which an IMU alone cannot distinguish from rest. GPS loss retains a
historical position without renewing its timestamps. Raw captures, journey
evidence and quality scores remain untouched; only the map's presentation trail
is condensed. Existing motion preview smoothing is retained.

The filter runs automatically. Its controls, explanatory text, changed marker
styling and accessibility labels have been removed from the website. Old local
`Raw` preferences cannot turn it off. Normal live/historical GPS labels remain.

`npm run build` passed; the existing `hardware-status.module.css` autoprefixer
warning about `end` remains. All ten final verification rounds passed:

- `node node_modules/typescript/bin/tsc --noEmit`
- `node --test tests/stationary-map.test.mjs tests/signal-stabilization.test.mjs tests/infoesp.test.mjs tests/live-relay.test.mjs tests/captured-feed.test.mjs tests/live-telemetry.test.mjs tests/heading.test.mjs` (83 tests per round)
- `node tests/stationary-map-browser.cjs`

The browser check uses synthetic telemetry and map tiles. It pans away from the
device to verify the rendered marker stays fixed independently of camera
following, then verifies motion release, stale-MPU release, reconnect reset,
retained raw captures, absent controls, and mobile layout. Zero browser runtime
errors occurred. Actual command output, exit codes and durations for all ten
rounds are in [STATIONARY_MAP_VERIFICATION.json](STATIONARY_MAP_VERIFICATION.json).

`BASE_URL=http://127.0.0.1:3111 SMARTTRACK_PUBLIC_LIVE=1 node tests/spatial-browser-smoke.cjs`
also passed: map controls, navigation, four responsive widths, keyboard focus,
reduced motion, map retry, mock USB navigation/disconnect and the new filter.
These are environment assignments; use `$env:NAME = 'value'` in PowerShell.

Initial integration caught a removed `holding` label reference in TypeScript;
it was fixed before the final build. The first broader browser run failed an
old assertion that anonymous pages never poll `/api/live`. The prior session
explicitly enabled public polling. The regression now checks the declared
public/private deployment setting and still rejects invented credentials and
positions. Physical movement and GPS accuracy have not been independently
measured by these synthetic checks.

Production deployment `dpl_AhXH9txNmpFow3TDFeMkGXEac4CB` reached READY and was
aliased to `https://smarttrackwebapp.vercel.app`. The hosted
`SMARTTRACK_ALL_SECTIONS=1 node tests/infoesp-browser.cjs` check passed at
2026-11-05 18:09 UTC using the normal URL: 16 successful feed responses, 11
distinct sensor receipts, advancing hardware timestamps, a current GPS fix and
available MPU, and 11 routes including `/map` in a fresh browser. The filter
controls were absent. No viewer token, credentialed live request or browser
runtime error occurred. Contact submissions were intercepted in every browser
context. [STATIONARY_MAP_HOSTED.json](STATIONARY_MAP_HOSTED.json) contains the
command receipt and sanitized output; no personal coordinates were saved.

## Normal website URLs receive infoesp automatically - 2026-11-05

The prior hosted check used a private viewer fragment. An ordinary browser
opened the plain URL without a viewer key, so polling never started and an
anonymous `/api/live` request returned 401. That check did not cover the user's
actual workflow.

`SMARTTRACK_PUBLIC_LIVE=1` now explicitly enables the shared read-only feed in
both the server API and the root client provider. Browsers automatically poll
from the normal URL without sending Authorization or storing a viewer token.
Other deployments remain private unless the flag is enabled. Relay secrets,
database writes and notification scheduling are unaffected. The Devices page
also includes the supplied hardware reports.

`npm run build` passed. All ten final rounds passed:

- `node node_modules/typescript/bin/tsc --noEmit`
- `node --test tests/infoesp.test.mjs tests/live-relay.test.mjs tests/captured-feed.test.mjs tests/live-telemetry.test.mjs` (44 tests)
- `node tests/infoesp-browser.cjs`

The real-data browser check opens the plain root URL, verifies advancing sensor
and rendered hardware timestamps, reloads, and opens `/map` in a separate fresh
browser context. It asserts that no viewer token or Authorization header is
used. An additional `SMARTTRACK_ALL_SECTIONS=1 node tests/infoesp-browser.cjs`
run covered journey, navigation, insights, analytics, alerts, devices, display,
activity and settings, with zero browser runtime errors. A synthetic local
contact profile avoids the unrelated onboarding form; telemetry is real and
notification delivery is not part of the test.

During the initial repeated check, the physical receiver changed to
`receiving_no_fix` with fix quality 0 while the stream and MPU remained live.
The old assertion incorrectly required a fix in every real observation. The
browser check now accepts the source's current or retained position and records
`gpsFixAtCheck` separately; it never replaces a missing fix. Synthetic unit tests
still enforce live-fix, stale and disconnected behavior explicitly. The initial
failure and all ten final receipts are retained in
[PUBLIC_INFOESP_VERIFICATION.json](PUBLIC_INFOESP_VERIFICATION.json).

The first hosted multi-page probe matched an outgoing page's in-flight poll
while navigating, producing a Playwright response-body-unavailable error.
The probe now waits for a response after each new page has loaded, so it reads
the current page's response before the next navigation. This changed the
verification harness only; production requests were already returning HTTP 200.

## Continuous infoesp feed - 2026-11-05

The local relay now supports the existing `/infoesp` JSON collector without
opening a serial port. It polls in the background through the **SmartTrack
infoesp relay** scheduled task, preserves sensor timestamps and component
errors, rejects malformed/out-of-order uploads, and keeps unavailable and stale
measurements separate from current values. The website accepts this source and
displays collector-reported physical units and hardware errors.

`npm run build` passed. All ten final rounds passed these exact commands:

- `node node_modules/typescript/bin/tsc --noEmit`
- `node --test tests/infoesp.test.mjs tests/live-relay.test.mjs tests/captured-feed.test.mjs tests/live-telemetry.test.mjs` (42 tests)
- `node tests/infoesp-browser.cjs` against `http://127.0.0.1:3111`

The browser checks received actual changing observations through the website
API, observed advancing hardware timestamps in the rendered page, a current GPS
marker, source-reported errors and a fitting mobile layout, with no page errors.
Contact requests were intercepted; notification delivery was not tested. The
unit tests use synthetic samples to cover malformed data, missing sensors,
staleness, replay, disconnection/recovery, bounded responses and credential
isolation. No real coordinates or credentials are included in the receipts.

[INFOESP_VERIFICATION.json](INFOESP_VERIFICATION.json) records all ten rounds.
The initial type check found a nullable timestamp captured by a nested helper;
explicit narrowing corrected it. An initial one-off Node `-e` live probe lost
quotes through Windows PowerShell; passing the script over stdin corrected the
probe. The build also reported the existing `align-items: end` compatibility
warning in `hardware-status.module.css`; it completed successfully.

The source currently reports live GPS and display status, with MPU and modem
errors. This verification confirms transport and rendering, not physical MPU
operation, cellular registration or message delivery. Keep the collector, relay,
HTTPS tunnel and host running for continued hosted updates.

## Expanded road choices and via places - 2026-11-05

The app requests the public routing service's maximum three alternatives
(up to four total routes), preserves four choices after reload, and removes
duplicate geometries. Optional via search/map selection explores another
road corridor without inventing routes; Refresh routes updates saved plans.

The final build passed. All ten rounds passed `npm run typecheck`,
`node --test tests/journey.test.mjs` (30 tests), and
`node tests/route-options-browser.cjs`. Browser regression covers legacy
plans, fourth-route selection/persistence, via search and map markers,
recalculation/removal, navigation locking, and desktop/mobile layouts.
Existing journey, notification, and section-transition browser suites passed.

Real public-provider checks passed for ordinary routes and a Berlin route
through a via place (4,733.2 m road route; via-to-road gap about 2.9 m).
Provider probes confirmed its three-alternative maximum; fewer results may
be returned. These are not exhaustive road-path enumeration or hardware tests.
Receipts and the resolved initial type-check failure are recorded in
[ROUTE_OPTIONS_VERIFICATION.json](ROUTE_OPTIONS_VERIFICATION.json).

## Flowing feature panels - 2026-11-05

Extended the sage/ivory folds into dashboard cards, map headers, journey
planning and navigation, notification schedules, alert panels, and supporting
device/evidence cards. Each surface has two slow transform animations with
light/dark palettes. Decoration is inert and stays behind content; only its
own layer is clipped. Motion pauses offscreen or when the document is hidden,
and reduced motion leaves static shading.

`npm run build` passed. All ten final rounds passed `npm run typecheck`,
`node tests/motion-browser.cjs`, and `node tests/section-transitions-browser.cjs`
against the production build at http://127.0.0.1:3110. Existing notification
and journey browser suites also passed, covering controls, persistence,
map picking, route navigation, and responsive layouts with synthetic fixtures.

Desktop/mobile visual review confirmed moving folds, correct content layering,
offscreen and simulated hidden-document pausing, reduced motion, no horizontal
overflow, and no page errors. Map tiles were mocked for visual review. Exact
round receipts, screenshots, and resolved verification setup issues are in
[FEATURE_FLOW_VERIFICATION.json](FEATURE_FLOW_VERIFICATION.json). No dependencies
were added. Notification delivery and hardware readiness are outside this check.

## Soft flowing background — 2026-11-05

Added one persistent background with slow sage/ivory folds, softly shaded edges
and a static grain texture. It sits behind page content, has no pointer/focus
interaction, pauses when the document is hidden, and stops with reduced motion.
The existing route transition system keeps the background steady between pages.

`npm run build` passed. Ten final rounds each passed `npm run typecheck`,
`node tests/motion-browser.cjs` and `node tests/section-transitions-browser.cjs`
against the production build at http://127.0.0.1:3110. Desktop and mobile views
were also inspected, with live background movement and persistence checked in
Edge. No new dependencies or application data changes were needed.

Full command receipts and the two resolved local verification setup issues are
in [FLOW_BACKGROUND_VERIFICATION.json](FLOW_BACKGROUND_VERIFICATION.json).


## Contact and notification feature verification — 2026-11-05

`npm run build` passed for the final implementation. The following checks each
passed in **all ten final rounds**, with exit codes, timings and command output
recorded in [NOTIFICATION_TEST_ROUNDS.json](NOTIFICATION_TEST_ROUNDS.json):

- `npm run typecheck`
- `node --test tests/notifications.test.mjs tests/notifications-database.test.mjs tests/journey.test.mjs tests/live-telemetry.test.mjs` — 52 passing tests per round
- `node tests/notifications-browser.cjs` — fresh browser onboarding, validation,
  all intervals, profile editing, reload persistence, sync errors, roster display,
  cross-tab mode preservation, journey schedule switching, mobile and reduced motion

Additional passing checks: `node tests/journey-browser-smoke.cjs` and
`node tests/section-transitions-browser.cjs`.

Database checks execute real PostgreSQL statements in isolated local PGlite:
all intervals, no early dispatch, stable heartbeat cadence, mode reset, ownership,
RLS permissions, no duplicate claims, missed-interval skipping, stale-request
rejection, cancellation and uncertain delivery after worker interruption.
Provider tests use mocked HTTP responses and synthetic contacts only.

Two earlier failures were corrected: a PL/pgSQL alias conflict, and stale sync
status while changing modes. All ten final rounds passed after those corrections.

This is local implementation verification. The hosted Supabase migration,
Resend/Twilio delivery, minute-level cron execution and physical device behavior
remain untested here. See [NOTIFICATIONS.md](NOTIFICATIONS.md) for deployment setup.


## Five-agent animation refinement - 2026-11-05

Exactly five implementation agents refined section navigation, map motion,
journey surfaces, loading/disclosures and shared interaction details. The work
preserves the existing features and private device access. All changes are
integrated into the main source and both `smarttrackwebapp` copies.

- Shared 180/280/420 ms motion timings and a consistent easing curve align
  section switches, hover/press feedback, disclosures and small surface reveals.
- Map zoom, rotation and tilt retain their existing increments and boundaries.
  Rapid control presses accumulate against the pending camera target. Reduced
  motion applies camera changes immediately, and switching the preference stops
  a running camera/marker animation without changing accepted GPS evidence.
- Journey steps/results, dialogs, alerts, climate and connection surfaces have
  restrained depth and transitions. Closed disclosures immediately become inert;
  enhanced dialog exit transitions are limited to browsers supporting the CSS
  interactivity/overlay safeguards. Reduced-motion alternatives remain available.
- Decorative scanning pauses offscreen and when the document is hidden. The
  waiting sweep is slower; stale/error states remain still. No loading effect
  represents invented device progress.
- Main-source `npm run typecheck` and the shared copy's `npm run build` passed.
- All 101 executable regressions passed in ten integration rounds, exit 0 each.
  Seconds: 1.68, 1.57, 1.70, 1.76, 1.70, 1.75, 1.87, 1.71, 1.75, 1.76.
  Receipt: `docs/MOTION_TEST_ROUNDS.json` in each portable package (original
  receipt: `%TEMP%/smarttrack-motion-rounds.json`). The eight Node test files
  listed in the earlier public-planning record were executed in every round.
- Local `node tests/section-transitions-browser.cjs` passed all five groups:
  distinct views, menu/keyboard transitions, Back entrance, rapid navigation
  retaining the latest destination and reduced motion without browser exceptions.
- Local `node tests/motion-browser.cjs` passed offscreen animation pausing,
  immediate double toggles, hidden keyboard order, reduced motion and mobile
  overflow/runtime checks. Initial harness failures targeted a settling scanner
  and scrolled a viewport too tall to hide it. Waiting for the mounted dashboard
  and using a 700 px test viewport fixed the harness; no app change was needed.
- Initial spatial browser runs passed map/search/control/alert checks, then
  stopped on obsolete waiting-screen expectations. Live Map intentionally omits
  connection controls; its test now expects "Waiting for your GPS", no locked
  error and zero private feed calls. Other sections retain "Connect a device".
- Final `REAL_MAP_TILES=1 node tests/spatial-browser-smoke.cjs` passed all nine
  groups against the production build with actual OpenFreeMap style/vector tiles
  and synthetic telemetry. It covered cumulative zoom, immediate reduced-motion
  zoom, camera presets/reset, map recovery, four responsive widths, search and
  dialog focus, alerts, mock USB lifecycle and unchanged GPS/IMU raw evidence.
  Desktop/mobile map, dashboard and alert screenshots were visually reviewed.
- Local `node tests/journey-browser-smoke.cjs` passed all seven groups using
  synthetic route/GPS/weather/terrain fixtures: map/name selection without a
  private link, retry preserving points, route distance/ETA, journey timing and
  reload, deviation/arrival notices, climate updates, terrain recovery and
  responsive layouts with no browser exceptions. Journey/navigation screenshots
  were visually reviewed.
- `npx --yes vercel --prod --yes` published production deployment
  `dpl_71UBzoYZA1PyuPHqsBLu26Upui74`, READY at https://smarttrack-web.vercel.app.
- Hosted section-transition and motion browser suites both passed with
  `BASE_URL=https://smarttrack-web.vercel.app`. A direct anonymous `/api/live`
  request returned 401; captured device access remains private.
- Hosted `SMARTTRACK_WAITING_ONLY=1 BASE_URL=https://smarttrack-web.vercel.app
  node tests/captured-browser-smoke.cjs` passed all fourteen public pages with
  clean waiting/empty states, zero private feed calls and no serial port opened.
- Release packaging checks source equality across both copies, regenerates the
  manifests and verifies every archive entry. The friend-account download is
  compared with both local archive hashes; its host-side receipt is
  `%LOCALAPPDATA%/OmnirushShare/smarttrack-motion-download-verification.json`.

Browser telemetry, serial and journey fixtures are synthetic. These checks do
not establish physical-device performance or cloud ML/database integration.
Dependency versions remain unchanged; existing advisories are recorded in the
portable package's `docs/DEPENDENCY_NOTES.md`.

## Clean device connection state and portable copies — 2026-11-05

The user selected the private-data option: remove the repeated private-link
prompt from Trust & Safety, Alerts, Activity Log and Analytics while keeping
captured GPS/sensor access private. A missing viewer connection is now a normal
empty state with a "Connect a device" badge and no error banner. A rejected saved
connection is explained inside Connection options. Actual network and USB errors
remain visible. No device API authorization was removed, no credentials were
embedded, and unavailable readings remain empty.

The change is in the main source and both independent `smarttrackwebapp` copies:
`C:/Users/muppa/smarttrackwebapp` and
`C:/Users/muppa/omnirush.ai/smarttrackwebapp`. The latter is inside the existing
authenticated File Browser root. New setup guides cover the current features,
own-account Vercel deployment, optional services and browser/relay device setup.
Generated artifacts, installed dependencies, captures, real environment files and
owner account/project bindings are excluded from the portable archives.

- Fresh dependency installation succeeded in both copies. The shared copy's
  `npm run build` passed compilation, type checking and route generation.
- All 101 executable regressions passed in ten final integration rounds, exit 0
  each. Seconds: 1.98, 2.03, 1.77, 1.89, 2.01, 2.06, 1.74, 1.83, 1.73, 1.72.
  Receipt: `%TEMP%/smarttrackwebapp-package-rounds.json`.
- The browser suite now verifies that every unconnected page shows no repeated
  private-link error and makes zero private feed requests.
- File Browser `friend` permissions and owner-created account defaults include
  create, modify, rename, delete, download and execution. Real API checks created,
  read, modified, renamed and deleted a uniquely named test file in the new
  project. Browser Node execution and project working directory were verified,
  including a fresh independent browser session. No physical second device was
  used. Receipt: `%LOCALAPPDATA%/OmnirushShare/smarttrackwebapp-verification.json`.
- An initial browser permission harness navigated away too early after login;
  normal folder navigation fixed the harness, and the complete check passed.
- The copies retain the original dependency versions. `npm audit` reports two
  critical and two high affected packages; package `docs/DEPENDENCY_NOTES.md`
  records them. A passing build is not a clean dependency security audit.
- Final `BASE_URL=http://127.0.0.1:3104 node tests/captured-browser-smoke.cjs`
  passed all seven groups across all fourteen public/authenticated pages using
  synthetic API fixtures. Current/captured readings, navigation and outage
  history behavior remain intact, with no real serial connection opened.
- `npx --yes vercel --prod --yes` published
  `dpl_8BtMGYs8LYBhMZPW4X56Syq5v7Dh`, READY at https://smarttrack-web.vercel.app.
- Hosted `SMARTTRACK_WAITING_ONLY=1 BASE_URL=https://smarttrack-web.vercel.app
  node tests/captured-browser-smoke.cjs` passed all fourteen unconnected pages:
  no repeated private-link prompt, no fabricated locations, no private feed
  requests and no browser exceptions.
- Hosted `node tests/public-planning-smoke.cjs` with that production `BASE_URL`
  passed real anonymous place/road lookup and foreign-origin rejection; the
  private device feed returned 401. Public planning and private telemetry remain
  separate as requested.

## Public route planning access fix — 2026-11-05

The planner incorrectly required the private device viewer credential for Photon
place search and OSRM road lookups. Opening the ordinary website therefore
returned 401 after selecting two points. These two stateless public map lookups
now accept visitors without a private device link. They access only the supplied
query/points and fixed public providers; live/captured device data and persisted
production APIs retain their authentication. The contract documents this scope.

- The browser no longer reads or attaches the device viewer credential to map
  planning requests. Input, response-size and timeout checks remain; foreign
  browser origins are rejected and responses remain private/no-store.
- A Retry routes button reuses the selected points after a provider failure.
  The old instruction to select a point again was removed.
- A real local API check caught Next's internal hostname normalization causing
  an incorrect 403 for `127.0.0.1`. The origin check now uses the incoming Host;
  a regression covers both that case and an actual foreign origin.
- `node tests/journey-browser-smoke.cjs` passed all seven groups with synthetic
  provider/GPS/terrain fixtures. It now starts with no private link, tests name
  and map planning, a failed route request and retry preserving both points, then
  connects a synthetic private feed to verify timing, reload, arrival, deviations
  and responsive layouts. No browser JavaScript errors were recorded.
- After the hostname fix, the integrated executable suite passed 101 tests in
  each of ten rounds, all exit 0. Receipt:
  `%TEMP%/smarttrack-public-planning-rounds.json`.

  | Round | Tests passed | Seconds |
  | ---: | ---: | ---: |
  | 1 | 101 | 3.78 |
  | 2 | 101 | 3.72 |
  | 3 | 101 | 3.96 |
  | 4 | 101 | 3.85 |
  | 5 | 101 | 3.96 |
  | 6 | 101 | 3.88 |
  | 7 | 101 | 3.90 |
  | 8 | 101 | 3.80 |
  | 9 | 101 | 4.01 |
  | 10 | 101 | 4.14 |

```text
node --test tests/live-telemetry.test.mjs tests/live-relay.test.mjs tests/captured-feed.test.mjs tests/review-resume.test.mjs tests/signal-stabilization.test.mjs tests/climate.test.mjs tests/journey.test.mjs tests/heading.test.mjs
```

These repeated regressions and browser fixtures do not establish physical device
journey behavior or cloud database/ML integration.

- Final `npm run build` passed compilation, type checking and all route generation.
- Final local `node tests/public-planning-smoke.cjs` passed against real Photon
  and OSRM: five places, one route, no credentials. The local private feed failed
  closed with 503 because it was not configured.
- `node tests/public-planning-browser.cjs` passed locally in a fresh browser with
  real public place and route APIs: name selection, road choices with km/ETA,
  explicit selection and navigation waiting for fresh GPS. Only the map style
  was a fixture; the planning APIs were not intercepted.
- `npx --yes vercel --prod --yes` published deployment
  `dpl_FQULXZWm2d7WWPLdQk9K5dr1chAs`, READY at https://smarttrack-web.vercel.app.
- `BASE_URL=https://smarttrack-web.vercel.app node tests/public-planning-smoke.cjs`
  passed all four hosted checks. Anonymous search returned five real places,
  routing returned one real road route, foreign browser origins returned 403,
  and the private device feed still returned 401. No private feed body was read.
- `BASE_URL=https://smarttrack-web.vercel.app node tests/public-planning-browser.cjs`
  passed all four groups on production with no device token and no browser
  JavaScript errors. This directly covers the reported ordinary-link failure
  using real backend/provider requests. The local preview was stopped.

## Distinct tracking sections and transitions — 2026-11-05

- Live Map now contains its heading and tracking map, without the duplicated
  planner, navigation metrics, climate, score or connection panels. The marker
  is a map-aligned triangle when fresh GPS reports a valid travel course at
  speed >= 0.5 m/s; otherwise a neutral position marker avoids inventing heading.
- Journey owns start/destination selection by online place name or map. Photon /
  OpenStreetMap suggestions appear after a 500 ms typing pause (three characters
  minimum). Both places must be selected before route options appear; the user
  chooses a route with distance and estimated driving time before navigating.
- Navigation owns the chosen route, elapsed time, monitoring state, start/finish
  actions and notification settings. It shows a planning link until a route is
  selected. Selected place names and the existing plan survive section changes
  and reload. The shared journey engine, GPS freshness and alert rules remain.
- Soft mint, pine and lavender surfaces distinguish the three views. Raised
  planning steps and controls provide depth. Persistent section transitions cover
  links, keyboard search and programmatic Start journey navigation, with an
  entrance animation for browser Back/Forward and reduced-motion support.
- Cancelling a native View Transition rejects its `ready` promise. A rapid-switch
  browser test exposed an unhandled rejection; all transition promises are now
  handled, and the final focused browser run reports no runtime errors.

Validation:

- Final `npm run build` and `npm run typecheck` passed, including the transition
  cancellation fix. No dependencies were added.
- The integrated executable regression suite passed 98 tests in every one of
  ten rounds, including five new heading tests. Every round exited 0:

  | Round | Tests passed | Seconds |
  | ---: | ---: | ---: |
  | 1 | 98 | 2.10 |
  | 2 | 98 | 1.93 |
  | 3 | 98 | 1.93 |
  | 4 | 98 | 2.75 |
  | 5 | 98 | 2.95 |
  | 6 | 98 | 2.87 |
  | 7 | 98 | 2.82 |
  | 8 | 98 | 2.79 |
  | 9 | 98 | 3.32 |
  | 10 | 98 | 3.39 |

  Local receipt: `%TEMP%/smarttrack-distinct-sections-rounds.json`. These are
  executable local regressions, not ten hardware or end-to-end runs.
- Final `node tests/section-transitions-browser.cjs`: all five groups passed on
  the production preview, including menu/keyboard switching, Back entrance,
  rapid switches retaining the last destination, and reduced motion.
- Final `node tests/journey-browser-smoke.cjs`: all seven groups passed on the
  production preview. Covers the three distinct views, automatic name suggestions,
  map selection before GPS, alternatives, route selection, navigation, fresh GPS
  heading, timer/reload, alerts, climate failures and terrain retry. Browser API
  and DEM responses use synthetic fixtures; no physical journey is claimed.
- `REAL_MAP_TILES=1 node tests/spatial-browser-smoke.cjs`: all nine groups passed
  with real OpenFreeMap streets/buildings and synthetic telemetry, including map
  dimensions, camera controls, responsive widths, stabilization, historical states
  and mocked USB. Map implementation is unchanged since this passing run.
- `BASE_URL=http://127.0.0.1:3104 node tests/captured-browser-smoke.cjs`: all seven
  groups passed across fourteen pages. Connection assertions now use the top bar
  on the focused views; detailed connection and evidence controls remain elsewhere.
- Real map and responsive Journey/Navigation screenshots were inspected. The
  final journey screenshots are in `%TEMP%/smarttrack-journey-ui-C6fqbh`.

```text
node --test tests/live-telemetry.test.mjs tests/live-relay.test.mjs tests/captured-feed.test.mjs tests/review-resume.test.mjs tests/signal-stabilization.test.mjs tests/climate.test.mjs tests/journey.test.mjs tests/heading.test.mjs
```

The existing authenticated Photon and OSRM backend was not changed. External
provider availability, real device journeys and cloud database/ML remain separate
from synthetic browser validation.

Production publication:

- `npx --yes vercel --prod --yes`: deployment
  `dpl_HCnWAHSFeH15suWcBh2dfkmc8rT4` reached READY and was aliased to
  https://smarttrack-web.vercel.app.
- Hosted `/map`, `/journeys` and `/navigation` each returned HTTP 200.
- `BASE_URL=https://smarttrack-web.vercel.app node tests/section-transitions-browser.cjs`:
  all five groups passed on production, including rapid-switch cancellation and
  reduced motion, with no browser JavaScript errors.
- `BASE_URL=https://smarttrack-web.vercel.app node tests/journey-browser-smoke.cjs`:
  all seven groups passed on production with synthetic telemetry, route, climate
  and DEM fixtures. This includes automatic suggestions, explicit route choice,
  navigation/timing, heading, reload, alerts and responsive layouts, with no
  browser JavaScript errors. Hosted screenshots are in
  `%TEMP%/smarttrack-journey-ui-OSWj0Q`. The local preview was stopped after checks.

## Journey, climate and dimensional map update — 2026-11-05

Implemented with the existing three specialists and root integration. The
fourteen application sections and captured/live telemetry behavior remain.

- The pine/mint interface now uses raised controls, an abstract receiver
  instrument, compact signal cards, progressive disclosures and reduced-motion
  alternatives. MapLibre/OpenFreeMap supports smooth camera controls, route
  framing, tilt/rotation and optional Mapzen Terrarium ground elevation.
- GPS display stabilization uses a 3 m anchored deadband; MPU display thresholds
  are 64 acceleration counts and 12 gyro counts. Original registers, GPS
  receipts, scores and alerts are preserved. Source/reboot/gap changes reset
  the display baseline. Raw mode remains available.
- Nearby climate uses fresh raw GPS with Open-Meteo, refreshing after 1 km or
  five minutes. Missing, old and superseded readings remain explicitly
  unavailable/historical. Device temperature remains raw counts until sensor
  calibration is confirmed; outdoor model temperature is separate.
- Map, Journeys and Navigation support point picking and explicit place-name
  search. Authenticated server endpoints query Photon and OSRM for real driving
  routes, returning at most three usable alternatives with kilometres and
  estimated time. Selection is explicit. Provider road snapping is disclosed;
  routes farther than 500 m from a requested endpoint are rejected. Estimates
  exclude live traffic. No invented alternatives or straight-line fallback.
- The timer starts when fresh device GPS enters the selected start's 30 m
  area. Arrival requires two distinct fresh observations in the destination's
  30 m area. Deviation requires three observations spanning at least three
  seconds beyond 60 m of the selected geometry, with 40 m recovery hysteresis.
  Raw GPS drives these checks. GPS outages suspend checks while time continues.
  Validated plan/timing state survives reload in sessionStorage. Browser
  notifications require a user click; in-page notices work without permission.
  Journey monitoring is local to the open browser tab, not a cloud background job.

Validation and issues found during integration:

- Production build and TypeScript check passed after integration.
- Focused decoder/feed/relay/stabilization/climate/journey suite: 93 tests per
  round, repeated ten times after final integration. All rounds exited 0:

  | Round | Tests passed | Seconds |
  | ---: | ---: | ---: |
  | 1 | 93 | 8.80 |
  | 2 | 93 | 6.54 |
  | 3 | 93 | 10.74 |
  | 4 | 93 | 14.13 |
  | 5 | 93 | 13.68 |
  | 6 | 93 | 12.36 |
  | 7 | 93 | 10.84 |
  | 8 | 93 | 11.16 |
  | 9 | 93 | 9.09 |
  | 10 | 93 | 8.46 |

  These are executable local regressions, not ten hardware or end-to-end runs.
- New journey browser flow passed point selection before GPS, authenticated
  name search, alternatives, explicit selection, armed/active timing, reload,
  deviation, weather failure, GPS loss, arrival and optional terrain retry.
  Telemetry, roads, weather and DEMs in this suite are synthetic fixtures.
- Independent review found stale distance after GPS loss, malformed provider
  geometry and stationary routes. Executable regressions pass after fixes.
- Browser testing found elevation tiles were being checked against the wrong
  MapLibre event. Terrain readiness now requires an actual loaded DEM tile.
- Screenshot review found MapLibre's stylesheet could override the absolute
  map container, producing zero height. The frame selector now outranks that
  rule, and browser tests assert the container fills its visible frame.
- Test synchronization fixes wait for disclosure visibility and a fresh weather
  reading after reload before simulating subsequent movement. These do not
  relax application freshness checks.
- Live Photon and Open-Meteo requests using public synthetic Berlin coordinates
  returned HTTP 200. Open-Meteo units matched the parser. OSRM routing and AWS
  terrain tiles were reachable, with the required terrain CORS response.
- Final local `REAL_MAP_TILES=1 node tests/spatial-browser-smoke.cjs`: nine
  groups passed, including real OpenFreeMap styles/tiles, nonzero map container
  dimensions, display stabilization, camera controls, keyboard access, waiting,
  retry, historical states and mocked USB (no serial writes).
- Final local `node tests/journey-browser-smoke.cjs`: seven groups passed,
  including actual map clicks and keyboard map-center selection, route framing,
  name search, kilometre/ETA cards, timer/reload, climate and DEM failure/retry.
- Final local `BASE_URL=http://127.0.0.1:3104 node tests/captured-browser-smoke.cjs`:
  seven groups passed across all fourteen application routes. An earlier launch
  used this harness's default port 3100 and failed to connect; the explicit
  preview origin corrected the invocation.
- Desktop real-map and journey screenshots and mobile planner/climate views
  were inspected. A fresh mobile viewport confirmed the climate card renders;
  the software-rendered full-page capture immediately after repeated viewport
  resizing had omitted some compositor layers.

```text
node --test tests/live-telemetry.test.mjs tests/live-relay.test.mjs tests/captured-feed.test.mjs tests/review-resume.test.mjs tests/signal-stabilization.test.mjs tests/climate.test.mjs tests/journey.test.mjs
```

Physical device journeys, calibrated MPU temperature, SOS delivery, and cloud
database/ML behavior are outside these synthetic browser and provider checks.

Production publication:

- `npx --yes vercel --prod --yes`: deployment
  `dpl_FMjFFQaEnnLy2rxbzAmZtG9Nd2Pi` reached READY and was aliased to
  https://smarttrack-web.vercel.app.
- Hosted `/map` returned HTTP 200. Anonymous place and route requests returned
  401. The existing private viewer credential authenticated both new APIs; its
  value was not printed or written into test artifacts.
- Live hosted Photon search returned five places. Live hosted OSRM routing
  returned two real alternatives for synthetic public Berlin endpoints:
  1.9375 km / 3.71 min (106 vertices), and 3.3527 km / 7.8767 min (294 vertices).
  The response explicitly states `traffic: false`.
- `BASE_URL=https://smarttrack-web.vercel.app node tests/journey-browser-smoke.cjs`:
  all seven journey/climate/terrain interaction groups passed on the deployed
  app with synthetic API/DEM fixtures and no page JavaScript errors. The live
  backend/provider smoke above separately validates real routing and search.
- `BASE_URL=https://smarttrack-web.vercel.app node tests/captured-browser-smoke.cjs`:
  all seven captured-feed lifecycle groups passed across fourteen hosted pages,
  using authenticated/unauthenticated synthetic fixtures. The temporary local
  production preview was stopped after verification; the Vercel app remains live.

## Spatial tracking interface - 2026-11-04

Implemented with three UI specialists and root integration (four agents total).
The existing fourteen sections, telemetry semantics, authenticated feed, and
USB reader remain. The interface now has a pine/mint layered theme, section
search, animated disclosures, radar waiting states, a categorized quality-note
inbox, and an OpenFreeMap perspective map with real provider building heights.
Details are collapsed by default; current/historical/unavailable status remains
visible. No firmware, database, model, credentials, or feed contracts changed.

Validation against the integrated production build:

- `npm run build`: pass. Rebuilt after the final shell/contrast corrections.
- `npm run typecheck`: pass.
- `node --test tests/live-telemetry.test.mjs tests/live-relay.test.mjs tests/captured-feed.test.mjs tests/review-resume.test.mjs`:
  34/34 pass with exit code 0 in each final local round, 1 through 10.
  These are synthetic decoder/feed/relay regressions, not hardware trials.
- `BASE_URL=http://127.0.0.1:3104 node tests/captured-browser-smoke.cjs`:
  seven checks pass across all fourteen authenticated/unauthenticated routes,
  including current-to-historical aging, reload/cache, mobile layout, and no
  automatic serial chooser. This uses synthetic feed and map fixtures.
- `BASE_URL=http://127.0.0.1:3104 REAL_MAP_TILES=1 node tests/spatial-browser-smoke.cjs`:
  seven interaction groups pass: collapsed details/inert hidden controls;
  search/keyboard/focus; map 2D/3D, follow and responsive widths; alert filtering
  and historical evidence; reduced motion/mobile navigation; no-data waiting
  and map retry; and mocked USB connection/navigation/disconnection without
  serial writes. Actual OpenFreeMap style/vector tiles loaded. Telemetry is
  explicitly synthetic, including the public-city map fixture.
- Desktop, mobile, alert, and no-sensor screenshots were inspected. Artifacts
  remain in an OS temporary directory; no private captures were opened.
- Browser testing caught Escape being consumed by Edge's nonempty search
  field. Explicit dialog Escape handling and focus restoration fixed it.
  Independent review found low-contrast secondary text, which was darkened.
- Two test-harness issues were corrected: missing trajectory `recordedAt`
  fields in the new fixture and a zero-only duration assertion that rejected
  the existing 0.01 ms reduced-motion fallback. Neither required weakening
  application validation or freshness rules.

Production publication and verification:

- `npx --yes vercel --prod --yes`: pass. Deployment
  `dpl_Gsc5WDA3xWMnWcBKNjJ8iqWrvoAy` is READY and aliased to
  https://smarttrack-web.vercel.app.
- Anonymous `/`, `/map`, and `/alerts` return HTTP 200; `/api/live` returns 401.
- `BASE_URL=https://smarttrack-web.vercel.app node tests/captured-browser-smoke.cjs`:
  all seven captured-lifecycle groups pass across fourteen routes.
- `BASE_URL=https://smarttrack-web.vercel.app REAL_MAP_TILES=1 node tests/spatial-browser-smoke.cjs`:
  all seven interaction groups pass on the deployed app with actual OpenFreeMap
  style/vector tiles and synthetic telemetry. The USB fixture now sends a fresh
  sample after hosted navigation: its initial one-shot sample correctly became
  stale when navigation took longer than the five-second stream window.

These checks establish UI behavior and map-provider integration. They do not
establish current physical-device connectivity, physical display operation,
SOS delivery, or production database/ML behavior.

## Resumed captured-feed checks — 2026-11-04

- All fourteen application routes already use captured/live components rather
  than the legacy fixtures. Corrected waiting-state and disconnected-USB text,
  per-sensor historical labels, and score receipt timestamps in the local UI.
- The shared feed validator now rejects invalid receipt dates and incomplete
  coordinate pairs. Saved captures use the same snapshot validation as the API.
  Independently future GPS/IMU receipts clear current claims and the live score.
- `node --test tests/review-resume.test.mjs` initially failed four regression
  checks reported by the reviewer. After integration,
  `node --test tests/live-telemetry.test.mjs tests/live-relay.test.mjs tests/captured-feed.test.mjs tests/review-resume.test.mjs`
  completed with exit code 0 in each required local round, 1 through 10. These
  use synthetic observations, temporary files, and a loopback HTTP listener.
- `npm run build` and `npm run typecheck`: pass.
- `BASE_URL=http://127.0.0.1:3102 SMARTTRACK_BROWSER_CHANNEL=msedge node tests/captured-browser-smoke.cjs`:
  seven browser checks pass across fourteen authenticated and unauthenticated
  routes. Checks cover absent demo identities, automatic authenticated polling,
  stale/disconnected capture handling, reload, navigation, and mobile layout.
  These are synthetic API fixtures; no physical serial port is opened.
- Existing hosted `/` and `/display` return HTTP 200 with captured-device UI;
  anonymous `/api/live` returns 401. An authorized feed request returns 503
  because its configured device computer is unreachable. The local corrections
  above have not been redeployed while the requested server connection is pending.
- The requested Omnirush server at `192.168.1.34` answers ping but refuses TCP
  port 3000. Its updated display module and connected device are not yet tested.

## Live USB integration — 2026-11-04

- `npm run build` and `npm run typecheck`: pass after connecting the persistent
  browser USB provider, live map, and heuristic Trust Score views.
- `node --test tests/live-telemetry.test.mjs`: 16/16 pass in each of ten local
  rounds. These rounds repeat synthetic parser tests; they are not repeated
  physical-device or hosted integration trials.
- Actual COM14 capture through the decoder: valid GPS coordinates, nine
  satellites, HDOP 1.11, active raw IMU stream, heuristic score 93/100, zero
  checksum/invalid-line errors. Expired data yields a null score. Actual
  coordinates remain outside project files.
- `SMARTTRACK_BROWSER_CHANNEL=msedge node tests/live-browser-smoke.cjs`:
  eight browser checks pass against the production build using synthetic
  serial input and a stub map style. Covers connection, marker/score updates,
  navigation persistence, mobile overflow, stale/no-fix handling, and
  disconnect without serial writes. No browser console/page errors observed.
- OpenFreeMap style endpoint: HTTP 200 with browser request headers.
- Production deployment `dpl_FErFUpeYyUb3qXiAH7X6Nqp1bm2w`: READY and aliased
  to https://smarttrack-web.vercel.app. Dashboard/map/insights return HTTP 200;
  unconfigured devices API still returns HTTP 503. Hosted browser smoke passes
  eight checks; a second run with real OpenFreeMap passes nine checks,
  including seven successful vector-tile responses and marker rendering.
  Both runs use synthetic serial input and have no console/page errors.

See [LIVE_USB.md](LIVE_USB.md) for setup and scope. The older record below
describes the earlier build; its statement that no hardware was available
does not describe this later receive-only COM14 check.

Date: 2026-10-12 (workspace timezone context)

## Ten final local rounds

Each round ran the same command group from the repository root:

```text
npm run build
npm run typecheck
python -B -m unittest discover -s ml/tests -p "test_*.py"
node --test tests/review-C04.test.mjs tests/review-C05.test.mjs tests/review-R07.test.mjs tests/review-R21.test.mjs tests/review-R23.test.mjs
```

| Round | build | typecheck | Python feature tests | contract checks |
|---:|---|---|---|---|
| 1 | pass | pass | pass (21) | pass (23) |
| 2 | pass | pass | pass (21) | pass (23) |
| 3 | pass | pass | pass (21) | pass (23) |
| 4 | pass | pass | pass (21) | pass (23) |
| 5 | pass | pass | pass (21) | pass (23) |
| 6 | pass | pass | pass (21) | pass (23) |
| 7 | pass | pass | pass (21) | pass (23) |
| 8 | pass | pass | pass (21) | pass (23) |
| 9 | pass | pass | pass (21) | pass (23) |
| 10 | pass | pass | pass (21) | pass (23) |

These are local build, type, Python feature, and source-contract checks. They
are not ten real-device runs, ten hosted database runs, or ten end-to-end
browser/SOS delivery tests.

## Additional evidence

- `npm run build` produced routes for the dashboard, all workstream sections,
  login, ingest/SOS, operations reads, and SOS transitions.
- `python -B -m unittest discover -s ml/tests -p "test_*.py"` passed 21
  dependency-free feature tests covering units, chronology, stale data,
  missing sensors, overflow, and privacy of derived features.
- C04 firmware interface review passed 10 source-contract checks. A C++ or
  PlatformIO compiler was not installed in this workspace, so firmware compile
  and hardware behavior remain release gates.
- C05 deployment-input review passed 10 presence checks after the operator
  documentation was added. It does not prove credentials, a Vercel deploy,
  Supabase RLS behavior, or ML artifact readiness.

## Explicitly blocked release gates

1. No ESP32-S3, GPS, MPU-9250, TFT/touch, SD card, qualified A7670C power
   supply, antenna, or SIM was available. Wiring, cellular delivery, GPS fix,
   power-inrush, display rendering, and button behavior are untested.
2. No Supabase project or disposable two-tenant database was available. SQL
   execution, RLS isolation, device provisioning, rate limiting, and SOS
   transaction behavior require a hosted test environment.
3. No consented real journey dataset or promoted real ML artifact exists.
   Synthetic fixtures pass feature tests only; production Trust Score remains
   unavailable until evaluated and promoted by an operator.
4. No external map/routing/push/SMS providers or credentials were configured.
   The UI labels those capabilities as unavailable/demo rather than claiming
   delivery.
