# Deployment runbook

## Services and boundaries

Deploy the Next.js application to Vercel. Use a managed Supabase project for
Auth and Postgres; apply `database/schema.sql` through a reviewed migration.
Deploy `ml/smarttrack_ml/service.py` as a separate Python service with a
private HTTPS URL. Vercel serverless functions do not provide durable local
files, background workers, or a reliable Python model process.

## Vercel configuration

1. Import the repository into Vercel and select the Next.js preset.
2. Use `npm ci` for the install command and `npm run build` for the build.
3. Configure the variables in `.env.example` in the Vercel project settings.
   `SUPABASE_SERVICE_ROLE_KEY` and `SMARTTRACK_ML_SHARED_SECRET` must be
   server-only variables; never prefix them with `NEXT_PUBLIC_`.
4. Set `APP_ORIGIN` to the exact HTTPS origin used by the deployed app.
5. Redeploy after environment changes and verify that unconfigured or invalid
   upstream services return a safe error rather than demo data.

## Supabase setup

Create a new project, apply the SQL migration, configure Auth redirect URLs,
and create an owner membership for a test user. Device credentials are stored
as SHA-256 hashes; provision a token through an authorized administrative
process and do not put it in source control. Verify RLS with two disposable
users from different organizations before any real location data is used.

## ML release gate

Train on consented, representative real journeys outside this repository.
Keep train and calibration groups separated. Inspect held-out evaluation,
pin the artifact SHA-256 digest, and explicitly promote only an evaluated
`provenance=real` artifact. A synthetic artifact must never become a
production Trust Score. Run the service behind HTTPS with
`SMARTTRACK_ML_SHARED_SECRET` and restrict ingress to the backend.

Example local service command after installing the reviewed `ml` manifest:

```powershell
uvicorn smarttrack_ml.service:app --host 0.0.0.0 --port 8000
```

## External dependencies still required

Live maps/roads, routing, browser push, SMS/email, and physical modem
delivery need separately selected providers, credentials, consent, and
failure testing. They are not silently replaced by the demo UI.
