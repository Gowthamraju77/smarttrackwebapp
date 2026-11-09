# Connect your own device

The copied website has no connection to the original owner's private device.
Public maps, place search and route planning work without a device connection.

## Direct USB in Chrome or Edge

1. Open your deployed HTTPS website, or localhost, on the computer with the ESP32
   attached. Close other serial monitors using that port.
2. Open Dashboard or Settings and choose **Connect ESP32**. Select the actual
   USB serial device in the browser chooser.
3. The app reads at 115200 baud. Wait for genuine GPS/sensor messages and a valid
   position fix. No commands or firmware are written by the browser reader.

This connection belongs to the browser tab. A different person's browser does
not remotely access your USB device. Reloading or closing the tab ends the USB
session; reconnect through the chooser. Web Serial requires a supported desktop
browser and a secure context.

## Remote viewers through your private relay

The included Windows relay uses `scripts/live-relay.cjs` and
`scripts/start-live-relay.ps1`. Install the Node dependencies on the computer
attached to the ESP32. Set your own `SMARTTRACK_SERIAL_PORT` (for example the COM
port shown in Device Manager) and a random `SMARTTRACK_RELAY_SECRET`, then run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start-live-relay.ps1
```

The relay binds to loopback port 4317 by default. Publish it through an HTTPS
tunnel/reverse proxy you control, retaining its bearer authentication. Configure
your Vercel project's `SMARTTRACK_LIVE_RELAY_URL`, matching
`SMARTTRACK_RELAY_SECRET`, and a separate `SMARTTRACK_VIEWER_SECRET`.
Redeploy, then open your own private link:

```text
https://your-project.vercel.app/#feed=YOUR_OWN_VIEWER_SECRET
```

The app retains the viewer token in that tab's session storage and uses the
protected `/api/live` endpoint. The relay secret stays server-side. Never paste
real secrets into shared files. Relay captures/logs live in `.local` and are
excluded from exports. The host must remain running for remote streaming.

The packaged serial reader accepts Windows COM ports. Linux hosts need their own
compatible serial reader/adapter; do not assume the supplied PowerShell COM
reader supports `/dev/ttyACM*`.

## Data and monitoring

### Existing infoesp collector

The current host reads `http://192.168.1.35:4318/infoesp` continuously through
the hidden **SmartTrack infoesp relay** Windows scheduled task. The task starts
at sign-in and restarts the relay if its process fails. It does not open a COM
port or send commands to the ESP32.

The relay polls the collector about once per second and exposes its normalized
snapshot through the existing authenticated HTTPS tunnel. The Vercel app polls
`/api/live` about once per second. This deployment enables `SMARTTRACK_PUBLIC_LIVE=1`,
so the normal website and `/map` URLs show shared readings automatically without
a viewer token or special link. The relay key stays on the server. The local
HTTP address is never requested by a visitor's HTTPS browser.

The feed maps GPS coordinates, speed (km/h to m/s internally), altitude,
satellites, HDOP, MPU readings when available, and allowlisted display, modem,
Wi-Fi, runtime and firmware status. Modem and MPU errors are displayed as reported.
Missing heading, raw readings, sensor scales and checksum counts stay unavailable.
Trust Score remains a labelled heuristic with unavailable evidence omitted.

Collector receipt time, GPS UTC and individual sensor ages determine freshness;
repeated HTTP responses never renew sensor timestamps. Disconnection immediately
ends live status. Up to 240 distinct GPS observations remain in memory as history;
the infoesp reader does not load captures from a previous serial source.

For another installation, set your local relay secret and collector URL, then run:

```powershell
$env:SMARTTRACK_INFOESP_URL = 'http://your-collector:4318/infoesp'
& .\scripts\start-live-relay.ps1 -InputMode infoesp
```

On this host, controls are:

```powershell
Get-ScheduledTask -TaskName 'SmartTrack infoesp relay'
Start-ScheduledTask -TaskName 'SmartTrack infoesp relay'
Stop-ScheduledTask -TaskName 'SmartTrack infoesp relay'
```

The host, infoesp collector and HTTPS tunnel must stay running. The current
temporary tunnel hostname can change if the tunnel restarts; update
`SMARTTRACK_LIVE_RELAY_URL` in Vercel and redeploy when that happens. Private
connection values and the `Open-Live-Website.url` shortcut are kept in `.local`,
outside the shared browser and deployment uploads.

The decoder accepts checksum-valid NMEA RMC/GGA and the supported raw IMU/display
messages. Missing or stale observations stay unavailable/historical. Display
stabilization does not alter the raw GPS used by journey checks.

Journey timing starts on fresh GPS within 30 m of the selected start. Arrival
needs two distinct fresh observations near the finish. Sustained departure from
the selected route raises an in-page alert. Keep the tab open for monitoring;
browser notifications are optional. GPS interruptions suspend location checks.

The Trust Score is a labelled sensor-quality heuristic, not a safety probability
or the separate Python ML model. Raw device temperature is not calibrated ambient
temperature. `docs/VERIFICATION.md` contains development evidence; older original
device/port notes are preserved in `docs/history` as historical reference only.
