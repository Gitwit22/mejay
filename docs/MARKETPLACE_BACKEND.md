# Marketplace Backend

The marketplace backend and Artist Portal release wizard live in the Node API, Neon PostgreSQL database, and React application.

## Migrations

From `api/`:

```bash
npm run build
npm run db:migrate
```

The runner records ordered migration versions and SHA-256 checksums in `schema_migrations`. Each migration is transactional and guarded by a PostgreSQL advisory lock. Applied migration files must never be edited; production fixes use a new forward migration.

## Ownership and roles

Every catalog record belongs to one `provider_profile`. A user belongs to one provider with role `owner`, `admin`, `editor`, or `viewer`; the first three roles may mutate catalog data.

Customer-facing screens call this an Artist Account and use `/app/artist` and `/app/artist/onboarding`. The database and API retain the `provider` name because an `artists` table already represents catalog identities.

## Artist account access

Artist Account conversion and provider-owned marketplace writes require a Stripe subscription with both:

- `stripe_subscription_id` present
- `subscription_status` equal to `active` or `trialing`

Free accounts, Full Program ownership by itself, and `past_due`, `unpaid`, or `canceled` subscriptions do not unlock the Artist Portal. Full Program owners may add Pro without losing permanent Full Program access. Subscription updates continue to refresh the Pro subscription fields while preserving their Full Program `access_type` and `has_full_access` values.

An authenticated consumer converts through:

```text
POST /api/account/artist
```

The endpoint accepts no user ID. It derives the caller from `mejay_session`, checks Pro on the server, changes `users.account_intent` to `provider`, and idempotently creates the provider profile and owner membership. A nonqualifying account receives `403 pro_subscription_required`.

Artist-intent signup and the `Become an Artist` action start Pro checkout first. After Stripe verification succeeds, the browser calls the conversion endpoint and opens `/app/artist/onboarding`. Direct Artist route visits use the server-derived `artistPortalAccess` value from `GET /api/account/me`.

If Pro later lapses, the account intent, provider profile, catalog, and audit history remain intact. Artist routes and provider-owned mutations are locked until Pro becomes active again. Marketplace reviewer/admin transitions remain role-based and do not require the staff member to purchase Pro.

Marketplace review is independent. Provision a reviewer or administrator only through a trusted database operation:

```sql
INSERT INTO marketplace_staff (user_id, role)
VALUES ('USER_UUID', 'reviewer')
ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
```

A staff user who belongs to the release's provider cannot review that release.

## Creation API

All endpoints require the `mejay_session` cookie and JSON request bodies.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| POST | `/api/account/artist` | Convert the current active-Pro consumer into an Artist Account |
| POST | `/api/marketplace/providers` | Bootstrap and complete the current user's provider profile |
| POST | `/api/marketplace/artists` | Create an artist |
| POST | `/api/marketplace/releases` | Create a draft release and primary artist credit |
| GET | `/api/marketplace/releases/:releaseId` | Read a provider-scoped release draft, tracks, and assets |
| PATCH | `/api/marketplace/releases/:releaseId` | Save release information and wizard progress with optimistic versioning |
| POST | `/api/marketplace/releases/:releaseId/tracks` | Create a track and primary artist credit |
| PATCH | `/api/marketplace/tracks/:trackId` | Save track metadata |
| POST | `/api/marketplace/uploads` | Create a pending asset and five-minute private R2 PUT URL |
| POST | `/api/marketplace/uploads/finalize` | Verify the private R2 object and mark the asset ready |
| POST | `/api/marketplace/assets` | Register existing artwork or audio storage metadata |
| POST | `/api/marketplace/rights-declarations` | Affirm release distribution or track master/composition rights |
| POST | `/api/marketplace/tracks/:trackId/isrc-assignments` | Assign a normalized ISRC |
| POST | `/api/marketplace/tracks/:trackId/isrc-assignments/generated` | Atomically assign the next MEJay QTA3L ISRC |
| POST | `/api/marketplace/products` | Create a release or track product |
| POST | `/api/marketplace/products/:productId/prices` | Add an effective-dated price in minor currency units |
| PUT | `/api/marketplace/tracks/:trackId/revenue-splits` | Atomically replace the track's complete split set |
| POST | `/api/marketplace/releases/:releaseId/transitions` | Move a release to one adjacent state |

Successful creation responses use `{ "ok": true, "data": ... }`. Errors use stable codes with HTTP `400`, `401`, `403`, `404`, `409`, or `422`.

Revenue shares use integer basis points and must total exactly `10000`. Products target exactly one release or track. Artwork targets releases; audio targets tracks.

Browser uploads go directly to private R2 through a short-lived presigned PUT URL. The API generates every `marketplace/` object key and verifies MIME type and byte size with R2 before marking an asset ready. Artwork accepts square JPEG, PNG, or WebP files of at least 3000 x 3000 and at most 20 MB. Audio accepts WAV or FLAC files up to 500 MB.

