# SmartTrack

SmartTrack is a Next.js 15 dashboard and device protocol foundation for an
ESP32-S3 tracking device. The repository contains a synthetic, interactive
dashboard, secure request boundaries for Supabase, an explainable Python ML
package, and firmware contracts based on the supplied hardware pin reference.

## Current operating mode

The browser dashboard starts in **synthetic demo** mode. On a computer using
Chrome or Edge, choose **Connect ESP32** to read the attached device through
Web Serial at 115200 baud. The dashboard, map, and Trust Score views then use
the actual incoming GPS and raw IMU stream. The USB connection stays active
while navigating between these views, and readings remain in browser memory.

The live Trust Score is an explicitly labelled sensor-quality heuristic,
not a trained ML prediction or safety probability. Lost fixes and stale data
make the score unavailable. OpenFreeMap supplies real map tiles; the optional
demo weather panel uses Open-Meteo. Routing, push, and SOS delivery still need
their separate integrations. Protected production APIs continue to fail closed
when their required configuration is absent.

See [the live USB guide](docs/LIVE_USB.md) for connection and scoring details.

## Develop

```powershell
npm ci
npm run dev
```

Checks:

```powershell
npm run typecheck
npm run build
python -B -m unittest discover -s ml/tests -p "test_*.py"
```

## Deploy

Read [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) before deploying. Vercel hosts
the Next.js application; Postgres/Auth and the ML service are external
durable services. Apply [database/schema.sql](database/schema.sql) to a
disposable Supabase project before enabling production API access.

## Safety boundaries

SOS is independent of ML inference and must remain deliverable when GPS or
the ML service is unavailable. CRC32 detects accidental corruption only; it
is not authentication. The A7670C requires its own qualified power supply
and is disabled by default in the firmware because the supplied wiring leaves
its PWRKEY and storage CS unspecified.
