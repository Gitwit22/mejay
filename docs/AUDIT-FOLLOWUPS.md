# Audit follow-ups (Medium / Low)

The October 2026 audit covered import, playback, plans and pricing, billing, auth and the marketplace. Every Critical and High finding is fixed on `mejay-cldfl-pages`. This list holds the remaining Medium and Low items. Each has a location, the failure scenario and a suggested fix. Line numbers are approximate and may drift.

## Pricing, billing and auth

| Sev | Where | Problem | Suggested fix |
| --- | --- | --- | --- |
| M | `src/stores/planStore.ts` (`readInitialBillingEnabled`, `hasFeature`) | Feature gating relies on client state. `mejay:billingEnabled=false` in localStorage switches billing off in production, and the cached `mejay:accessPlan` is trusted indefinitely when `/api/account/me` fails. | Apply the localhost guard at init. Treat cached plans as a hint and expire them. Enforce anything of value on the server. |
| M | `src/licensing/*`, `App.tsx` (`AppBillingBootstrap`) | The license HMAC secret is in the bundle, and `activateLicense` accepts any `MEJAY-…FULL…` key. Any stored token makes the app skip server entitlements. The UI is hidden, but the code path is live. | Remove it until licenses are server-signed with asymmetric keys. |
| M | `api/src/services/billing.ts` (`subscriptionGrantsPro`) | `past_due` removes Pro at once, during Stripe's retry window. | Add a grace period (for example, keep Pro until `current_period_end` + 3 days while `past_due`). This is a product decision. |
| M | `api/src/routes/billing/sync.ts`, `checkout-status.ts`, `stripe-webhook.ts` | There are three slightly different entitlement upserts. They are now aligned on "never downgrade Full Program and never orphan a subscription id", but they are still duplicated. | Move them into one shared helper in `services/billing.ts`. |
| M | `api/src/account/deletion.ts` | A Full Program owner with an active Pro subscription can delete the account while the subscription keeps billing. | Cancel the subscription in Stripe, or block deletion while any subscription is live. |
| L | `api/src/routes/checkout-status.ts` (~298) | A session with no `checkoutToken` can be read by anyone who has the `cs_` id. It only reveals status. | Require that the session belongs to the logged-in user. |
| L | `api/src/config/env.ts` | `COOKIE_SECURE` is validated but never used. The `Secure` flag follows the request protocol. | Use it, or remove it. |
| L | `api/src/routes/download/full-program.ts` | The hard-coded key `MOCK FULL PROGRAM.zip` is used unless `R2_DOWNLOAD_KEY` is set. | Confirm the production object key. |
| L | `api/src/routes/billing-portal.ts` | Raw Stripe error messages are returned to clients. | Log them on the server and return a generic message, as `/api/checkout` now does. |
| L | `PricingPage.tsx:~115`, `UpgradeModal.tsx:~70` | The copy says "Pro is monthly" next to a yearly toggle, and the modal always checks out monthly. | Pass the selected cadence and update the copy. |
| L | `migrations/*.sql`, `migrations/d1/*` | Leftover D1 SQL. Production uses Postgres migrations in `api/src/db/migrations`. | Delete the files or mark them as legacy. |

## Marketplace and store

| Sev | Where | Problem | Suggested fix |
| --- | --- | --- | --- |
| M | `commerce-service.ts` `createCheckout` | Two tabs can create two checkouts for the same product, giving two charges and two orders. | Before creating a new Checkout Session, reuse an open `checkout_created` attempt for the same buyer and product that has not expired. |
| M | `src/lib/providerApi.ts` `createProviderPricing` | The product and price are created in two calls. If the second fails, the step locks at "$0.00". | Create both in one transactional endpoint, and let the wizard add a price to an existing product. |
| M | `marketplace/service.ts` finalize (64 KB inspection) | JPEGs with large EXIF or ICC blocks before the SOF marker fail with `artwork_dimensions_missing`. | Read a larger window, or follow segment lengths with ranged reads. |
| M | `PurchasedMusicPage.tsx` | Purchased tracks never reach the DJ library or Party Mode. Users must download and re-import them by hand. | Add an "Add to My Music" action that fetches the authorized download and calls `importTracks`. |
| M | `routes/store/index.ts` artwork | Every card loads the original artwork, which can be up to 20 MB. | Generate thumbnails when the upload is finalized. Artwork now gets a short private cache. |
| M | `POST /api/store/previews` | Preview counts can be inflated without logging in, which games "Most Previewed". | Rate-limit per IP and asset, and dedupe within a time window. |
| M | `account/deletion.ts`, migrations `0006`/`0011` | `RESTRICT` foreign keys from checkout attempts and incidents cause a 500 for some providers who try to delete their account. R2 objects are never removed. | Change those foreign keys to `SET NULL` and delete the provider's R2 prefix. |
| M | Store previews | Previews are now capped at roughly 30 s and 20% of the file, but they are still slices of the lossless master. | Transcode a dedicated low-bitrate preview clip when the upload is finalized. |
| L | `admin-schemas.ts` `publish_due` / `schedule` | Nothing runs `publish_due`, so scheduled releases never go live. There is no UI for scheduling and no command to restore a takedown. | Add a job like the transfer retry, plus schedule and restore actions in the admin UI. |
| L | Marketplace Admin | Split-dispute recording has a backend but no UI. | Add a form. |
| L | `store-service.ts:~26` | The catalog preview picks `MIN(preview.id)`, which is an arbitrary UUID and can be an older upload. | Order by `created_at DESC`. |
| L | `PurchasedMusicPage.tsx` | Artwork breaks after a takedown because the public asset route requires `LIVE`. | Serve purchase artwork through an entitlement-checked route. |
| L | Connect onboarding | Only the `transfers` capability is requested, with no recipient service agreement. That likely fails outside the US. | Set `tos_acceptance[service_agreement]=recipient` for non-US accounts. |
| L | Revenue splits | Splits are reporting-only. The whole payout goes to the provider's Stripe account. | Document this for providers, or add per-payee transfers. |

