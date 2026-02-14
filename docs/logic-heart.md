
# Logic Heart

This doc is the “brain dump” for the app’s most **non-obvious** logic: how Party Mode tempo / mixing works, where the guard rails are, and where the other unique subsystems live.

> If you only read one section: read **Tempo System** first.

## Table of contents

- [Tempo System](#tempo-system)
	- [Where the logic lives](#where-the-logic-lives)
	- [Core concepts](#core-concepts)
	- [Modes and user-facing settings](#modes-and-user-facing-settings)
	- [How a Party Mode transition is planned](#how-a-party-mode-transition-is-planned)
	- [Safe Mode tempo cap (the “don’t auto-warp too hard” rule)](#safe-mode-tempo-cap-the-dont-auto-warp-too-hard-rule)
	- [“0 = native speed” contract](#0--native-speed-contract)
	- [Tempo ramps tied to crossfade](#tempo-ramps-tied-to-crossfade)
	- [Beat/phrase quantization](#beatphrase-quantization)
	- [Observability: `lastTransitionTempoPlan`](#observability-lasttransitiontempoplan)
	- [Tests that lock the behavior](#tests-that-lock-the-behavior)
- [Other Unique Logic](#other-unique-logic)
	- [Audio engine (2-deck WebAudio)](#audio-engine-2-deck-webaudio)
	- [BPM detection](#bpm-detection)
	- [Plan gating and cross-tab entitlements sync](#plan-gating-and-cross-tab-entitlements-sync)
	- [Local/offline license tokens](#localoffline-license-tokens)
	- [Stripe checkout + D1 entitlements (never-downgrade bias)](#stripe-checkout--d1-entitlements-never-downgrade-bias)
	- [Auth (email codes + password) and dev bypass](#auth-email-codes--password-and-dev-bypass)
	- [Cloudflare deployment topology (Pages Functions + optional Worker)](#cloudflare-deployment-topology-pages-functions--optional-worker)
	- [Testing determinism (timers + store cleanup)](#testing-determinism-timers--store-cleanup)

---

# Tempo System

## Where the logic lives

**Primary orchestration**
- `src/stores/djStore.ts`
	- Party Mode state machine (now playing / next / queue)
	- Transition planning (timing + quantization + tempo decisions)
	- Applies gating rules (plan features)
	- Emits a debuggable snapshot: `lastTransitionTempoPlan`

**Tempo math (pure helpers)**
- `src/lib/tempoMatch.ts`
	- Tempo shift math (“how far apart are two BPMs in %?”)
	- Cap normalization and cap decision helper used by UI + store

**Engine primitives (WebAudio implementation)**
- `src/lib/audioEngine.ts`
	- `calculateTempoRatio()` → converts target BPM + cap into `playbackRate`
	- `setTempo()` + `rampTempo()` → scheduling + bookkeeping
	- Beat-grid utilities like `getNextBeatTimeFrom()` used for quantization

**UI controls**
- `src/components/party/TempoControls.tsx` (mode toggle, offsets, warnings)
- `src/components/party/PartyQueuePanel.tsx` (queue indicator uses cap semantics)

## Core concepts

**BPM vs playbackRate**
- Tracks have an analyzed **base BPM** (e.g. 120).
- The audio engine plays at a **playbackRate** (ratio), where:

	- `effectiveBpm = baseBpm * playbackRate`
	- `playbackRate = targetBpm / baseBpm` (bounded by max percent stretch)

**Target BPM (the BPM we want both decks to share during a transition)**
- Depends on mode:
	- Locked: `settings.lockedBpm`
	- Auto Match: `settings.autoBaseBpm + settings.autoOffsetBpm`
	- Party Auto: uses the currently playing deck as baseline, optionally with an offset

## Modes and user-facing settings

Settings live in `Settings` (see `src/lib/db.ts`). The relevant ones:

- `tempoMode: 'auto' | 'locked'`
- `lockedBpm: number`
- `lockTolerancePct: number` (allowed drift before correcting)
- `autoBaseBpm: number | null` + `autoOffsetBpm: number`
- `maxTempoPercent: number` (clamped; product default 8%, hard cap 12%)
- `partyTempoAfterTransition?: 'hold' | 'revert'`

There’s also plan gating via `src/stores/planStore.ts`:
- Feature `tempoControl` controls whether tempo is allowed at all.

## How a Party Mode transition is planned

The main transition path is orchestrated from `useDJStore.getState().skip(...)`.

High-level flow:

1. Determine current deck (outgoing) and next deck (incoming)
2. Compute a target BPM for the transition
3. Quantize the incoming start time (bar/phrase aligned)
4. Schedule:
	 - Incoming start (may be earlier and inaudible until crossfade starts)
	 - Crossfade
	 - Optional tempo ramp on the outgoing deck
	 - Optional “revert-to-original” ramp after the crossfade
5. Write a `lastTransitionTempoPlan` snapshot (for UI/debug)

## Safe Mode tempo cap (the “don’t auto-warp too hard” rule)

Product rule:
- Suggestions can be wide, but **auto-sync during Party Mode should not force huge warps**.
- If the needed tempo stretch exceeds the cap, the app does **not block playback**.
	- It simply disables tempo matching for that transition.

Implementation details:
- The store computes required percent shift for both sides:
	- `requiredIncomingShiftPct = required% from nextBaseBpm → targetBpm`
	- `requiredOutgoingShiftPct = required% from outgoingBaseBpm → targetBpm`
	- `requiredShiftPct = max(incoming, outgoing)`
- Cap is normalized via `resolveMaxTempoPercent()` in `src/lib/tempoMatch.ts`.
	- This is defensive against “8 vs 0.08” style config mistakes.
- Over-cap check is centralized via `isOverTempoCap()` (strict “greater-than”, with stable normalization).

Outcome if over cap:
- `tempoMatchDisabled = true`
- `disabledReason = 'over_cap'`
- The transition still happens, but decks run at native speed unless the user already had a non-neutral tempo set.

## 0 = native speed contract

User expectation (and test-locked invariant):
- When tempo matching is disabled for a transition **and the nudge is neutral**, the app must not “mysteriously” change pitch.

Implementation:
- In `djStore.ts` during transition planning:
	- If tempo match is disabled and the user has not nudged tempo away from neutral, the outgoing deck ratio is forced to `1`.

Why this exists:
- Without this, the app could end up leaving a deck “matched” from a previous state even though the transition is now over cap.

## Tempo ramps tied to crossfade

Core idea:
- If we are going to warp tempo, do it *as part of the mix*.

Implementation:
- Ramp duration is derived from crossfade seconds:
	- `computeTempoRampSecFromCrossfade(crossfadeSec)`
	- Typical shape: `rampSec = clamp(crossfadeSec * 2, 4, 20)`
- The outgoing deck’s ramp is scheduled so it **finishes at the end of the crossfade**.
- The engine uses `audioEngine.rampTempo(deck, ratio, startAt, durationMs)`.

This makes tempo changes feel like part of the transition instead of a sudden jump.

## Beat/phrase quantization

The transition planner tries to place the incoming start on musically meaningful boundaries:

- Manual “immediate”: still bar-aligned (1 bar)
- Auto: prefer phrase boundaries when there’s time (e.g. 16 bars, else 8, 4, 1)

Mechanics:
- Uses beat-grid queries like `audioEngine.getNextBeatTimeFrom(...)`.
- Uses helper quantizers in `djStore.ts` (e.g. `quantizeNextUpTo`, `chooseBeatAlignedTimeInRange`, etc.)

Key constraint:
- Quantization must respect the “latest start time” that still satisfies end-early and crossfade window.

## Observability: lastTransitionTempoPlan

The store writes a structured snapshot under `lastTransitionTempoPlan` so the UI can explain what just happened.

It includes (non-exhaustive):
- Mode used (original / locked / party)
- Used inputs: `nextBaseBpmUsed`, `outgoingBaseBpmUsed`, `targetBpmUsed`
- Required stretch: `requiredIncomingPercent`, `requiredOutgoingPercent`, `requiredPercent`
- Cap decision: `capPctUsed`, `overCap`, `tempoMatchDisabled`, `disabledReason`
- Scheduling: `incomingStartAt`, `fadeAt`, `rampStartAt`, `rampEndAt`, `quantizedTo`
- Ratios: `incomingTargetRatio`, `outgoingTargetRatio`

UI consumes this in `src/components/party/TempoControls.tsx` to show “paused over cap” style explanations.

## Tests that lock the behavior

Relevant tests:
- `src/stores/djStore.tempoPlan.test.ts`
	- “exactly at cap is allowed”
	- “epsilon over cap disables”
	- “0=native speed when tempo disabled”
	- ramp timing / ramp duration coupling
- `src/lib/tempoMatch.test.ts`
	- pure cap-decision semantics (used by UI + store)

Important testing note:
- Party Mode scheduling uses timers; tests must stop Party Mode / clear scheduled timeouts between cases to avoid flakes.

---

# Other Unique Logic

This section is the map of the other custom systems that aren’t just standard React components.

## Audio engine (2-deck WebAudio)

Files:
- `src/lib/audioEngine.ts`

Notable behavior:
- Dual-deck abstraction with crossfade scheduling (`scheduleCrossfade`)
- Tempo change scheduling with `rampTempo` and “effective tempo” queries
- Beat-grid helpers used for quantization
- Loudness analysis + track gain
- Limiter presets (compressor-based)

## BPM detection

Files:
- `src/lib/bpmDetector.ts`

Notable behavior:
- Analyzes a mid-section of audio, finds peaks, and estimates BPM
- Produces BPM + confidence-like output; UI labels tracks as analyzing/ready/basic

## Plan gating and cross-tab entitlements sync

Files:
- `src/stores/planStore.ts`

Notable behavior:
- Central feature gate: `hasFeature('tempoControl' | 'advancedMixTiming' | 'autoVolume')`
- Dev/runtime plan sources (“dev override” vs server-derived)
- Cross-tab propagation:
	- BroadcastChannel if available
	- localStorage ping fallback
- Emits an entitlements-changed custom event for subsystems

## Local/offline license tokens

Files:
- `src/licensing/licenseToken.ts`
- `src/licensing/licensePolicy.ts`
- `src/licensing/licenseApi.ts`
- `src/licensing/licenseStore.ts`
- `src/licensing/licenseService.ts`

Notable behavior:
- Token format: `MEJAY1.<payload>.<sig>`
- HMAC signing is demo/local-only (offline verification)
- Policy: mandatory “online check” windows and clock-skew detection
- Gating rule: if a device has ever activated a license, licensing becomes the plan truth source

## Stripe checkout + D1 entitlements (never-downgrade bias)

Files:
- `functions/api/checkout.ts`
- `functions/api/checkout-status.ts`
- `functions/api/billing/sync.ts`
- `functions/api/billing-portal.ts`
- `functions/api/stripe-webhook.ts`
- `functions/api/entitlements.ts`
- `migrations/*`

Notable behavior:
- Checkout is bound to an authenticated session user
- Entitlements persistence is intentionally conservative:
	- verification/sync/webhook paths generally do not write “free”
	- avoids accidental downgrades due to transient Stripe states
- Full Program fulfillment email is best-effort and designed to send once when entitlement first becomes active

Client integration:
- `src/lib/checkout.ts` (start checkout, status polling, billing portal)
- `src/App.tsx` (post-checkout activation window; refreshes entitlements from server)

## Auth (email codes + password) and dev bypass

Files:
- `functions/api/auth/*`
- `functions/api/_auth.ts`
- `functions/api/_password.ts`
- `src/app/pages/LoginPage.tsx`
- `src/stores/planStore.ts` (auth bypass flags)

Notable behavior:
- Email code flow:
	- Start generates a 6-digit code, stores a hash in D1, emails via Resend
	- Verify checks hash, enforces attempt limits + lockout, issues a short-lived “verified token”
	- Set-password consumes the verified token, sets password, creates a session cookie
- Password login verifies stored hash and sets session
- Dev/demo bypass for `/app` routing exists (client-side), but does not create a server session

## Cloudflare deployment topology (Pages Functions + optional Worker)

Files:
- `functions/api/**` (Pages Functions routes)
- `src/worker.ts` (optional Worker API entrypoint)
- `wrangler.toml`
- `public/_redirects` (SPA deep-link support)

Notable behavior:
- Repo supports Pages Functions by default
- Also contains an optional Worker implementation for similar endpoints

## Testing determinism (timers + store cleanup)

Files:
- `src/stores/djStore.tempoPlan.test.ts`

Notable behavior:
- Party Mode uses scheduled timeouts to coordinate crossfade + deck swaps.
- Tests must stop Party Mode / clear scheduled timers between tests to avoid state mutation bleed.

---

## What to add next (optional)

If you want, we can add a DEV-only “Tempo Debug” panel that renders `lastTransitionTempoPlan` (collapsed by default) so diagnosing real-world reports doesn’t require digging through logs.

