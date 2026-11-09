# SmartTrack web app

Portable source package of the SmartTrack website, prepared on 2026-11-05.
It includes the five-agent motion refinement, public journey-planning fix, source code, tests,
device relay, database schema, optional ML/firmware source, and project notes.

## Start here

The workspace now opens with a contact-details screen (no identity verification).
Settings has separate general and journey email/SMS intervals. Apply the optional
notification migration and configure delivery services using
[the notification setup guide](docs/NOTIFICATIONS.md). Local contact entry and
timing preferences work without these services; actual delivery requires setup.

Use Node.js 22 or 24 with npm. From this folder:

```sh
npm ci
npm run dev
```

Open http://localhost:3000. To test the production build:

```sh
npm run build
npm run start
```

The app works as a map and route planner without device credentials. Search for
start/destination names or select points on the map, compare the available road
routes, and choose one. The planner shows kilometres and estimated driving time.
No genuine device readings are shown until a device is connected.

## What each section does

- Live Map: real OpenFreeMap/MapLibre map and the tracked GPS position. A triangle
  indicates fresh GPS travel direction when the device is moving.
- Journey: online Photon/OpenStreetMap suggestions, start/end map selection,
  OSRM road alternatives, distance/ETA and retry without losing chosen points.
- Navigation: the selected road route, elapsed journey time and deviation alerts.
  Timing starts when fresh GPS reaches the start. Monitoring needs the tab open.
- Dashboard and other sections: captured/live GPS and raw sensor information,
  climate estimates, alerts, quality evidence and device/settings views.

The UI includes 3D tilt/rotation/zoom, optional terrain where available, smooth
section transitions, reduced-motion support and GPS/IMU display stabilization.
Camera controls accumulate rapid presses, cards and details share consistent
hover/reveal timing, and decorative loading motion pauses while offscreen.
Climate uses Open-Meteo and genuine GPS coordinates; it is separate from the
device's raw temperature register. Drive estimates do not include live traffic.

## Share or deploy your own copy

- [Your own Vercel account](docs/DEPLOYMENT.md): create a separate project;
  this package has no Vercel project binding, account token or production secret.
- [Use the shared server](SERVER_ACCESS.md): browser editing, CRUD and host command
  execution; friends do not need to install software to work through that server.
- [Connect your own device](docs/LIVE_USB.md): direct USB or a private HTTPS relay.
- [.env.example](.env.example): optional environment template. The deployment
  guide lists the same settings because the file server hides `.env*` files.

## Package contents

| Folder | Contents |
| --- | --- |
| `app`, `components`, `lib` | Next.js application, UI and backend/API implementation |
| `scripts` | Optional local serial reader and authenticated device relay |
| `tests` | Unit, integration, browser and public-provider checks |
| `docs` | Setup, contracts, verification records and technical reviews |
| `database` | Optional Supabase schema and setup |
| `ml` | Separate optional Python model/service source; requires its own environment |
| `firmware` | ESP32 source, display headers and diagnostic sketches |
| `hardware-notes` | Wiring guide, PDF and related source notes |
| `docs/history` | Earlier documentation retained as historical reference |

`PACKAGE-MANIFEST.json` records the distributed file hashes. Private account
files, device captures, real environment files, dependency folders and generated
build/firmware artifacts are excluded. Dependencies are reproducible from
`package-lock.json`. This is an independent copy; edits do not automatically sync
with the original project or with another copy.

## Validation

```sh
npm run build
npm run typecheck
node --test tests/live-telemetry.test.mjs tests/live-relay.test.mjs tests/captured-feed.test.mjs tests/review-resume.test.mjs tests/signal-stabilization.test.mjs tests/climate.test.mjs tests/journey.test.mjs tests/heading.test.mjs
```

See `PACKAGE_VERIFICATION.md` for checks of this distributed package, and
`docs/VERIFICATION.md` for development history. Browser suites additionally need
Playwright and a supported browser; set `SMARTTRACK_PLAYWRIGHT_PATH` to your own
Playwright installation. They are not needed to run or deploy the website.
Run the build before a standalone type check on a fresh extraction so Next.js
can generate its route type declarations.

The copied lockfile has four reported dependency advisories. See
[dependency audit notes](docs/DEPENDENCY_NOTES.md) before a new public deployment.

The web Trust Score is a labelled sensor-quality heuristic. The included Python
ML service, durable database flow, physical firmware and emergency delivery have
separate setup and validation requirements. Hardware notes describe more than
one firmware/pin configuration; compare your board before flashing anything.
