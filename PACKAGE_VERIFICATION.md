# Package verification — 2026-11-05

This portable package includes the five-agent animation refinement, public
journey-planning fix and user-approved clean connection state. Trust & Safety, Alerts, Activity Log and
Analytics no longer repeat the private-link prompt. Device data remains private;
no viewer or relay credential is embedded in the source.

## Locations and independence

- Shared folder: `C:/Users/muppa/omnirush.ai/smarttrackwebapp`.
- Separate system copy: `C:/Users/muppa/smarttrackwebapp`.
- Shared browser path: http://192.168.1.35:8088/files/smarttrackwebapp/.
- Archives: `smarttrackwebapp.zip` beside each folder.

The copies are independent snapshots. Source files and manifests match at
handoff. Generated dependencies/build files may be present on the host but are
excluded from the manifest and ZIP archives. No Git remote or Vercel project
binding is included, so a recipient can deploy to their own project.

## Executed checks

- `npm ci --ignore-scripts` succeeded in both copies when the packages were
  created, installing 53 packages. This motion pass changes no dependencies.
- The updated shared package's production build passed compilation, type checking and
  generation of all routes.
- After motion integration, 101 unit/integration regressions passed in each of
  ten rounds, exit 0 each. `docs/MOTION_TEST_ROUNDS.json` contains the current
  receipts; `docs/PACKAGE_TEST_ROUNDS.json` retains the earlier package checks. Commands and full
  development history are in `docs/VERIFICATION.md`.
- Four local browser suites passed: section navigation, motion/accessibility,
  map/sensors and journeys. Actual OpenFreeMap tiles loaded; telemetry, USB and
  journey provider scenarios used synthetic fixtures. Rapid zoom, reduced motion,
  offscreen scanning, hidden focus, timers/notifications and responsive layouts
  were covered. Desktop/mobile screenshots were reviewed.
- Earlier package verification passed seven captured-data lifecycle groups across
  fourteen pages. No real serial port was opened in either verification pass.
- The updated website is https://smarttrack-web.vercel.app, deployment
  `dpl_71UBzoYZA1PyuPHqsBLu26Upui74`. Hosted section-transition and motion suites
  passed. A direct anonymous request to the private device feed returned 401.
- The hosted waiting-state suite passed all fourteen pages with no repeated
  private-link error, fabricated location, private feed request or browser exception.
- File Browser create, read, update, rename and delete previously succeeded inside this
  exact shared folder. Browser command execution ran Node in the project working
  directory. A fresh browser session received the same controls. The receipt is
  `docs/PACKAGE_SERVER_VERIFICATION.json`. Checks used the host's Wi-Fi address;
  a physically separate device was not used in this packaging run.
- The existing `friend` account and owner-created new account defaults include
  CRUD, download and execution. This motion update changes no permissions or logins.
- Package scanning checks for the known private owner/friend and device secrets.
  Private `.local` data, real `.env` files, account settings, build artifacts and
  Vercel bindings are excluded. `PACKAGE-MANIFEST.json` contains source SHA-256s;
  the two ZIP copies are checked for equality and manifest contents.

## Dependency audit result

The original lockfile is preserved. `npm audit` reported four affected packages
(two critical, two high). See `docs/DEPENDENCY_NOTES.md` for the exact packages
and advisories. These were not resolved by copying or building the app; a major
MapLibre upgrade and dependency remediation require their own compatibility work.
