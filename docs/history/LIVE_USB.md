# Live ESP32 data on SmartTrack

The hosted application reads the connected ESP32 directly through the browser's
Web Serial API. No relay, database credentials, firmware upload, or cloud copy
of the serial stream is required for this mode.

## Connect

1. Open https://smarttrack-web.vercel.app in desktop Chrome or Microsoft Edge
   on the computer connected to the ESP32.
2. Close any other serial monitor that has the ESP32 port open.
3. Choose **Connect ESP32**, select the Espressif USB serial device, and allow
   the browser to read it. The currently observed Windows device is COM14.
4. Open the dashboard, map, or Trust Score view. Wait for a valid GPS fix if
   the receiver is still acquiring satellites.

The browser must show its own device chooser after a user click. Opening the
serial port can restart some ESP32 USB firmware; the interface waits for fresh
sensor messages. No serial commands or firmware writes are sent. Reloading or
closing the tab ends the session. Reconnect from the page to start a new one.

This link can read a USB device attached to the computer opening it. Opening
the site on another computer or phone does not remotely access this computer's
ESP32. Cloud forwarding would be a separate integration.

## Input and freshness

The decoder accepts fragmented UTF-8 serial chunks, checksum-valid NMEA RMC/GGA
sentences, `MPU_SAMPLE` JSON, and `DISPLAY_VALUES` diagnostics from the running
device firmware. GPS position comes only from valid positioned NMEA sentences;
a diagnostic `gps_fix: true` flag cannot create coordinates.

Raw IMU register values are displayed as counts. Unknown sensor range,
calibration, orientation, and temperature conversion are not guessed. Repeated
or reversed sample counters, GPS chronology conflicts, damaged sentences, and
implausible jumps are reported as evidence problems.

A sensor stream becomes stale after five seconds without a valid sensor
message. GPS observations expire after ten seconds. A lost fix retains a
clearly marked last-known location, and the live score becomes unavailable.
The recent path is limited to 240 distinct positions in tab memory and is
discarded on a new connection or tab close.

## Trust Score

The displayed 0–100 value is **Trust Score — live estimate**, a transparent
sensor-quality heuristic. Its factors are position freshness (25%), GPS HDOP
(25%), satellites used (15%), recent complete IMU samples (15%), serial message
integrity (10%), and observation order (10%). The interface explains each
factor and any unavailable evidence; omitted factors have their remaining
weights normalized. A usable fresh GPS fix and a live stream are required.

This score does not establish sensor calibration, spoof resistance, actual
position error, emergency delivery, or a safety probability. The separate
Python ML package remains unavailable until a real, evaluated, promoted model
and backend integration are supplied.

## Hosting

The original Vercel project is `smarttrack-web`. The root layout owns the USB
provider so client-side navigation preserves the reader. HTTPS and
`Permissions-Policy: serial=(self)` enable the top-level site to request a
serial device. Existing Supabase APIs and their authentication boundaries are
independent of this browser-local mode.

## Verification

On 2026-11-04, `npm run build` and `npm run typecheck` passed. All 16 tests in
`node --test tests/live-telemetry.test.mjs` passed in ten required local rounds.
Those are repeated synthetic decoder checks, not ten hardware trials.

A six-second receive-only COM14 capture supplied 39,830 characters and 543
decoded lines to the actual decoder. It produced a valid positioned GPS fix,
nine satellites, HDOP 1.11, a recent raw IMU sample, and a live heuristic score
of 93/100, with no checksum or invalid-line errors. Advancing the observation
clock past expiry made the score unavailable. No actual coordinates were
written into project files.

`SMARTTRACK_BROWSER_CHANNEL=msedge node tests/live-browser-smoke.cjs` passed
eight browser integration checks against the local production build. It uses
an injected serial stream and synthetic coordinates, and checks map markers,
score updates, navigation preserving one reader, mobile layout, stale/no-fix
behavior, disconnect cleanup, and zero writes to the serial device. Its map
style is stubbed to isolate UI behavior. The external OpenFreeMap style also
returned HTTP 200 in a separate request with browser request headers.

Physical capture checks and browser transport simulations are separate
evidence. Neither is a calibrated sensor or production ML evaluation.

The update was deployed to the existing production alias on 2026-11-04
(deployment `dpl_FErFUpeYyUb3qXiAH7X6Nqp1bm2w`). Dashboard, map, and insights
returned HTTP 200 with the USB control and `serial=(self)` permissions policy;
the unconfigured protected devices API retained its HTTP 503 boundary.
The hosted browser smoke passed all eight checks. A second hosted run with
`SMARTTRACK_REAL_TILES=1` passed nine checks, including seven successful
OpenFreeMap vector-tile requests and marker rendering. Both browser runs used
synthetic serial input and reported no console/page errors.
