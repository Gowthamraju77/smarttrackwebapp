# Supabase operator notes

Apply `database/schema.sql` as a migration to a new project. The schema
contains organization memberships, device-token hashes, telemetry and SOS
records, audit events, alerts, and RLS policies. The device ingest RPC is a
security-definer transaction that locks the device row and returns an
idempotent `{accepted, record_id, duplicate}` receipt.

Use the authenticated user's bearer token for read APIs so RLS remains the
authorization boundary. Keep the service-role key only in server deployment
secrets; it is used for the device RPC because devices do not have Supabase
user sessions. Do not test this with a real user's location data until two
organization-isolation tests and SOS role-transition tests pass in a
disposable project.