Generated ISRCs require the exact environment configuration `ISRC_PREFIX=QTA3L`, `ISRC_COUNTRY_CODE=QT`, and `ISRC_REGISTRANT_CODE=A3L`. Allocation is atomic and year-scoped from `00001` through `99999`. Canonical values are stored without separators, while the portal displays `QT-A3L-YY-NNNNN`. Registry rows are permanent; account deletion removes their user/provider provenance but retains the assigned code and original track identifier.

## Release workflow

```text
DRAFT -> METADATA_COMPLETE -> RIGHTS_COMPLETE -> ISRC_COMPLETE
      -> PRICING_COMPLETE -> SUBMITTED -> UNDER_REVIEW -> APPROVED
      -> SCHEDULED -> LIVE
```

`APPROVED` may move directly to `LIVE`. All other transitions are adjacent, forward-only, and use `expectedVersion` for optimistic concurrency.
Release-owned tracks, assets, rights, ISRCs, products, prices, and splits are locked once the release reaches `SUBMITTED`.

| Target | Required state |
| --- | --- |
| `METADATA_COMPLETE` | Required release metadata, primary artist, one or more tracks, ready release artwork, ready audio for every track |
| `RIGHTS_COMPLETE` | Distribution rights total 10000 bps; master and composition rights each total 10000 bps for every track |
| `ISRC_COMPLETE` | Every track has one active, globally unique ISRC |
| `PRICING_COMPLETE` | Active release product priced at least $1.00 USD, completed Stripe payout setup, and active 10000-bps split set for every track |
| `SUBMITTED` | All prior prerequisites are rechecked |
| `UNDER_REVIEW`, `APPROVED` | Separate marketplace reviewer/admin |
| `SCHEDULED` | Future `scheduled_release_at` |
| `LIVE` | No future schedule remains; the $1.00 USD minimum and Stripe payout readiness are rechecked |

Every successful mutation and transition writes an append-only `marketplace_audit_events` row in the same transaction.

## Public catalog

The consumer Marketplace reads directly from the publishing catalog:

| Endpoint | Purpose |
| --- | --- |
| `GET /api/store/releases` | Public discovery list |
| `GET /api/store/releases/:releaseId` | Release and track details |
| `GET /api/store/assets/:assetId` | LIVE-gated artwork or bounded audio preview |
| `POST /api/store/previews` | Record a validated preview start |
| `GET /api/music/discovery` | MEJay Music overview feeds |
| `PUT /api/marketplace-admin/discovery/features` | Replace ordered featured releases and artists |

List, detail, and media queries independently require `releases.status = 'LIVE'`. Publishing an approved release therefore makes it appear automatically, while unpublishing or taking it down removes both catalog metadata and future media access. Store assets remain private in R2 and are streamed with `Cache-Control: private, no-store`; audio responses are limited to the first 5 MB of the uploaded master.

Catalog purchases use authenticated Stripe Checkout sessions that are separate from plan billing. Verified Stripe webhooks create the Neon order, immutable ledger entries, equal-per-track payee allocations, and download entitlement. MEJay retains 10% of gross and transfers the remaining provider proceeds to the provider's Stripe Connect Express account using separate charges and transfers.

## Music discovery

MEJay Music is the editorial discovery surface; Marketplace remains the transactional search, pricing, and purchase surface. `GET /api/music/discovery` returns newest releases, newest singles, newest EP/album projects, most purchased, most previewed, ordered featured releases, and ordered featured artists.

All discovery queries independently require `releases.status = 'LIVE'`. New feeds order by `published_at DESC`. Most Purchased counts order items attached to paid or partially refunded orders, while Most Previewed counts validated preview-start events. Zero-activity releases are excluded from Trending, and publication date breaks ties. These rankings are global and intentionally do not use personalization or AI recommendations.

The client records a preview only after audio playback starts successfully. `POST /api/store/previews` verifies that the requested asset is ready audio attached to a LIVE release; raw asset range requests are not counted because browsers may issue several requests for one listen.

Marketplace admins maintain ordered release and artist picks through one atomic replacement command. Reviewers can inspect curation but cannot change it. Featured releases that cease to be LIVE and artists without a LIVE release are omitted from public results. Until artists have dedicated profile imagery, Featured Artists use artwork from their latest LIVE release.

Publishing does not insert or synchronize feed rows. The existing atomic transition to `LIVE` sets `published_at` and activates the product; both Store and Music read that same state on their next no-store request. Unpublish and takedown transitions therefore remove releases from both surfaces without a second write path.

Providers connect Stripe from the Provider Portal. Every uploaded release is a paid marketplace release: its active USD price must be at least $1.00, and submission/publication is blocked until Stripe reports submitted details, enabled payouts, and an active transfers capability. Full refunds revoke downloads and reverse the provider transfer; open disputes suspend downloads until Stripe resolves them.

