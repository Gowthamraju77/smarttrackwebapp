# SmartTrack database

`schema.sql` is the durable Supabase/Postgres schema for production data. Apply it
to a Supabase project before enabling the authenticated operations APIs.

`notifications.sql` adds the separate private-device contact registry and
scheduled email/SMS queue. Apply it when enabling the feature described in
[Notification setup](../docs/NOTIFICATIONS.md); its server RPCs also use the
service-role key.

## Configuration

The Next.js server requires `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and (only for
device ingestion) `SUPABASE_SERVICE_ROLE_KEY`. `APP_ORIGIN` must be the exact
HTTPS origin used by the application. Missing or invalid values make protected
routes return `503`; the application does not fall back to demo or local data.

Never put a service-role key in browser code, a device, a query string, or a
committed file. Device credentials are SHA-256 hashed before the ingest RPC.

## Tenant and roles

Every operational row carries `organization_id`. Supabase RLS permits reads only
for users with a membership in that organization. Roles are `owner`, `admin`,
`responder`, and `viewer`; all four may read operations. Only owner/admin/responder
may acknowledge or resolve an SOS. The `transition_sos` function checks the live
authenticated identity, locks the event, and inserts the state transition audit
row atomically. Resolution requires a prior acknowledgment and transitions are
monotonic.

## RPCs

- `ingest_device_record(p_token_hash, p_payload, p_kind)` is callable only by the
  server service role. It verifies the device hash and identity, updates
  `last_seen_at`, inserts telemetry/SOS data, creates an SOS alert, and returns
  `{accepted, record_id, duplicate}` for retries.
- `transition_sos(p_sos_id, p_action, p_actor)` is callable by authenticated
  users through their bearer token. It performs the locked acknowledge/resolve
  transition and audit insertion in one transaction.

Use a separate Supabase project for tests. No hosted database or credentials are
required by the static/type checks in this repository.

## Operations API contract

`GET /api/devices`, `/api/journeys`, and `/api/alerts` require a verified user
bearer token and the `organization_id` query parameter. They return `{data: []}`
with bounded `limit` (1–100) and `offset` pagination; optional filters are
tenant-scoped. Responses are `no-store` and vary on `Authorization`.

`POST` or `PATCH /api/sos/:id` accepts the exact JSON body
`{"action":"acknowledge"}` or `{"action":"resolve"}`, plus the same
`organization_id` query parameter. It requires an HTTPS same-origin request and
returns only the allowlisted event id, state, and duplicate receipt.
