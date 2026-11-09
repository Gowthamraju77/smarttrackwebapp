# SmartTrack: what I understand about your project

Review date: 4 November 2026.
Workspace: C:\Users\muppa\omnirush.ai
Application: C:\Users\muppa\omnirush.ai\my projectt

This report describes the local source, documentation, and recorded verification
results. It separates implemented code, previously observed behavior, and work
that remains unfinished. This review did not run new hardware tests, deploy the
application, flash firmware, or change application code.

## 1. Your project's purpose

Your project is named SmartTrack. It combines an ESP32-S3 tracking device with a
web application to show position, movement, sensor condition, and emergency
status. The intended complete system includes:

- GPS location and a history of movement.
- IMU motion measurements alongside GPS observations.
- A physical TFT display on the device.
- An SOS button that can latch an emergency even without GPS or ML.
- Offline recording and later transmission when connectivity returns.
- A browser dashboard for viewing the device and its captured observations.
- Organization accounts, access roles, durable records, and audited SOS actions.
- A separate Python package for estimating telemetry reliability using ML.

The strongest demonstrated integration is currently the diagnostic device data
feeding the browser dashboard. The standalone firmware, physical display,
durable cloud workflow, and ML service are at different stages of completion.
The existence of a page, schema, or interface does not establish that its full
device-to-cloud behavior works.

## 2. How the pieces fit together

There are three relevant data paths:

```text
CURRENT DIRECT USB PATH
ESP32 diagnostic serial
  -> browser Web Serial
  -> TypeScript telemetry decoder
  -> persistent React provider
  -> dashboard / map / captured sensor views

CURRENT RELAY PATH
ESP32 diagnostic serial
  -> PowerShell serial reader
  -> Node relay and saved capture
  -> configured authenticated HTTPS upstream
  -> Next.js /api/live
  -> browser polling and the same captured sensor views

INTENDED DURABLE DEVICE PATH, PARTLY IMPLEMENTED
ESP32 sensors + SOS button
  -> identified records + offline queue
  -> TLS transport
  -> /api/ingest or /api/sos
  -> Supabase transactional storage
  -> authenticated operations and response workflow

SEPARATE ML PATH
current + previous telemetry record
  -> feature extraction
  -> trained and calibrated anomaly models
  -> reliability index
  -> future application integration
```

The current relay feed is separate from durable database ingestion. A visible
capture in the dashboard does not establish that a telemetry row was stored in
Supabase. The web score is also separate from the Python ML output.

## 3. Workspace structure

| Path | What it contains |
| --- | --- |
| my projectt/app | Next.js pages, layouts, global styles, and API routes |
| my projectt/components | Application shell, captured/live views, login, and older workstream components |
| my projectt/lib/live | Telemetry decoder and captured-feed validation |
| my projectt/lib/client | API client and device data helper |
| my projectt/lib/server | Authentication, Supabase requests, ingestion, and operations |
| my projectt/scripts | Serial reader startup and Node relay |
| my projectt/firmware | ESP32 application, sensor/queue/transport code, display headers, diagnostic sketches |
| my projectt/database | Supabase SQL schema and setup notes |
| my projectt/ml | Python feature extraction, models, scoring, training, HTTP service, and tests |
| my projectt/tests | Decoder, relay, browser, and source-contract checks |
| my projectt/docs | Integration contracts, setup, verification, reviews, and hardware recovery notes |
| connectionss | Wiring Markdown, seven-page PDF, PDF generator, and connection verification report |
| .opencode | Development history and attached reference sketches |
| .omnirush | Development/workflow materials; not required by the app at runtime |

An earlier inventory counted about 195 source/documentation/test files and
30,421 lines, excluding dependencies, generated builds, private runtime data,
and caches. This is a size estimate, not a percentage of verified functionality.
No Git metadata was found at the workspace or application root, so the local
tree alone does not provide a complete commit history.

## 4. Application stack and entry points

- Next.js 15.5.27 and React 19.
- TypeScript; the installed version observed in this workspace was 5.9.3.
- MapLibre GL 5.24.0 for maps, using OpenFreeMap map resources.
- CSS modules/global styles and lucide-react icons.
- Supabase Postgres/Auth for the intended durable backend.
- Python with optional NumPy, scikit-learn, FastAPI, and Uvicorn for ML.
- PlatformIO with the Arduino framework for ESP32-S3 firmware.

