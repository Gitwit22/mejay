import { Gauge, Lock, Unlock } from 'lucide-react';
import { useDJStore } from '@/stores/djStore';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import { GatedSection } from '@/components/ui/GatedControl';
import { audioEngine } from '@/lib/audioEngine';

export function TempoControls() {
  const {
    settings,
    updateUserSettings,
    setTempo,
    deckA,
    deckB,
    activeDeck,
    tracks,
    lastTransitionTempoMatchDisabled,
    lastTransitionTempoMatchRequiredPct,
    lastTransitionTempoMatchCeilingPct,
    lastTransitionTempoPlan,
    lastTempoDebug,
  } = useDJStore();
  
  const currentDeck = activeDeck === 'A' ? deckA : deckB;
  const currentTrack = tracks.find(t => t.id === currentDeck.trackId);

  const autoTargetBpm = settings.autoBaseBpm !== null
    ? Math.round(settings.autoBaseBpm * 10) / 10
    : null;

  const afterTransition = settings.partyTempoAfterTransition ?? 'hold'

  const crossfadeSec = Math.max(1, Math.min(20, settings.crossfadeSeconds ?? 8))
  const tempoRampSec = Math.max(4, Math.min(20, crossfadeSec * 2))

  const allowedDriftBpm = (() => {
    const pct = Math.max(0, Math.min(100, settings.lockTolerancePct ?? 10))
    if (pct >= 100) return Number.POSITIVE_INFINITY
    const target = Math.max(1, settings.lockedBpm ?? 128)
    return (pct / 100) * target
  })()

  const handleAutoMatchClick = async () => {
    // If already in Auto Match, treat another tap as a quick “reset speed to original”.
    if (settings.tempoMode === 'auto') {
      const baseBpm = currentTrack?.bpm ?? audioEngine.getBaseBpm(activeDeck) ?? 120;
      await updateUserSettings({
        tempoMode: 'auto',
        autoBaseBpm: baseBpm,
        autoOffsetBpm: 0,
      });

      const nowCtx = audioEngine.getAudioContextTime();
      if (nowCtx !== null) {
        audioEngine.rampTempo(activeDeck, 1, nowCtx + 0.02, tempoRampSec * 1000);
      } else {
        setTempo(activeDeck, 1);
      }
      return;
    }

    await updateUserSettings({ tempoMode: 'auto' });
  };

  return (
    <GatedSection feature="tempoControl" label="Upgrade for Tempo Control">
      <div className="glass-card space-y-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Gauge className="w-4 h-4 text-accent" />
          Tempo Control
        </h3>

        {settings.tempoMode === 'auto' && (lastTransitionTempoPlan?.tempoMatchDisabled || lastTransitionTempoMatchDisabled) && (
          <div className="rounded-xl bg-white/5 px-3 py-2 text-[10px] text-muted-foreground">
            {(() => {
              const plan = lastTransitionTempoPlan;
              const reason = plan?.disabledReason;
              const needed = plan?.requiredPercent ?? lastTransitionTempoMatchRequiredPct;
              const cap = lastTransitionTempoMatchCeilingPct;

              const reasonText = reason === 'missing_bpm'
                ? 'Tempo Match paused (missing BPM analysis)'
                : reason === 'user_disabled'
                  ? 'Tempo Match paused (feature disabled)'
                  : 'Tempo Match paused (over cap)';

              if (typeof needed === 'number' && typeof cap === 'number') {
                return `${reasonText} — needed ~${Math.round(needed)}% > cap ${Math.round(cap)}%.`;
              }
              return `${reasonText}.`;
            })()}
          </div>
        )}

        {/* Tempo Mode Toggle */}
        <div>
          <span className="text-xs text-muted-foreground block mb-2">Mode</span>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <button
                onClick={handleAutoMatchClick}
                className={cn(
                  'w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all',
                  settings.tempoMode === 'auto'
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-white/5 text-muted-foreground hover:bg-white/10'
                )}
                type="button"
              >
                <Unlock className="w-3.5 h-3.5" />
                Match Base BPM
              </button>
              <p className="text-[9px] text-muted-foreground leading-snug">
                Pick a target BPM for Auto Match. Tap again to reset.
              </p>
            </div>
            <button
              onClick={() => updateUserSettings({ tempoMode: 'locked' })}
              className={cn(
                'w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all',
                settings.tempoMode === 'locked'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-white/5 text-muted-foreground hover:bg-white/10'
              )}
              type="button"
            >
              <Lock className="w-3.5 h-3.5" />
              Locked BPM
            </button>
          </div>
        </div>

        {/* Current BPM Display */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-white/5">
          <div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Current BPM</span>
            <p className="text-xl font-bold text-foreground font-display">
              {currentTrack?.bpm ? Math.round(currentTrack.bpm * currentDeck.playbackRate) : '—'}
            </p>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Original</span>
            <p className="text-sm text-muted-foreground">
              {currentTrack?.bpm ? Math.round(currentTrack.bpm) : '—'} BPM
            </p>
          </div>
        </div>

        {/* Locked BPM Slider */}
        {settings.tempoMode === 'locked' && (
          <div>
            <div className="flex justify-between mb-2">
              <span className="text-xs text-muted-foreground">Master BPM</span>
              <span className="text-xs font-semibold text-primary">{settings.lockedBpm} BPM</span>
            </div>
            <Slider
              value={[settings.lockedBpm]}
              onValueChange={([v]) => updateUserSettings({ lockedBpm: v })}
              min={60}
              max={300}
              step={5}
              className="w-full"
            />
          </div>
        )}

        {/* NEW: Lock Tolerance Slider */}
        {settings.tempoMode === 'locked' && (
          <div>
            <div className="flex justify-between mb-2">
              <span className="text-xs text-muted-foreground">Lock Tolerance</span>
              <span className="text-xs font-semibold text-accent">
                {Math.round((settings.lockTolerancePct ?? 10) * 10) / 10}%
                <span className="text-muted-foreground font-normal">
                  &nbsp;· {Number.isFinite(allowedDriftBpm) ? `±${allowedDriftBpm.toFixed(1)} BPM` : 'no correction'}
                </span>
              </span>
            </div>
            <Slider
              value={[settings.lockTolerancePct ?? 10]}
              onValueChange={([v]) => updateUserSettings({ lockTolerancePct: v })}
              min={0}
              max={100}
              step={5}
              className="w-full"
            />
            <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>Strict</span>
              <span>Loose</span>
            </div>
            <p className="text-[9px] text-muted-foreground mt-1">
              Controls how much tempo drift is allowed before the locked BPM is corrected.
            </p>
          </div>
        )}

        {/* Auto Match Target BPM Slider */}
        {settings.tempoMode === 'auto' && (
          <div>
            <div className="flex justify-between mb-2">
              <span className="text-xs text-muted-foreground">Target BPM</span>
              <span className="text-xs font-semibold text-accent">
                {autoTargetBpm !== null ? Math.round(autoTargetBpm) : '—'} BPM
              </span>
            </div>
            <Slider
              value={[settings.autoBaseBpm ?? (currentTrack?.bpm ?? audioEngine.getBaseBpm(activeDeck) ?? 120)]}
              onValueChange={([v]) => updateUserSettings({ autoBaseBpm: v })}
              min={60}
              max={300}
              step={5}
              className="w-full"
            />
            <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>
                Track: {currentTrack?.bpm ? Math.round(currentTrack.bpm) : '—'} BPM
              </span>
              <span>
                Target: {autoTargetBpm !== null ? Math.round(autoTargetBpm) : '—'} BPM
              </span>
            </div>

            <div className="mt-4">
              <span className="text-xs text-muted-foreground block mb-2">After transition</span>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => updateUserSettings({partyTempoAfterTransition: 'hold'})}
                  className={cn(
                    'w-full px-3 py-2 rounded-xl text-xs font-medium transition-all',
                    afterTransition === 'hold'
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-white/5 text-muted-foreground hover:bg-white/10'
                  )}
                >
                  Hold matched tempo
                </button>
                <button
                  type="button"
                  onClick={() => updateUserSettings({partyTempoAfterTransition: 'revert'})}
                  className={cn(
                    'w-full px-3 py-2 rounded-xl text-xs font-medium transition-all',
                    afterTransition === 'revert'
                      ? 'bg-accent text-accent-foreground'
                      : 'bg-white/5 text-muted-foreground hover:bg-white/10'
                  )}
                >
                  Return to original
                </button>
              </div>
              <p className="text-[9px] text-muted-foreground mt-2">
                Choose whether the next track stays tempo-matched after the crossfade.
              </p>
            </div>
          </div>
        )}

        {import.meta.env.DEV && lastTempoDebug && (
          <div className="rounded-xl bg-white/5 px-3 py-2 text-[10px] text-muted-foreground">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <span>deck {lastTempoDebug.deck}</span>
              <span>trackBpm {lastTempoDebug.trackBpm ? Math.round(lastTempoDebug.trackBpm * 10) / 10 : '—'}</span>
              <span>targetBpm {lastTempoDebug.targetBpm ? Math.round(lastTempoDebug.targetBpm * 10) / 10 : '—'}</span>
              <span>rawRate {lastTempoDebug.rawRate ? Math.round(lastTempoDebug.rawRate * 1000) / 1000 : '—'}</span>
              <span>clampedRate {lastTempoDebug.clampedRate ? Math.round(lastTempoDebug.clampedRate * 1000) / 1000 : '—'}</span>
              <span>effectiveBpm {lastTempoDebug.effectiveBpm ? Math.round(lastTempoDebug.effectiveBpm * 10) / 10 : '—'}</span>
              <span>cap {lastTempoDebug.maxTempoPercent ?? '—'}%</span>
            </div>
          </div>
        )}

        {/* Max tempo stretch remains a safety clamp (hidden from UI for now). */}
      </div>
    </GatedSection>
  );
}
