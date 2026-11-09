# SmartTrack integration contract

## Architecture and honesty
Next.js on Vercel for UI and request/response APIs; Supabase Postgres/Auth for durable data and tenant isolation; Python ML service deployed separately. Demo UI is explicitly synthetic, never a substitute for production APIs. Without configuration, protected APIs fail closed (503), never fall back to demo. All production reads/writes require authentication. No invented ML scores, map roads, sensor readings, or successful delivery receipts.

Public map planning exception: `/api/journey/places` and `/api/journey/routes` provide stateless Photon/OSRM lookups for names and points supplied by the visitor, without requiring a private device link. They must not access stored journeys, device telemetry, viewer/relay secrets or database data. Keep fixed upstream providers, input/response bounds, timeouts, no-store responses and cross-origin browser checks. Persisted production reads/writes remain authenticated.

Shared live telemetry exception, explicitly requested by the owner on 2026-11-05:
when `SMARTTRACK_PUBLIC_LIVE=1`, `/api/live` serves the configured, validated
read-only infoesp feed to ordinary website visitors without a viewer link. The
same server flag enables automatic browser polling on all pages. Relay credentials
remain server-only, responses remain uncached, and stale/missing readings are not
promoted to live. Without that explicit flag, viewer authentication is required.
This exception does not grant database writes, device control, account management
or notification scheduling permissions.

## Contact registry and notifications
The contact registry uses the existing private viewer capability for device scope
and a random per-browser contact capability for updates. Contact names are
self-reported, without identity verification. Service-only notification RPCs
store contact details and schedules; roster responses disclose names and
connection reports only. Scheduled dispatch requires a separate cron credential.
See NOTIFICATIONS.md and database/notifications.sql for setup and delivery limits.

## Wire protocol v1

`POST /api/ingest` and `POST /api/sos`: JSON envelope `{ "payload": "<exact JSON string>", "crc32": "<8 lowercase or uppercase hex digits>" }`. CRC32 IEEE checks UTF-8 payload bytes, not reserialized JSON. Device header `Authorization: Bearer <device secret>`; server stores SHA256 hash. HTTPS certificate validation required. Unique `(device_id,record_id)` handles retries. Response `{accepted:true,record_id,duplicate:boolean}` is the only queue-removal receipt.

Telemetry payload: `{version:1, device_id:string, record_id:string, recorded_at:string|null, boot_id:string, sequence:number, uptime_ms:number, gps:{fix:boolean,lat:number|null,lon:number|null,speed_mps:number|null,hdop:number|null,age_ms:number|null}, imu:{accel_mps2:number|null,gyro_dps:number|null}|null}`. Latitude ±90, longitude ±180, finite numbers only; invalid/missing fix cannot masquerade as current. Null recorded_at allowed for unsynced offline device. Server adds received_at. SOS uses same identifiers/time fields plus `{event:"sos",gps:...}`; no IMU or ML required. SOS IDs persist across retries. Ack/resolve are separate transitions with audit evidence.

## Backend ownership boundaries
K1 owns database/schema.sql (Supabase Postgres RLS, memberships owner/admin/responder/viewer, devices, telemetry, sos_events, audit_events, rate limits and durable transactional ingest RPC). K2 owns lib/server/security.ts (fetch-based Supabase auth with getUserContext(request), requireRole, requireSameOrigin), lib/server/supabase.ts (server-only REST helpers with env checks), next.config.ts. K3 owns lib/server/ingest.ts and app/api/ingest/route.ts, app/api/sos/route.ts (validation, CRC, authenticated transactional DB RPC). K4 owns lib/server/operations.ts and app/api/devices/route.ts, app/api/journeys/route.ts, app/api/alerts/route.ts, app/api/sos/[id]/route.ts; use K2 helpers. Export handlers may be integrated by main. Backend contracts can be refined by main after integration.

## UI ownership boundaries
Each W task writes self-contained exported React client components in its assigned file and optional co-located .module.css only. Props may be optional with clearly labelled synthetic defaults. Do not import other agents' unfinished code; main wires components. Use existing CSS variables, lucide-react, React and standard web APIs only. No new packages without reporting request to main. Screen widgets must be keyboard accessible. Simulated state must say demo/local only. Root CSS/shell edits assigned explicitly only to W1/W2. No buttons falsely claiming server persistence.

## ML
ml/smarttrack_ml package; no real data supplied. K5 owns features.py with extract_features(record, previous=None) -> dict of derived features and evidence, tests. K6 owns model.py (training, held-out calibration, OneClassSVM/IsolationForest), scoring.py and training CLI; coordinate with features contract via documented adapter. K7 owns service.py (FastAPI authenticated endpoint, bounded requests, safe trusted artifacts, ML unavailable default), pyproject.toml/requirements.txt, tests and demo data generator. Core inference API accepts telemetry record and previous record. Model artifact must explicitly be evaluated/promoted; synthetic models cannot produce production scores. Scores are reliability indices, not safety probabilities.

## Firmware
firmware PlatformIO Arduino ESP32-S3. K8 owns platformio.ini, include/config.h, src/main.cpp, sensors and integration. K9 owns queue and wire headers/source (CRC32 over exact payload, append-only SD queue, exact ack only); K10 owns modem headers/source, TLS fail-closed transport. Unspecified microSD CS and modem PWRKEY must be disabled compile-time (-1); no guessed wiring. GPS RX6/TX7; I2C17/18; TFT SPI12/11/13 CS10 DC9 RST8; touch CS14 IRQ15; BL5 via transistor; power4 SOS1 user2 peripheral21 active low P-FET. UART modem RX48 TX47 RESERVED; modem off by default. PDF's TPS22918 is NOT pin/control-equivalent to active-low P-FET. Bare modem UART voltage, PWRKEY timing, GPIO48 board LED and regulator thermal capability require exact board validation.

D tasks implement independent display headers only using firmware/include/ui/types.h. These are 320x240 display pages, not presentation slides. No allocation, waits, transport calls or fabricated readings in paint methods. D1 renderer/catalog integrates D2-D10. Main connects renderer to firmware. Offline roads require supplied licensed map data; never represent a route line as a road map.

## Acceptance and tests
User can navigate accessible interactive demo sections with clear demo banner; real production mode cannot show synthetic data as live. Missing ML displays unavailable. Device retries preserve identity, SOS operates without GPS/ML, authorization is enforced on server with tenant scoping and audit history. Vercel deployment is documented with external Postgres/ML/push/routing dependencies and no local JSON persistence. All 10 final verification rounds get actual command receipts, failures and blocked external gates in docs/VERIFICATION.md.