`app/layout.tsx` places `LiveTelemetryProvider` above navigation, allowing the
sensor connection and captured state to survive route changes. `app/page.tsx`
and `app/[section]/page.tsx` enter the application shell and selected view.
Unrecognized section names currently fall back to the dashboard selection.
`/login` is a separate Supabase sign-in page.

Available npm commands, from `my projectt`, are `npm run dev`, `npm run build`,
`npm run start`, and `npm run typecheck`. They are listed here as reference;
this documentation review did not execute them again.

## 5. What each web section currently means

| Route | Current behavior and limits |
| --- | --- |
| / | Captured/live GPS, raw motion, connection state, and explained quality estimate |
| /map | Observed position and captured trail on a MapLibre map |
| /journeys | Captured position history; durable automatic journey formation is not established |
| /navigation | Position/trail context; road directions are unavailable |
| /activity | Observation history; no real administrative audit stream is supplied to this view |
| /insights | Explanation and evidence for the current sensor-quality heuristic |
| /analytics | Counts, quality, and motion derived from observed data |
| /alerts | Decoder/quality reasons; no real SOS history is supplied to this view |
| /devices | Details supported by the observed device feed |
| /display | Browser sensor readout; no physical TFT control connection is implemented here |
| /team | No verified membership dataset; provides sign-in context |
| /security | Data provenance and limitations of the available evidence |
| /settings | Units, source, and timestamp conventions |
| /help | Explanations of captured data, USB connection, score, and display behavior |
| /login | Supabase email/password sign-in code, subject to configuration and integration gaps below |

The fourteen workspace views currently use captured/live components or explicit
unavailable states. Older synthetic workstream components remain in the source,
but they are not the views routed into this workspace. The provider exposes a
fixed live mode rather than a working synthetic/live switch.

The top-level README still describes startup in synthetic demo mode. That
description is stale relative to the current route wiring.

## 6. Live sensor decoding and data freshness

Key files:
`lib/live/telemetry.ts`, `lib/live/feed.ts`,
`components/live/live-telemetry-provider.tsx`,
`components/live/live-workspace.tsx`, `components/live/live-map.tsx`, and
`components/live/real-device-section.tsx`.

The direct connection uses Web Serial in compatible Chrome/Edge browsers, with
a secure browser context and a user-selected device. Serial runs at 115200 baud;
the configured Espressif USB filter is vendor/product 0x303a/0x1001.

The decoder understands:

- NMEA RMC and GGA GPS sentences with valid checksums.
- `MPU_SAMPLE` JSON records containing raw motion measurements.
- `DISPLAY_VALUES` diagnostic messages.

A GPS position must come from usable positioned GPS evidence. A diagnostic
message saying a fix exists cannot invent coordinates. The decoder checks
malformed values, checksums, observation order, repeated counters/restarts, and
implausible position jumps. The jump rule considers movement over both 100 m
and 100 m/s; it is a quality check, not certified spoof detection.

Freshness rules are explicit:

- Serial stream and IMU readings expire after 5 seconds.
- GPS observations expire after 10 seconds.
- Both timestamps and receipt times matter; future/conflicting timestamps
  cannot justify a current score.
- Historical observations can remain visible with historical labels.
- A retained capture is not silently treated as new data after reload.
- The visible trail is bounded to 240 points.

The UI receives USB updates at roughly 250 ms intervals. Relay polling and
aging run about once per second. Raw accelerometer, gyroscope, and temperature
counts are displayed as raw measurements; they are not automatically calibrated
physical units or a fused navigation solution.

## 7. Captured relay implementation

`scripts/start-live-relay.ps1` handles the Windows serial reader.
`scripts/live-relay.cjs` maintains and serves the decoded capture.
`app/api/live/route.ts` provides the web application's authenticated feed.

The local relay normally uses loopback port 4317 and the previously used serial
port was COM14. It retries a lost serial connection after about two seconds and
periodically saves the latest valid capture to ignored `.local/live-capture.json`.
That saved capture provides historical continuity, not guaranteed durable
telemetry storage.

Browser viewer authentication and upstream relay authentication use separate
secrets. A viewer token supplied through a `#feed=...` URL fragment is consumed
and removed from the address bar; scoped browser session storage retains the
viewer token and captured evidence. No token values are included in this report.

