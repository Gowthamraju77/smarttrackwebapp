# Contact details and scheduled updates

SmartTrack asks for a name, international phone number and email before opening
the workspace. These are contact labels, without password, OTP or verification.
This browser remembers the contact and preferences. The private device link
still controls access to remote device data.

Settings and Alerts offer separate general and journey schedules: **20 minutes,
30 minutes, 1 hour, 3 hours, 5 hours, 10 hours and 24 hours**. Journey and Navigation
also show journey controls. Both switches start off. Enabling one requests email
and SMS together. Journey timing applies while armed or active; finish, arrival
or cancellation resumes general timing. Changing the active mode or interval
starts a full new interval. Devices and Team show self-reported connection names;
other visitors never receive phone numbers or email addresses.

## Enable delivery

1. Apply `database/notifications.sql` in Supabase SQL editor. It is a standalone,
   re-runnable migration with RLS and service-only RPCs.
2. Set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SMARTTRACK_VIEWER_SECRET`
   and `APP_ORIGIN` (the exact deployed origin). Use the existing device viewer secret.
3. Set `RESEND_API_KEY` and `SMARTTRACK_EMAIL_FROM` to your Resend credentials
   and a sender on your verified sending domain.
4. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` to your
   Twilio account and SMS-capable sender. Use E.164 numbers and enable recipient
   destinations on your provider account.
5. Set `CRON_SECRET` to a random secret of 32–256 characters. Configure an
   external scheduler to GET `/api/notifications/dispatch` every minute with
   `Authorization: Bearer <CRON_SECRET>`. The default `vercel.json` supports
   Vercel Hobby, which does not offer minute-level Cron Jobs. On a Vercel plan
   that supports them, add the following property to `vercel.json` instead:
   `"crons": [{ "path": "/api/notifications/dispatch", "schedule": "* * * * *" }]`.
6. Open the private device link, enter your contact, choose timing and enable
   updates. Wait for successful sync. The first notification is due after the
   selected interval; no immediate message is sent.

Missing services are disclosed in the UI; the scheduler fails closed without
consuming due work. Provider configuration and provider acceptance are separate.
No credentials are bundled and no live emails/SMS were used in local tests.

## Timing and limits

The database schedule continues when the browser closes. Reopening this browser
retains its contact capability to manage or disable the same schedule. Keep the
journey tab open for GPS-driven phase changes to sync. If closed, the last synced
mode continues; **Resume general timing** is offered when no active journey is
loaded. Clearing browser storage loses the contact capability; an operator can
delete the matching `smarttrack_contacts` row to stop that schedule.

Jobs run at or after their due time, subject to the one-minute scheduler and
provider delays. Heartbeats preserve due times. Late workers skip missed
intervals and create one check-in per channel, avoiding catch-up floods. A worker
handles five due contacts / ten channel jobs per invocation; larger deployments
need more worker capacity. The registry permits 100 contacts per device scope.
Rotating the viewer secret stops processing the old scope; clear the old browser
contact and re-register to use a new scope.

SQL locks and unique jobs prevent duplicate claims. Profile and schedule changes
invalidate pending jobs; the worker rechecks before sending. A send already in
progress can finish after disabling. Older requests cannot overwrite a newer save.
Resend receives a per-job idempotency key. Timeouts, interrupted workers, invalid
success responses and provider server errors become **unconfirmed** and are not
automatically retried, preventing duplicate SMS after ambiguous acceptance.
Explicit rejection becomes failed. Future scheduled intervals still proceed.
Accepted means accepted by the provider, not confirmed inbox/phone delivery.
Provider webhooks and automatic retries are not included.

Messages include the schedule mode and timestamped last browser connection
report. They explicitly distinguish this from current GPS data. No coordinates
or invented live readings are sent. Connection names refresh each minute and
become historical after 150 seconds without a report.

## Local checks

```powershell
npm run typecheck
npm run build
node --test tests/notifications.test.mjs tests/notifications-database.test.mjs tests/journey.test.mjs tests/live-telemetry.test.mjs
npm run start -- --hostname 127.0.0.1 --port 3104
# In another terminal:
node tests/notifications-browser.cjs
node tests/journey-browser-smoke.cjs
node tests/section-transitions-browser.cjs
```

Database tests execute PostgreSQL statements in PGlite. For local verification it
was installed outside the repo with `npm install --prefix "$env:TEMP/smarttrack-notification-tools" --no-audit --no-fund --ignore-scripts @electric-sql/pglite`.
Override `SMARTTRACK_PGLITE_PATH` with the package directory if needed. Browser
tests use the existing temporary Playwright installation or
`SMARTTRACK_PLAYWRIGHT_PATH`. All contacts, locations and provider fixtures are synthetic.