## Playback and import

| Sev | Where | Problem | Suggested fix |
| --- | --- | --- | --- |
| M | `djStore.ts` (auto volume), `MixControls` | `autoVolume` and `advancedMixTiming` are gated in the plan table but never checked. Free users get volume matching. | Check `hasFeature('autoVolume')` in `ensureGainDbForTrack` and gate the controls. |
| M | `djStore.ts` `updateUserSettings` | Changing Target Loudness has no effect on tracks already imported. | Recompute `gainDb` from the stored `loudnessDb` when the target changes. |
| M | `djStore.ts` `playPreviousTrack` mid-mix branch | `mixInProgress` stays `true` until the 15 s safety reset. | Clear it at the end of that branch. |
| M | Start offset / end-early defaults | Tracks shorter than about 20 s are skipped instantly, because the start point is past the cutoff. | Clamp the start offset to at most 50% of the track. |
| M | `seedStarterTracksIfEmpty` | Only the Valentine pack is seeded. Choosing Party Pack shows the wrong toast, and a failed attempt blocks retry for the session. | Seed the selected packs and reset the session flag on failure. |
| M | Rendering | Components use `useDJStore()` without selectors, the store updates about 70 times a second, and `NowPlaying`/`PartyQueuePanel` are mounted twice. | Use selectors with `shallow`, throttle `currentTime` updates, and mount the panels once. |
| M | `ImportRoomView.tsx` vs `importTracks` | The UI accepts `.flac`/`.ogg`, but the store rejects them when there is no MIME type (iOS). The UI also rejects the whole batch if one file is bad. | Share one supported-format list and let the store skip bad files. |
| L | `djStore.ts` | `shouldShuffleUpcomingNow` is unused, so turning on shuffle mid-party does nothing. | Wire it up or remove it. |
| L | `PlaylistsView.tsx:129-363` | The playlist detail view is unreachable and contains a hook after an early return. | Remove it or route to it, and fix the hook order. |
| L | `moveTrackInParty` / `shufflePartyTracks` | `pendingNextIndex` is not remapped. Shuffling an empty queue inserts `undefined`. | Remap by track id and guard empty queues. |
| L | `addTrackToPlaylist` | Doesn't update the running queue when that playlist is playing. | Append to `partyTrackIds` when that playlist is the party source. |
| L | `createPlaylist` | Returns nothing, so callers look the playlist up by name. Duplicate names target the wrong playlist. | Return the new id. |
| L | Destructive actions | The trash button in the queue deletes the track from the library, and Library and playlist deletes don't ask for confirmation. | Add confirmations, and make the queue trash remove from the queue only. |
| L | `db.ts` `updateSettings` | Read-modify-write outside a transaction, so concurrent saves lose updates. | Use a single readwrite transaction. |
| L | `resolveMaxTempoPercent` | A stored `1` is read as 100%. | Normalise percent and fraction units once. |
| L | `store.play()` | Marks the deck as playing even when no buffer is loaded. | Return early when the deck has no track. |
| L | Starter tracks removal | Leaves their ids in playlists, the queue and the decks. | Reuse the `removeFromLibrary` cleanup. |
| L | Dead code | `analyzeBPM`, `cleanupMissingTracks`, `Track.objectUrl`, and an unused `audioEngine` import in `TempoControls`. | Remove them. |