The Next.js feed route validates bounded upstream data, rejects redirects, and
uses no-store behavior. The browser request timeout is 12 seconds and the
upstream timeout is 7 seconds. The feed depends on the device computer and its
configured upstream being reachable.

## 8. The current web score and the separate ML score

### Current dashboard: explained heuristic, 0-100

| Factor | Nominal weight | What it represents |
| --- | --- | --- |
| Position freshness | 25% | Age of usable GPS evidence |
| GPS precision | 25% | HDOP-based factor, not measured position error |
| Satellites used | 15% | Satellite count contribution |
| IMU stream | 15% | Availability of recent complete raw motion data |
| Serial integrity | 10% | Valid messages among recently checked sensor messages |
| Observation order | 10% | Recent chronology/counter/jump checks |

Unavailable factors can be omitted and the remaining weights normalized. A
current score requires a live stream and fresh usable GPS. Historical scores
retain their receipt timestamps. This is a sensor-quality estimate, not output
from a trained model, a safety probability, or certified GPS accuracy.

### Python package: intended learned reliability index, 0-1

The package contains `features.py`, `model.py`, `scoring.py`, `train.py`,
`synthetic.py`, and `service.py`. Its input is a current wire-v1 telemetry record
and, when available, a previous record.

The fourteen feature names are:

```text
gps_speed_mps              gps_hdop
gps_age_s                  imu_accel_mps2
imu_gyro_rad_s             delta_s
distance_m                 implied_speed_mps
speed_delta_mps            gps_accel_mps2
gps_speed_residual_mps     imu_accel_delta_mps2
imu_gyro_delta_rad_s       gps_imu_accel_excess_mps2
```

Feature extraction uses the necessary location/time context but excludes raw
coordinates, device identity, and absolute timestamps from the model vector.
Within one boot, monotonic uptime determines elapsed time; comparisons across
boots require usable UTC chronology.

The package handles missing/invalid sensors, invalid chronology, GPS age over
10 seconds, and observation-pair gaps over 60 seconds. Delivery older than
30 seconds is downweighted and over 300 seconds is unavailable for scoring.
Dependency-free feature extraction can be tested without installing the full
ML service stack.

Training uses a StandardScaler fitted on the training partition, One-Class SVM
with nu=0.05 and gamma="scale", and an Isolation Forest with 100 estimators.
Calibration is held out by group, with a default 25% calibration split. An
empirical detector percentile contributes to the final reliability index:
model 30%, GPS 30%, IMU 20%, chronology 15%, and delivery 5%.

Production loading requires a trusted artifact pinned by SHA-256, with explicit
evaluation, promotion, and real-data provenance. Synthetic artifacts cannot be
promoted into production scoring. The service has an authenticated `/score`
endpoint with a 64 KiB request limit and a `/health` endpoint.

No production model artifact was found under `ml`, and no call into this Python
service was found in `app`, `lib`, or `components`. Thus the web score and Python
score are currently different implementations, with different scales and no
completed connection. Their names alone do not make their values comparable.

## 9. Hardware design and the previously observed device

The documented hardware is an ESP32-S3 with NEO-M8N GPS, MPU-9250 IMU,
320x240 ILI9341-profile TFT, XPT2046 touch, SOS/user/power buttons, and a switched
peripheral rail. MicroSD and the A7670C cellular modem are optional components
whose implementation is disabled by default.

| Function | Repository wiring contract |
| --- | --- |
| TFT SPI clock / MOSI / MISO | GPIO12 / GPIO11 / GPIO13 |
| TFT CS / DC / reset | GPIO10 / GPIO9 / GPIO8 |
| TFT backlight | GPIO5 through a transistor |
| Touch CS / interrupt | GPIO14 / GPIO15 |
| I2C SDA / SCL | GPIO17 / GPIO18 |
| Documented IMU interrupt | GPIO16; not implemented in the main configuration |
| GPS receive / transmit | GPIO6 / GPIO7, 9600 baud |
| SOS / user button | GPIO1 / GPIO2 |
| Documented power button | GPIO4; handling not implemented |
| Peripheral enable | GPIO21, active-low P-FET design |
| Reserved modem receive / transmit | GPIO48 / GPIO47 |
| Modem PWRKEY / SD CS | -1: unspecified and disabled |

