# Deploy to your own Vercel account

This application is live at **https://smarttrackwebapp.vercel.app** as of
2026-11-05. This working copy is linked to `smarttrackwebapp` in the signed-in
`muppallagowtham123-3987` Vercel scope, using Node.js 24 on Hobby.
Run `npx vercel --prod` here to deploy later changes to the same project.
See [the deployment receipt](VERCEL_DEPLOYMENT.md) for verification and service status.

The current deployment sets `SMARTTRACK_PUBLIC_LIVE=1`: normal visitors receive
the configured infoesp telemetry automatically on the dashboard, map and other
sensor views. No private device URL is required. For a private installation,
leave that flag unset and use the viewer link described in the device guide.

The source package runs Next.js 15 / React 19. Local `.vercel` and `.env*` files
are excluded from uploads. When transferring a portable copy, exclude those
files and choose your own account, project and domain using the instructions below.

## Browser workflow

1. Download `smarttrackwebapp.zip` from the shared file server if you want a copy
   on your computer, then extract it. Browser editing/execution on the shared
   server itself does not require a download.
2. Put the extracted source in a repository you own on GitHub, GitLab or
   Bitbucket. Keep `.gitignore`; do not add real `.env` files or `.local` data.
   GitHub's web upload can be used for this small source package.
3. Sign in to **your** account at https://vercel.com/new and import that repository.
4. Select Next.js. Set Root Directory to the folder containing `package.json`
   (the repository root if you uploaded the folder's contents). Use Node.js 22
   or 24. The included `vercel.json` supplies install and build commands.
5. Deploy. Open `/journeys` on your new domain and select two locations.

The live map, online place search and road planning require no secret environment
variables. External OpenFreeMap, Photon, OSRM, Open-Meteo and optional terrain
services need an internet connection and can be temporarily unavailable.

## CLI workflow on your own computer

From the extracted folder:

```sh
npm ci
npm run build
npx vercel login
npx vercel
npx vercel --prod
```

Choose your own scope/team and create a **new** Vercel project when prompted.
Do not link to the original `smarttrack-web` project. Your CLI creates a local
`.vercel` binding for your project; keep it out of shared exports.

The shared server's command runner uses the host Windows account. Its existing
Vercel login belongs to the host. Use your own computer or the Vercel dashboard
for your account login and deployments; the server console remains available
for source editing, dependency installation, build and test commands.

## Optional configuration

Add only the services you intend to use in Vercel → Project → Settings →
Environment Variables, then redeploy. For local development, copy `.env.example`
to `.env.local` and fill your own values. Blank optional values are intentional.

| Variable | Purpose |
| --- | --- |
| `SMARTTRACK_VIEWER_SECRET` | Your own random 32–256 character URL-safe viewer token for private `/api/live` |
| `SMARTTRACK_RELAY_SECRET` | Separate random relay credential; must match your relay server |
| `SMARTTRACK_LIVE_RELAY_URL` | Your private relay's HTTPS origin, with no path/query/fragment |
| `SUPABASE_URL` | Your Supabase project HTTPS origin |
| `SUPABASE_ANON_KEY` | Your Supabase anonymous/public API key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only key for the optional database backend |
| `APP_ORIGIN` | Exact origin of your app, such as `https://your-project.vercel.app` |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser auth project URL, if enabling login |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Browser public auth key, if enabling login |
| `SMARTTRACK_ML_URL` | Optional separately hosted ML service HTTPS URL |
| `SMARTTRACK_ML_SHARED_SECRET` | Private ML service credential |

Never prefix private viewer, relay, service-role or ML secrets with `NEXT_PUBLIC_`.
Generate your own unrelated viewer/relay values and share the viewer link only
with intended viewers. See [device setup](LIVE_USB.md).

For optional durable data and auth, use your own Supabase project and review
`database/schema.sql` and `docs/SUPABASE.md`. The device relay feed is separate
from database ingestion. Protected APIs fail closed when their services are absent.
Deploy Python ML separately; only a real, evaluated and promoted model may be used
for production inference. Vercel does not host a persistent serial reader or ML
worker and does not provide durable local JSON storage.

## Verify your deployment

Open `/map`, `/journeys` and `/navigation`. Search names, select endpoints, choose
a road route and check distance/ETA. With no device, Navigation waits for GPS.
With your own real device, verify freshness, start/arrival and deviation behavior.

Optional real-provider smoke check (public sample coordinates, no device token):

```powershell
$env:BASE_URL='https://your-project.vercel.app'
node tests/public-planning-smoke.cjs
```

```sh
BASE_URL=https://your-project.vercel.app node tests/public-planning-smoke.cjs
```
