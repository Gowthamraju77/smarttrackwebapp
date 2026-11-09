# Production deployment — 2026-11-05

## Latest update: automatic readings on the normal website URL

Production URL: https://smarttrackwebapp.vercel.app

- Deployment: `dpl_EjhqTeppQX2vHz62kyaYr5JghwZb`, READY.
- Immutable URL: https://smarttrackwebapp-tjgnvxpzw-muppallagowtham123-3987.vercel.app
- Command: `npx --yes vercel@latest deploy --prod --yes --scope muppallagowtham123-3987` (exit 0).
- `SMARTTRACK_PUBLIC_LIVE=1` enables read-only shared telemetry on ordinary URLs.
  Both the API and client provider use this setting. No private viewer link,
  saved viewer key or Authorization header is needed; relay credentials remain
  server-side. The Devices page now includes the available hardware reports.
- The plain `/api/live` URL returned HTTP 200 with current GPS and MPU readings.
- `BASE_URL=https://smarttrackwebapp.vercel.app SMARTTRACK_ALL_SECTIONS=1 node tests/infoesp-browser.cjs`
  passed at `2026-11-05T17:18:25Z`. It observed 14 distinct real sensor receipts,
  advancing hardware timestamps, a position marker, live GPS and MPU data,
  zero credentialed feed requests and zero browser runtime errors.
- The check covered the dashboard, a separate fresh browser opening `/map`,
  reload, journey, navigation, insights, analytics, alerts, devices, display,
  activity and settings. See
  [PUBLIC_INFOESP_HOSTED_VERIFICATION.json](PUBLIC_INFOESP_HOSTED_VERIFICATION.json).
- The build and ten local verification rounds passed. See
  [PUBLIC_INFOESP_VERIFICATION.json](PUBLIC_INFOESP_VERIFICATION.json).

Reload existing tabs to load the new deployment. The previous private shortcut
is no longer required and now points to the normal website URL. Keep the host,
infoesp collector and HTTPS tunnel running. Actual fix loss or component errors
remain visible; telemetry does not supply email/SMS delivery or a trained ML model.

## Previous update: continuous infoesp readings

Production URL: https://smarttrackwebapp.vercel.app

- Deployment: `dpl_gRRtfNiNqko4PEihY23wxNHyGZti`, READY.
- Immutable URL: https://smarttrackwebapp-323zl268o-muppallagowtham123-3987.vercel.app
- Command: `npx --yes vercel@latest deploy --prod --yes --scope muppallagowtham123-3987` (exit 0).
- Configured the existing private viewer key, relay key and HTTPS relay origin
  as the three production live-feed environment variables. No values are recorded here.
- Background source: `/infoesp`, read through the **SmartTrack infoesp relay**
  Windows scheduled task. The existing HTTPS tunnel carries normalized readings
  to the Vercel API; browsers do not connect directly to the local HTTP address.
- `BASE_URL=https://smarttrackwebapp.vercel.app node tests/infoesp-browser.cjs`
  passed against the public alias using the private device link. Four distinct
  sensor receipts arrived; rendered hardware timestamps advanced, the current
  GPS marker appeared, mobile layout fit, and no browser runtime errors occurred.
- Hosted verification completed at `2026-11-05T16:55:56Z` (22:25:56 IST).
  See [INFOESP_HOSTED_VERIFICATION.json](INFOESP_HOSTED_VERIFICATION.json).
- Ten local verification rounds and the build also passed; see
  [INFOESP_VERIFICATION.json](INFOESP_VERIFICATION.json) and [VERIFICATION.md](VERIFICATION.md).

The owner can open `.local/Open-Live-Website.url` to activate the existing private
feed in a browser tab. Keep the collector, host and HTTPS tunnel running.
Hardware failures remain reported as failures; this deployment does not repair
the MPU or establish modem registration or notification delivery.

## Previous update: more road choices and optional via place

Production URL: https://smarttrackwebapp.vercel.app/journeys

- Deployment: `dpl_m9U9ALea4kHzVpgKmovpUzJkigXu`, READY.
- Immutable URL: https://smarttrackwebapp-eqhd6x0b7-muppallagowtham123-3987.vercel.app
- Deploy command: `npx --yes vercel@latest deploy --prod --yes --scope muppallagowtham123-3987` (exit 0).
- Requests the public service's maximum three alternatives (up to four total
  routes), keeps four selections across reload, and refreshes older saved plans.
- Adds via search/map picking, a via marker, route recalculation, and navigation
  locking. All displayed routes come from the routing provider.
- Production browser checks passed on the public alias without Vercel login:
  four-choice selection and persistence, via search/removal/map picking,
  navigation, and desktop/mobile layouts. Browser road fixtures are synthetic.
- Separate real provider checks passed for place search, ordinary routing,
  and via routing. The hosted via request returned a 4,733.2 m road route with
  the requested via place about 2.9 m from the road geometry.
- Screenshots: `C:/Users/muppa/AppData/Local/Temp/smarttrack-route-options-BM6Adv`.
- Build, ten local rounds, real provider limits, and production receipts:
  [ROUTE_OPTIONS_VERIFICATION.json](ROUTE_OPTIONS_VERIFICATION.json).