The peripheral power contract uses an active-low P-FET. A TPS22918 is not a
pin/control-equivalent substitute. Logic is 3.3 V; the cellular module requires
a separately qualified approximately 3.4-4.2 V supply capable of at least 2 A.
Exact board electrical details still require validation.

The earlier connected diagnostic image reported different hardware details:

- COM14, 115200 baud.
- GPS input on RX39, rather than repository RX6.
- MPU-6500 rather than the assumed MPU-9250.
- Reported scales of 8192 counts/g and 65.5 counts/(degree/s), at 50 Hz.

Those differences matter. The repository's main firmware is not proven to be
the exact source of the diagnostic image that produced the captured data.
Existing compiled sketches are not proof of the firmware currently installed.

## 10. Firmware behavior and incomplete integrations

`firmware/platformio.ini` targets the Arduino ESP32-S3 DevKitC-1 environment.
`src/main.cpp` sequences peripheral power, initializes sensors/queue/transport,
polls buttons, generates records, handles pending SOS, and updates display state
in a cooperative loop.

Implemented intent includes:

- Telemetry every 10 seconds while SOS is not active.
- Button debounce of 35 ms.
- SOS activation after a 1200 ms hold.
- A 2000 ms user-button hold clearing the local SOS latch.
- SOS latching without GPS, IMU, ML, or modem availability.
- Stable record identity across retries of the same pending record.
- CRC32 over the exact JSON bytes that will be transmitted.
- Queue acknowledgement only on a matching accepted record receipt.

Local SOS activation, successful network acceptance, human acknowledgement,
and resolution are different states. Clearing the local latch does not prove
the server's SOS record was resolved.

`sensors.cpp` contains RMC/GGA parsing and I2C initialization, but actual IMU
acquisition remains a stub. `modem_transport.cpp` defines a fail-closed TLS
transport requiring an injected board-specific backend, credentials, a hostname,
CA trust, and a valid clock. The main application does not supply a concrete
cellular TLS backend.

SD is disabled until a real CS pin is configured. Queue memory and journals have
no demonstrated bounded-retention/compaction strategy. Power-button behavior,
deep sleep, and touch input are not completed in the main application. Queue
reload and boot identity also have specific source problems listed below.

## 11. Physical display: pages, integration, and recovery evidence

The display headers define nine pages:

1. Boot.
2. Status.
3. GPS.
4. Motion.
5. Map.
6. Journey.
7. SOS.
8. Responders.
9. Diagnostics.

`firmware/include/ui/page_catalog.h` selects page renderers and lets an active
SOS override the selected page. Rendering uses an abstract Canvas interface and
explicit unavailable states. An observed trail is not offline road map data.

The main firmware updates `displayState`, but does not initialize a concrete
TFT/Canvas or call `renderPage`. Therefore these display modules are not yet
connected to a complete main-firmware rendering loop.

`display_test/display_test.ino` is a separate raw-SPI diagnostic sketch;
`esp32_smoke/esp32_smoke.ino` is a separate boot/chip/heartbeat test. Historical
attached sketches include GPS/MPU, filtered features, SIM display, cellular SOS,
CRC32, and offline map/SD/journey variants. They are reference variants, not
verified alternatives to the installed diagnostic image.

The earlier display investigation recorded faint/blank output and a white flash
followed by darkness on reboot. Diagnostic firmware commands were recovered,
including `DISPLAY_TEST`, `DISPLAY_REGS`, `DISPLAY_WIDTH_TEST`, `DISPLAY_LIVE`,
and a separate frame-transfer protocol. Accepted serial commands and reported
rendering do not prove that the panel visibly showed pixels.

The saved diagnostic image drives GPIO5 HIGH initially and LOW after LCD
initialization. A one-instruction patch was prepared and independently reviewed;
it was not flashed. Its changed sectors are 0x033000 and 0x0F3000, including the
necessary checksum/hash changes. The saved backup covers the first 3 MiB of a
16 MiB flash device, not a complete restore image. A matching embedded ELF ID
alone cannot establish an exact match to the patched/original bytes.

The current physical display result, current installed image, and source of
that image remain unverified in this review. The detailed recovery record is
`my projectt/docs/DISPLAY_RECOVERY.md`.

## 12. Production API and database design

