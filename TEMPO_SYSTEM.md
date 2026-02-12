# Tempo Control System

The tempo system has **three modes** that determine how playback speed is controlled:

## 1. **Preset Mode** (Discrete Tempo Vibes)
- **UI**: Grid of 5 preset buttons (Original, Chill, Upbeat, Club, Texas)
- **How it works**: Each preset maps to a fixed target BPM (or `null` for Original)
  - `original` → `null` → playback at 1.0× (each track plays at its native speed)
  - `chill` → 95 BPM
  - `upbeat` → 115 BPM
  - `club` → 128 BPM
  - `fast` (Texas) → 145 BPM
- **Behavior**: When you select a preset, the system immediately calculates the playback ratio needed to match that target BPM and applies it to all playing decks. No continuous correction or drift adjustment — it's a one-time "set and forget" per preset change.
- **Cap**: Uses a higher tempo stretch ceiling (~12% vs 8% for auto mode) so presets can reach their targets without being safety-clamped.

## 2. **Auto Match Mode** (Baseline + Offset)
- **UI**: "Match Base BPM" button + offset slider (hidden by default in preset mode)
- **How it works**: 
  - When you first enable Auto Match, it captures the current playback BPM as a baseline (`autoBaseBpm`)
  - That baseline becomes the target BPM for all tracks
  - Offset slider is legacy (now ignored; `autoOffsetBpm` kept for back-compat but clamped to 0 on new captures)
- **Drift correction**: In locked tolerance mode, the system periodically checks if tempo has drifted and nudges it back (only when `tempoMode === 'locked'` though — Auto Match itself doesn't auto-correct drift)
- **After transitions**: `partyTempoAfterTransition` setting controls whether the new track stays at the matched BPM (`hold`) or ramps back to 1.0× (`revert`)

## 3. **Locked BPM Mode** (Master Tempo)
- **UI**: "Locked BPM" button + BPM slider (60-300 BPM in 5 BPM steps) + tolerance slider (0-100%, in 5% steps)
- **How it works**: All tracks are forced to match the locked BPM value
- **Drift correction**: Uses `lockTolerancePct` to define allowed drift range. If tempo drifts beyond `(lockTolerancePct / 100) * lockedBpm`, the system automatically corrects it back
- **Tolerance display**: Shows both percentage and absolute BPM range (e.g., "10% · ±12.8 BPM" for 128 BPM locked)

---

## Core Functions

### `getCanonicalTargetBpm(settings)` 
Returns the "target BPM" based on current mode:
- **Locked** → `settings.lockedBpm`
- **Auto** → `settings.autoBaseBpm` (captured baseline)
- **Preset** → `TEMPO_PRESET_BPM[settings.tempoPreset]` (returns `null` for Original)
- Returns `null` if no valid target exists

### `applyImmediateTempoToDeck(state, deck)`
Applies tempo settings to a specific deck right now (no ramp):
- If `getCanonicalTargetBpm()` returns `null` (Original mode) → sets playback rate to 1.0
- Otherwise → calculates the ratio needed to match target BPM (`computeTempoForDeck()`) and applies it
- Respects feature gating (if tempo control isn't entitled, forces 1.0×)
- Guards against "fighting" by setting `lastManualTempoChangeAtCtx` to prevent drift correction from immediately overriding manual changes

### Tempo Stretch Cap
- **Auto/Locked modes**: default 8%, hard cap 12% (`maxTempoPercent` setting)
- **Preset mode**: uses a higher cap internally (`getEffectiveMaxTempoPercent()` adds 4% when in preset mode) so presets can reach their targets
- **Safety**: `computeClampedTempoRatio()` enforces absolute floors/ceilings (0.25× to 4×) to prevent audio artifacts

---

## Transitions & Mixing

When mixing from one track to another (Party Mode auto-mix or manual skip):

1. **Transition planner** (`skip()` function) determines target BPM based on mode
2. **Tempo matching decision**: 
   - Disabled if: preset is Original, BPM data missing, or stretch requirement exceeds cap
   - Enabled otherwise
3. **Outgoing deck tempo ramp**: If tempo matching is enabled, the outgoing deck smoothly ramps toward the target BPM over ~2× crossfade duration (4-20 seconds), aligned to beat boundaries
4. **Incoming deck**: Loads at the target BPM immediately (or 1.0× if matching is disabled)
5. **Post-transition**: 
   - If matching was disabled → both decks forced to 1.0×
   - If Auto Match + `partyTempoAfterTransition === 'revert'` → new deck ramps back to 1.0× during crossfade
   - Otherwise → holds the matched tempo

---

## Lifecycle Hooks (Where Tempo Gets Applied)

1. **`loadSettings()`**: On app boot, forces preset mode to start at Original, then calls `syncTempoNow()` to apply
2. **`loadTrackToDeck()`**: After loading a track blob into the engine, applies tempo (important because engine resets playbackRate to 1 on load)
3. **`play()`**: Right before starting playback, re-syncs tempo to settings (defensive against reload/navigation edge cases)
4. **`startPartyMode()`**: Applies tempo to deck A before starting Party Mode
5. **`updateUserSettings()`**: When you change `tempoMode`, `tempoPreset`, `lockedBpm`, or `autoBaseBpm`, immediately applies tempo to all playing decks via `applyImmediateTempoToPlayingDecks()`
6. **Entitlements change listener**: In `Index.tsx`, listens for `ENTITLEMENTS_CHANGED_EVENT` and calls `syncTempoNow()` to handle feature gating flips (e.g., plan downgrades)

---

## Persistence & Reload Behavior

- **IndexedDB** (`Settings` table) stores user preferences for all modes
- **SessionStorage** (Zustand persist middleware) remembers deck state across page refreshes
- **Product rule**: On reload/new session, preset mode always originates at Original (enforced in both `loadSettings()` and session `partialize()`)
- **Migration**: Legacy preset values (`'normal'` → `'upbeat'`, `'slow'` → `'chill'`) are normalized on read in `db.ts`

---

## File References

- **Core logic**: `src/stores/djStore.ts`
- **Preset definitions**: `src/lib/tempoPresets.ts`
- **Tempo math utilities**: `src/lib/tempoMatch.ts`
- **Audio engine**: `src/lib/audioEngine.ts`
- **UI components**: `src/components/party/TempoControls.tsx`
- **Settings persistence**: `src/lib/db.ts`
