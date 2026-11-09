# SmartTrack remote project: access and source review

Checked on 2026-11-04 from the local Linux terminal. Review ID: `SERVER_ACCESS`.
This report contains no login secrets or personal location readings.

## Verified connection and permissions

| Item | Observed value |
|---|---|
| File server | Omnirush Projects / File Browser 2.63.23 |
| Address | `http://192.168.1.35:8088` |
| File Browser account | `friend` |
| Windows host | `GOWTHAMRAJU677` |
| Command execution account | `muppa` |
| Shared root | `C:\Users\muppa\omnirush.ai` |
| Project | `C:\Users\muppa\omnirush.ai\my projectt` |
| Browser/API project path | `/my projectt` |
| Connection method | Authenticated File Browser HTTP file API and WebSocket command runner; no SSH |
| Node runtime | `v24.19.0` |

Read, create, modify, delete and command execution were exercised. A uniquely
named `tests/review-SERVER_ACCESS-*.test.mjs` file was created, read back, modified,
read back again, deleted and confirmed absent. It contained only a permission
probe, with no changes to application behavior.

Remote execution commands whose output was received:

```text
node --version
powershell -NoProfile -Command "Write-Output $env:COMPUTERNAME; Write-Output $env:USERNAME; Get-Location"
```

The second command confirmed the Windows host, account and project working
directory above. File Browser closes its command WebSocket without a normal
close frame after output. The first temporary-script check reported that transport
exception; subsequent command checks retained the received output and confirmed
execution. No normal-close or exit-code receipt was inferred from the socket.

Account claims allow create, rename, modify, delete, download and execution.
Administration and public sharing are disabled. Rename was advertised but was
not separately tested. File Browser rights are distinct from Windows administrator
privileges; no elevation was attempted or verified.

## Three source findings

### 1. The current application is further along than its README describes

The project is `smarttrack-web` 0.1.0, using Next.js 15.5.x, React 19,
TypeScript and MapLibre. `components/app-shell.tsx` defines fourteen views:
dashboard, map, journeys, insights, analytics, alerts, devices, settings,
navigation, display, team, security, activity and help.

The README still describes a synthetic demo as the starting mode. The current
`dashboard-view.tsx`, `section-view.tsx` and live provider instead route through
captured/live-device components or explicit empty states. The provider reports
`mode: "live"` and sources `relay`, `usb` or `none`. This review did not rewrite
the README or application code.

### 2. Live input exists, while hosted integration still has separate dependencies

The provider supports direct browser Web Serial at 115200 baud and authenticated
polling of `/api/live`. It retains captured observations separately from current
fresh readings and validates cached snapshots. The live API requires viewer and
relay credentials and a configured HTTPS relay URL; missing configuration or
an unreachable device computer returns an error rather than replacement readings.

`scripts/live-relay.cjs` supplies authenticated `/snapshot` and `/health` endpoints.
Its default TCP port is 4317 and its serial mode targets a Windows `COM14` device.
The current Linux USB device is a different endpoint and is owned by the local
Python monitor. This review did not connect that monitor to the remote web app.

The source tree also includes Supabase authentication/database APIs, telemetry
ingestion, SOS contracts, offline queue code and a separate Python ML package.
The live Trust Score is a sensor-quality heuristic. Production ML requires a
real evaluated/promoted model; routing, messaging and emergency delivery have
separate integration requirements.

`docs/VERIFICATION.md` records prior build/type/test passes and an earlier hosted
deployment, then a newer captured-feed revision that was not redeployed while
its device-server connection was pending. Those are recorded prior checks; no
build, deployment, Supabase, ML inference or hosted hardware test was run here.

### 3. Remote firmware and the installed touchscreen firmware are different

Remote `firmware/include/config.h` assigns GPS RX6/TX7; its PlatformIO defaults
disable the modem and leave modem PWRKEY and SD chip select unspecified (`-1`).
The local `/home/gamma/esp32-diagnostics/gps-firmware` currently installed on the
ESP32 uses GPS RX39 and the working LVGL touchscreen launcher with saved touch
calibration, PSRAM, USB telemetry and OTA support.

The source sets must be compared and their pin/feature differences reconciled
before replacing the installed firmware. This review did not flash the remote
repository's firmware or overwrite it with the local diagnostic application.

## Files read

- Shared root: `SHARING.md`.
- Project guidance: `AGENTS.md`, `README.md`, `package.json`, `docs/CONTRACT.md`.
- Guides and evidence: `docs/LIVE_USB.md`, `docs/VERIFICATION.md`,
  `docs/DEPLOYMENT.md`, `firmware/README.md`, `ml/README.md`.
- Application routes/layout: `app/page.tsx`, `app/layout.tsx`,
  `app/[section]/page.tsx`, `app/api/live/route.ts`.
- UI/source integration: `components/app-shell.tsx`, `components/dashboard-view.tsx`,
  `components/section-view.tsx`, `components/live/live-telemetry-provider.tsx`,
  `components/live/real-device-section.tsx`.
- Relay: `scripts/live-relay.cjs`, `scripts/start-live-relay.ps1`.
- Firmware configuration: `firmware/platformio.ini`, `firmware/include/config.h`.

Directory listings additionally confirmed database, firmware, ML, server/client
libraries, live components and test files. A directory listing is not a review of
every contained implementation. Existing dependencies and application files were
left intact; this report is the review's own documentation artifact.

## Local device state and handoff

The ESP32 is attached to the Linux machine `Luffytaro`, account `gamma`, at the
stable USB identifier ending `3C:84:27:F7:FE:20-if00` (`/dev/ttyACM0` currently).
The local monitor is `esp32-monitor.service`, explicitly using `--transport usb`.
Its dashboard is `http://127.0.0.1:8765`, local to Luffytaro. This is separate from
the Windows file server and the hosted Next.js application.

Local touch calibration, GPS telemetry and map transfers were verified. MPU and
A7670C communication errors remain. Local setup, firmware identity and update
history are documented in the local project's README, LAUNCHER.md and
SERVER-HANDOFF.md. Credentials are stored locally in owner-only private files
and are excluded from shared documentation and backup exports.