| Endpoint | Purpose |
| --- | --- |
| POST /api/ingest | Authenticated device telemetry ingestion |
| POST /api/sos | Authenticated device emergency ingestion |
| GET /api/devices | Organization-scoped device records |
| GET /api/journeys | Organization-scoped stored journeys |
| GET /api/alerts | Organization-scoped stored alerts |
| POST or PATCH /api/sos/[id] | Authorized acknowledgement/resolution transitions |
| GET /api/live | Separate authenticated captured diagnostic feed |

The production wire envelope is:

```text
{ "payload": "<exact JSON string>", "crc32": "<8 hex digits>" }
```

CRC32 covers the exact UTF-8 payload bytes, not a reserialized object. It detects
accidental corruption; device authentication is provided separately. The device
sends a bearer secret, which is hashed with SHA-256 before database verification.
The ingest request body is bounded to 32 KiB.

Telemetry identity includes version, device_id, record_id, recorded_at or null,
boot_id, sequence, and uptime_ms. GPS fields describe fix, coordinates, speed,
HDOP, and age; optional IMU fields use defined physical units. The backend adds
received_at. Unsynchronized offline records can use a null recorded_at.

Uniqueness of `(device_id, record_id)` supports retries. Queue removal depends
on `{accepted:true, record_id, duplicate:boolean}` with a matching record ID.
Missing backend configuration returns a real error rather than fixture success.

`database/schema.sql` defines:

- organizations and memberships.
- devices and telemetry.
- journeys.
- sos_events and alerts.
- audit_events.
- rate_limits.

Membership roles are owner, admin, responder, and viewer. Row-level security
is intended to isolate organizations. `ingest_device_record` verifies the
device and transactionally writes telemetry/SOS/alert records. `transition_sos`
locks the event, checks authorization, applies the pending -> acknowledged ->
resolved transition, and records audit evidence.

Operational list requests require organization_id and bounded pagination
between 1 and 100. Browser SOS mutations require the configured HTTPS origin.
The journeys table exists, but ingestion does not implement automatic journey
formation. The current captured UI is not populated from these production
operational records. SQL/RLS source is present; hosted behavior is not proven by
source inspection alone.

## 13. Specific gaps found in the current source

These are source findings, not newly executed end-to-end tests. No fixes were
applied during this project overview.

1. Offline queue records will not reload as intended.
   `firmware/src/offline_queue.cpp:173` writes
   `Q1|T|record_id|length|CRC|payload`. The loaders at lines 109 and 145 take the
   ID from `source.substr(a + 2U, b - a - 2U)`. In the written format, a=2 and
   b=4, making this an empty string that fails token validation. Length/CRC
   extraction is shifted too. Both Arduino and host branches need correction
   before recovery after restart can be trusted.

2. Boot identity is not reliably unique.
   `firmware/src/main.cpp:202` derives bootId from `millis()` during setup.
   Similar startup timing can repeat across reboots. Because record IDs combine
   boot identity and sequence, new data can collide with database deduplication.

3. Login and the browser API helper use different token storage conventions.
   `components/workstreams/login-view.tsx:51` uses a scoped
   `smarttrack.supabase.session.v1:<project-url>` session and exports
   `getSmartTrackAccessToken()`. `lib/client/api.ts:3` instead names
   `smarttrack.access_token`. No connecting use of the login accessor was found
   in that helper. Successful login alone does not supply its bearer token.

4. The Content Security Policy omits the Supabase Auth origin.
   `next.config.ts:17` allows connect-src for self, OpenFreeMap, and Open-Meteo.
   Login directly fetches the configured external Supabase Auth endpoints, so
   the current policy blocks those browser requests in a normal hosted setup.

5. The ML launch instructions do not match service initialization.
   `ml/smarttrack_ml/service.py:149-154` leaves app as None unless
   SMARTTRACK_CREATE_APP=1. The documented bare Uvicorn service:app command
   needs that environment setting or the create_app factory form. Other
   configuration and artifact requirements still apply.

6. Rate-limit storage exists, but enforcement is not connected.
   `rate_limits` appears in the schema and RLS definitions, but the ingest RPC
   does not consume it. Mapping a possible 429 error is not rate enforcement.

7. Important device integrations are absent.
   Main firmware needs the real IMU driver, concrete display/Canvas renderer,
   touch handling, board-correct power behavior, configured SD, and a real TLS
   modem backend. Pin/source differences with the observed device must be
   reconciled before replacing its firmware.