The provider may return fewer than four routes. This does not enumerate every
possible road path; a via place lets the user explore another road corridor.

## Previous update: flowing feature panels

Production URL: https://smarttrackwebapp.vercel.app

- Deployment: `dpl_Cp4W5Mj9C3M5f5naspepi9yB5w5h`, READY.
- Immutable URL: https://smarttrackwebapp-h2wzxzfws-muppallagowtham123-3987.vercel.app
- Deploy command: `npx --yes vercel@latest deploy --prod --yes --scope muppallagowtham123-3987` (exit 0).
- Extended the soft shaded folds into dashboard cards, journey features,
  notification settings, alert/evidence panels, and map headers.
- Public Edge review passed without Vercel authentication: actual moving folds,
  inert decoration behind content, offscreen and simulated document-hidden
  pausing, reduced motion, desktop/mobile layouts, and no page errors.
- Production section-transition suite passed, including keyboard navigation,
  browser Back, rapid section switches, and reduced motion.
- Screenshots: `C:/Users/muppa/AppData/Local/Temp/smarttrack-feature-flow-OGxJPv`.
- Build, ten local rounds, additional journey/notification checks, and production
  receipts: [FEATURE_FLOW_VERIFICATION.json](FEATURE_FLOW_VERIFICATION.json).

Visual checks use synthetic contact fixtures and mocked map tiles. No messages
were sent; email/SMS delivery configuration remains separate.

## Previous update: soft flowing background

Production URL: https://smarttrackwebapp.vercel.app

- Deployment: `dpl_8QVGZRQ4Gt7cwTUFgatRVwvVsfuu`, READY.
- Immutable URL: https://smarttrackwebapp-p2suh7zvw-muppallagowtham123-3987.vercel.app
- Deploy command: `npx --yes vercel@latest deploy --prod --yes --scope muppallagowtham123-3987` (exit 0).
- Production Edge review passed: moving background layers, contact entry and
  dashboard, mobile overflow, background continuity through route changes,
  reduced motion, and no browser runtime errors. The public alias was used
  without Vercel authentication. Map tiles were mocked for this visual review.
- Screenshots: `C:/Users/muppa/AppData/Local/Temp/smarttrack-flow-review-Ahtjbk`.
- Ten local verification rounds are recorded in
  [FLOW_BACKGROUND_VERIFICATION.json](FLOW_BACKGROUND_VERIFICATION.json).

## Initial deployment

- Public URL: https://smarttrackwebapp.vercel.app
- Project: `smarttrackwebapp`
- Scope: `muppallagowtham123-3987`
- Deployment: `dpl_F1BVZNJUdrwsVLUTtsWLKgfwxSLR`
- Immutable URL: https://smarttrackwebapp-lsrqy41xx-muppallagowtham123-3987.vercel.app
- Inspector: https://vercel.com/muppallagowtham123-3987/smarttrackwebapp/F1BVZNJUdrwsVLUTtsWLKgfwxSLR
- Status: READY, production; remote build completed in 57 seconds.
- Runtime: Node.js 24; Hobby plan.

The existing `smarttrack-web` project was not modified. The new project was
created and this checkout linked with Vercel CLI. The create-project endpoint
rejected the `nodeVersion` property, so creation and the Node.js 24 update were
issued as separate successful requests.

Deployment command (exit 0):

```powershell
npx --yes vercel@latest deploy --prod --yes --scope muppallagowtham123-3987
```

## Production checks

- Unauthenticated HTTP requests to `/`, `/settings`, and `/journeys` returned
  200 on the public alias, without redirecting to Vercel login.
- `BASE_URL=https://smarttrackwebapp.vercel.app node tests/notifications-browser.cjs`
  passed: real hosted pages, contact entry, validation, persistence, all timing
  choices, responsive layout, journey mode changes and reduced motion. This
  test uses synthetic contacts and mocked delivery/registry responses; it does
  not establish hosted notification delivery or database connectivity.
- `BASE_URL=https://smarttrackwebapp.vercel.app node tests/public-planning-smoke.cjs`
  passed against real public providers: 5 place results, 1 road route with
  distance/ETA, private device data protected, foreign browser origin rejected.
- `/api/notifications/dispatch` returns the expected 503
  `Notification scheduler needs setup.` No provider messages were sent.

## Remaining service configuration

Hobby does not support a one-minute Vercel cron, so the default `vercel.json`
contains only install/build commands. The notification endpoint remains deployed.
To send messages, configure Supabase, apply `database/notifications.sql`, add
Resend/Twilio credentials and a cron secret, and run an authenticated external
scheduler every minute (or configure Vercel Cron on a supporting plan).
See [NOTIFICATIONS.md](NOTIFICATIONS.md). The private device relay also needs its
own deployment environment variables. Contact entry and public route planning
are usable now.

`.env*`, `.vercel/`, `node_modules/`, and `.next/` are explicitly excluded from
source uploads. Vercel CLI created a local ignored environment file when linking;
its credentials are not included in this report or the deployment upload.
