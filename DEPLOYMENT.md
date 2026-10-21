# MEJay deployment

MEJay is split into two deployable services:

- The repository root is the React/Vite frontend deployed to Cloudflare Pages.
- `api/` is the Express API deployed to Render as `mejay-api`.
- Neon PostgreSQL stores accounts, sessions, and entitlements.
- Cloudflare R2 stores the Full Program download.

## Cloudflare Pages

Configure the Pages project with:

- Build command: `npm run build`
- Build output directory: `dist`
- Environment variable: `VITE_API_URL=https://api-staging.mejayapp.com`
- Optional runtime flag: `VITE_USE_SAME_ORIGIN_API=1` when another Pages origin should also use a same-origin `/api/*` proxy.

On `mejay2.pages.dev`, the frontend uses the `/api/*` Pages Function proxy so session cookies remain first-party. The proxy targets `https://mejay-api.onrender.com` by default; set the Pages runtime variable `API_ORIGIN` to override it. `public/_routes.json` keeps `/api/*` on the Pages Function path, and `public/_redirects` continues to provide SPA routing for app paths such as `/app/provider`.

## Render

Create the service from `render.yaml`, or use these settings:

- Name: `mejay-api`
- Root directory: `api`
- Build command: `npm install && npm run build`
- Pre-deploy command: `npm run db:migrate`
- Start command: `npm start`
- Health check: `/api/health`

Set `DATABASE_URL` to the Neon pooled PostgreSQL connection string. Configure the remaining secrets listed in `api/.env.example` in Render.

For cookie authentication, `FRONTEND_URL` must exactly match the Pages origin. Multiple allowed origins can be comma-separated.

### Security-relevant settings

- `API_PROXY_SECRET`: set the same long random value on Render **and** as a Pages runtime variable. The Pages proxy then forwards the edge-verified client IP, which the API uses for login/code rate limiting. Without it the API falls back to the `cf-connecting-ip` header, which callers hitting Render directly can spoof.
- `ALLOW_DEV_ENDPOINTS` must be `false` in production. Dev behaviour (returning login codes in responses, debug error detail) is enabled only when `NODE_ENV` is not `production` or this flag is `true`; it is never inferred from the request host.
- Dev admin (`/api/dev-admin/*`) requires **both** `ALLOW_DEV_ADMIN=true` and a non-empty `DEV_ADMIN_EMAILS` allowlist in every environment.
- `ALLOW_FULL_PROGRAM_CHECKOUT` (API) and `VITE_ENABLE_FULL_PROGRAM_CHECKOUT` (frontend) must agree.
- Stripe webhooks: create **two** endpoints, both pointing at `https://<api-host>/api/stripe-webhook`. Each one has its own signing secret.
  - **Your account** endpoint (secret in `STRIPE_WEBHOOK_SECRET`): `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.closed`.
  - **Connected accounts** endpoint (secret in `STRIPE_CONNECT_WEBHOOK_SECRET`): `account.updated`, `capability.updated` and `payout.failed`. These events never reach the "Your account" endpoint.
  - Each secret only authorizes its own endpoint's events: a payload signed with the Connect secret can only sync a connected account (and must name it in `event.account`), and one signed with the platform secret can never change a connected account. Anything else is acknowledged and ignored.
- Artist and marketplace uploads (photos, cutouts, artwork, audio, rights documents) are stored in the private R2 bucket (`R2_BUCKET_NAME`, e.g. `mejay-downloads`) under the `mejay-artist/` prefix. Uploads are browser-direct to signed URLs, so the bucket's CORS policy must allow `PUT` from the frontend origin. Older keys under `marketplace/` remain readable.
- Purchase confirmation emails go through Resend (`RESEND_API_KEY`, `RESEND_FROM`) once per order after a verified webhook fulfills it, with an optional `SUPPORT_EMAIL` used as reply-to. They link to the signed-in Purchases page and never carry files or download links; a send failure is logged and recorded in `marketplace_order_notifications` but never fails the order.
  - Transfers to artists are created synchronously with `source_transaction`; a rejected transfer is recorded as a `transfer_failed` incident and retried by the transfer job. `transfer.failed` is not a current Stripe event type and does not need to be subscribed.
  - Events whose `livemode` differs from the `STRIPE_SECRET_KEY` mode are acknowledged and ignored, so test events can never change live records.
- Marketplace pricing: MEJay keeps `MARKETPLACE_PLATFORM_FEE_BPS` of each store sale (default `1000` = 10%); the artist's share also covers Stripe's processing fee. Releases must be priced at least $3.00; set `MINIMUM_TRACK_PRICE_CENTS` to change that (minimum `100`). If Render has `MARKETPLACE_PLATFORM_FEE_BPS` set explicitly, that value overrides the default. Past orders keep the rate they were sold at (`marketplace_orders.platform_fee_bps`).
- Pro checkout grants a 3-day trial (`subscription_data[trial_period_days]`) only to accounts that have never had a subscription.

## Audio converter (proof of concept)

`mejay-converter` is a separate free Render web service (same repo, `rootDir: api`, build `npm install && npm run install:converter-tools && npm run build`, start `npm run start:converter`). Its ffmpeg/ffprobe binaries are installed only there, so `mejay-api` builds are unchanged. It turns an uploaded WAV/FLAC master into a tagged 320 kbps MP3 with embedded cover art plus a 10 s store preview clip (starting where the artist chose, fading in and out), verifies both (full decode, duration, tags, cover, and a checksum round trip through R2), and records them as `audio_delivery` / `audio_preview` assets. Conversions never run on `mejay-api`.

- Env: `DATABASE_URL`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `CONVERTER_TRIGGER_SECRET` (32+ random characters). It does not need the API's Stripe/session secrets.
- Jobs live in `audio_processing_jobs`. One job at a time; leases (10 min, renewed every minute) let an interrupted run be picked up again; failures retry with 1/2/4-minute backoff and stop after 3 attempts. The uploaded master is never modified.
- Store previews: the public store only ever plays these clips, never the master. `mejay-api` queues a clip for every new upload or changed preview start on its scheduled-publish interval and, when `CONVERTER_URL` (the converter's https URL) and `CONVERTER_TRIGGER_SECRET` (same value as on the converter) are set on `mejay-api`, wakes the converter. Without them, clips are still made whenever the converter is awake.
- API (all but `/health` need `Authorization: Bearer $CONVERTER_TRIGGER_SECRET`): `POST /jobs {"sourceAssetId"}` queues a ready `audio` upload; `POST /jobs/run` drains the queue; `GET /jobs/:id` returns status, audio facts and 10-minute download links.
- Free plan: the instance sleeps after ~15 minutes idle and wakes on the next request (about a minute); queued or interrupted jobs resume on boot.

## Local development

Start the API and frontend in separate terminals:

```powershell
Set-Location api
Copy-Item .env.example .env
npm install
npm run db:migrate
npm run dev
```

```powershell
npm install
npm run dev
```

Vite proxies `/api` to `http://localhost:4000` by default. Override it with `VITE_API_PROXY_TARGET` when needed.