Purchased source files remain private in R2. `GET /api/store/purchases/:entitlementId/files/:fileId/download` requires the owning session and an active entitlement, supports byte ranges, and never exposes the storage key. Sprint 4 temporarily fulfills the original WAV/FLAC upload; standardized consumer derivatives are deferred.

## Sales and earnings reporting

Authenticated reporting is available through:

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /api/marketplace/reporting?range=30d` | Provider member | Provider sales, earnings, downloads, refunds, and split liabilities |
| `GET /api/marketplace/recipient-earnings?range=30d` | Any authenticated account | Split allocations matching the account's normalized email |

Supported ranges are `7d`, `30d`, `90d`, `ytd`, and `all`; the default is `30d`. Bounded ranges start at 00:00 UTC and include the current day. The range selects a cohort by sale date, and every financial metric reports the current reconciliation state of those sales. Sales by Day uses UTC dates and zero-fills days without activity.

Provider reports define their summary metrics as follows:

- **Gross Sales** is completed-order gross before refunds.
- **Units Sold** is the order-item count. Refunded units remain sold and are reconciled through Refunds.
- **Your Earnings** is provider proceeds after provider-side refunds and lost disputes.
- **Pending** is net provider earnings attached to pending or failed transfers, excluding open and lost disputes.
- **Paid Out** is the amount transferred to the provider's Stripe Connect account. Reversed transfers count as zero.
- **Downloads** counts successful private-file download events, not entitlements or attempts.
- **Refunds** reports refund totals and order status separately from gross sales.

Top Songs, Sales by Release, Sales by Day, Sales by Territory, Downloads, and Refunds all derive from immutable order, order-item, allocation, and download records scoped to the provider. Migration 9 stores the Stripe billing country on each fulfilled order, falling back to the payment card country. Territory is an uppercase ISO alpha-2 code; unavailable values are grouped as `Unknown`.

Money calculations use integer USD minor units. Partial refunds use the same platform/provider apportionment as webhook fulfillment. Recipient allocations are then reconciled with deterministic largest-remainder rounding so their adjusted amounts exactly equal provider proceeds. Open disputes remove amounts from Pending while unresolved; lost disputes reduce earnings to zero. Provider transfer totals and refund adjustments remain separately visible.

Recipient access does not require Artist Pro. `/app/earnings` matches `LOWER(marketplace_split_allocations.payee_email)` to the authenticated account's canonical email and returns only that email's rows. It never exposes buyer details, Stripe identifiers, or other recipients. Recipient **Owed** means the provider owes the collaborator after refund adjustments; a Stripe transfer to the provider does not mean MEJay paid individual split recipients.

## Minimal payloads

```json
POST /api/marketplace/providers
{"displayName":"Example Records","slug":"example-records","contactEmail":"ops@example.com","countryCode":"US"}
```

```json
POST /api/marketplace/artists
{"name":"Example Artist","countryCode":"US"}
```

```json
POST /api/marketplace/releases
{"title":"Example Release","releaseType":"single","primaryArtistId":"ARTIST_ID"}
```

```json
POST /api/marketplace/releases/RELEASE_ID/tracks
{"title":"Example Track","primaryArtistId":"ARTIST_ID","trackNumber":1,"durationMs":180000}
```

```json
POST /api/marketplace/assets
{"releaseId":"RELEASE_ID","kind":"artwork","storageKey":"marketplace/artwork/key","mimeType":"image/jpeg","byteSize":120000}
```

```json
POST /api/marketplace/assets
{"trackId":"TRACK_ID","kind":"audio","storageKey":"marketplace/audio/key","mimeType":"audio/wav","byteSize":24000000}
```

```json
POST /api/marketplace/rights-declarations
{"releaseId":"RELEASE_ID","declarationType":"distribution","rightsHolder":"Example Records","ownershipBps":10000}
```

Create equivalent `master` and `composition` declarations against each `trackId`.

```json
POST /api/marketplace/tracks/TRACK_ID/isrc-assignments
{"isrc":"US-ABC-26-12345"}
```

```json
POST /api/marketplace/products
{"releaseId":"RELEASE_ID","name":"Example Release Download"}
```

```json
POST /api/marketplace/products/PRODUCT_ID/prices
{"amountMinor":999,"currency":"USD"}
```

```json
PUT /api/marketplace/tracks/TRACK_ID/revenue-splits
{"entries":[{"payeeName":"Artist","shareBps":7000},{"payeeName":"Label","shareBps":3000}]}
```

```json
POST /api/marketplace/releases/RELEASE_ID/transitions
{"targetStatus":"METADATA_COMPLETE","expectedVersion":1}
```

Use the returned release `version` for the next transition.

## Verification

```bash
cd api
npm run typecheck
npm test
npm run build
```

For deployment-equivalent validation, set `TEST_DATABASE_URL` to an isolated Neon branch and run:

```bash
npm run test:integration
npm run db:migrate
```

The integration test creates and drops an isolated PostgreSQL schema, then proves the full provider, artist, release, track, asset, rights, ISRC, product, price, split, review, and publication flow. Never point destructive test setup at production.