8. The production ML and operations workflows remain incomplete.
   There is no located promoted real model or app-to-ML invocation. Durable
   journey formation, actual responder/SOS delivery, road routing, and push/SMS
   integration are not established. Old demo components are not evidence for
   those capabilities.

9. Documentation needs alignment with the current tree.
   The README's demo-startup description and some USB-only instructions are
   stale. ML dependency minimums differ between manifests. Older review records
   describe earlier snapshots and should not be read as today's runtime status.

## 14. What previous verification actually establishes

The following results come from `docs/VERIFICATION.md` and related session
records. They were not rerun for this report:

- The web production build and TypeScript checking passed after the latest
  recorded captured-feed integration.
- The combined decoder, relay, feed, and resumed-review regression checks
  passed ten required local rounds. These used synthetic data, temporary files,
  and loopback HTTP, not ten physical-device integrations.
- Seven captured-browser checks passed across fourteen authenticated and
  unauthenticated routes, including stale/cache handling and mobile layout.
  Those checks used synthetic API fixtures.
- Earlier direct serial capture on COM14 produced valid GPS, nine satellites,
  HDOP 1.11, active raw IMU, and a heuristic score of 93/100. The score became
  unavailable after expiry. No personal coordinates are reproduced here.
- Older Python feature verification recorded 21 passing tests. This does not
  establish trained-model accuracy or production artifact readiness.
- A deployment was previously available at https://smarttrack-web.vercel.app.
  Later checks found working hosted pages and an authorized feed returning 503
  because its upstream device computer was unreachable. Later local UI/feed
  corrections were not redeployed at the recorded checkpoint.

The older record stating no hardware was available predates the later COM14
observation. It still does not establish a completed main-firmware build,
physical TFT operation, cellular delivery, electrical safety validation,
Supabase tenant isolation, or a real-world ML evaluation.

No current device capture, cloud health check, model benchmark, firmware flash,
or electrical test was performed for this overview. Current availability may
differ from those earlier observations.

## 15. How much I understand, and what remains unknown

I can explain your product's intended behavior, the local application structure,
each routed view, both captured-data paths, freshness and scoring rules, hardware
pin contracts, firmware state/queue/transport design, backend wire contract,
database roles and transitions, and the ML feature/training/service design.
I can point to the code boundaries that need integration and the concrete gaps
above. That is substantial understanding of the local project architecture and
implementation, not a claim that the whole product is finished.

I cannot determine from these files alone:

- The exact firmware currently running on every device.
- Whether the physical screen is currently visible and correct.
- Changes that exist only on another machine and are absent from this tree.
- Whether cloud credentials, database schema, memberships, and hardware wiring
  currently match their intended configuration.
- Real battery life, modem reliability, positioning accuracy, or SOS delivery
  performance without measurement.
- Real ML generalization or deployment readiness without a real evaluation.
- Product requirements or future plans you have not yet recorded.

A completion percentage would therefore be misleading. The evidence supports a
working captured/live web prototype with meaningful validation, alongside
substantial but unfinished production firmware, cloud, display, and ML work.

## 16. Practical order for completing the product

These are recommendations for future work, not changes performed by this report:

1. Establish the exact running firmware source and board wiring, then resolve
   the physical display integration against that known device configuration.
2. Correct queue reload and boot/record identity; verify reboot, retry, and
   acknowledgement behavior with a meaningful persistence test.
3. Connect the actual sensors, display, storage, and TLS transport in one main
   firmware build and validate the hardware behavior.
4. Align login token consumption and CSP, then validate real authentication,
   organization isolation, device provisioning, and rate enforcement.
5. Prove a complete telemetry and SOS path through durable database storage,
   acknowledgement, resolution, and audit history, including offline recovery.
6. Connect production records to the appropriate UI workflows and define actual
   journey formation, routing, and notification requirements.
7. Gather consented real data, evaluate and promote the ML artifact, integrate
   the service, and label its score distinctly from the existing heuristic.
8. Update the runbooks and deploy the verified integrated version.

The main sources for this understanding are the files named throughout the
report, `my projectt/docs/CONTRACT.md`, `my projectt/docs/VERIFICATION.md`,
`my projectt/docs/LIVE_USB.md`, `my projectt/docs/DISPLAY_RECOVERY.md`, and the
wiring documents under `connectionss`.
