# Marketplace Backend

Sprint 0 lives in the Node API and Neon PostgreSQL database. The marketplace UI is intentionally not connected yet.

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
| POST | `/api/marketplace/releases/:releaseId/tracks` | Create a track and primary artist credit |
| POST | `/api/marketplace/assets` | Register existing artwork or audio storage metadata |
| POST | `/api/marketplace/rights-declarations` | Affirm release distribution or track master/composition rights |
| POST | `/api/marketplace/tracks/:trackId/isrc-assignments` | Assign a normalized ISRC |
| POST | `/api/marketplace/products` | Create a release or track product |
| POST | `/api/marketplace/products/:productId/prices` | Add an effective-dated price in minor currency units |
| PUT | `/api/marketplace/tracks/:trackId/revenue-splits` | Atomically replace the track's complete split set |
| POST | `/api/marketplace/releases/:releaseId/transitions` | Move a release to one adjacent state |

Successful creation responses use `{ "ok": true, "data": ... }`. Errors use stable codes with HTTP `400`, `401`, `403`, `404`, `409`, or `422`.

Revenue shares use integer basis points and must total exactly `10000`. Products target exactly one release or track. Artwork targets releases; audio targets tracks. Asset endpoints register storage references and do not upload bytes.

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
| `PRICING_COMPLETE` | Active release product/current price and active 10000-bps split set for every track |
| `SUBMITTED` | All prior prerequisites are rechecked |
| `UNDER_REVIEW`, `APPROVED` | Separate marketplace reviewer/admin |
| `SCHEDULED` | Future `scheduled_release_at` |
| `LIVE` | No future schedule remains |

Every successful mutation and transition writes an append-only `marketplace_audit_events` row in the same transaction.

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
