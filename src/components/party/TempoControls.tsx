import { Gauge, Lock, Unlock, Sparkles } from 'lucide-react';
import { useDJStore } from '@/stores/djStore';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import { GatedSection } from '@/components/ui/GatedControl';
import { audioEngine } from '@/lib/audioEngine';
import { useEffect, useState } from 'react';
import { TEMPO_PRESET_OPTIONS, getTempoPresetLabel, getTempoPresetDisplayTarget, normalizeTempoPreset } from '@/lib/tempoPresets';

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

  const [showAdvancedModes, setShowAdvancedModes] = useState(settings.tempoMode !== 'preset');
  useEffect(() => {
    // When presets are active, keep Auto/Locked out of the way unless explicitly expanded.
    if (settings.tempoMode === 'preset') {
      setShowAdvancedModes(false);
    } else {
      setShowAdvancedModes(true);
    }
  }, [settings.tempoMode]);
  
  const currentDeck = activeDeck === 'A' ? deckA : deckB;
  const currentTrack = tracks.find(t => t.id === currentDeck.trackId);

  const tempoPreset = normalizeTempoPreset(settings.tempoPreset ?? 'original')
  const tempoPresetDisplay = getTempoPresetDisplayTarget(tempoPreset, currentTrack?.bpm)
  const tempoPresetLabel = getTempoPresetLabel(tempoPreset)

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

    await updateUserSettings({ tempoMode: 'auto', lastAdvancedTempoMode: 'auto' });
  };

  const handleUiModeSwitch = async (mode: 'vibes' | 'advanced') => {
    if (mode === 'vibes') {
      // Switch to vibes: always use preset mode
      await updateUserSettings({ tempoUiMode: 'vibes', tempoMode: 'preset' });
    } else {
      // Switch to advanced: restore last advanced sub-mode
      const restoreMode = settings.lastAdvancedTempoMode ?? 'auto';
      await updateUserSettings({ tempoUiMode: 'advanced', tempoMode: restoreMode });
    }
  };

  return (
    <GatedSection feature="tempoControl" label="Upgrade for Tempo Control">
      <div className="glass-card space-y-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Gauge className="w-4 h-4 text-accent" />
          Tempo Control
        </h3>

        {/* Segmented UI Mode Toggle */}
        <div>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => handleUiModeSwitch('vibes')}
              className={cn(
                'w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all',
                settings.tempoUiMode === 'vibes'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-white/5 text-muted-foreground hover:bg-white/10'
              )}
              type="button"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Tempo Vibes
            </button>
            <button
              onClick={() => handleUiModeSwitch('advanced')}
              className={cn(
                'w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all',
                settings.tempoUiMode === 'advanced'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-white/5 text-muted-foreground hover:bg-white/10'
              )}
              type="button"
            >
              <Gauge className="w-3.5 h-3.5" />
              Advanced Control
            </button>
          </div>
        </div>

        {/* Tempo Vibe Presets (vibes mode only) */}
        {settings.tempoUiMode === 'vibes' && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">Tempo Vibe</span>
              <span className="text-xs font-semibold text-primary">
                {tempoPresetDisplay} ({tempoPresetLabel})
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {TEMPO_PRESET_OPTIONS.map((p) => (
                <button
                  key={p.key}
                  onClick={() => updateUserSettings({ tempoMode: 'preset', tempoPreset: p.key })}
                  className={cn(
                    'px-2 py-2 rounded-xl text-[11px] font-medium transition-all',
                    settings.tempoMode === 'preset' && tempoPreset === p.key
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-white/5 text-muted-foreground hover:bg-white/10'
                  )}
                  type="button"
                >
                  <span className="inline-flex items-center justify-center gap-1">
                    {p.key === 'club' ? <Sparkles className="w-3.5 h-3.5" /> : null}
                    {p.shortLabel}
                  </span>
                </button>
              ))}
            </div>
            <p className="text-[9px] text-muted-foreground mt-2">
              Discrete choices set tempo once — no continuous correction.
            </p>
          </div>
        )}

        {/* Advanced Controls (advanced mode only) */}
        {settings.tempoUiMode === 'advanced' && (
          <div>
            <span className="text-xs text-muted-foreground block mb-2">Advanced Mode</span>
            <div className="grid grid-cols-2 gap-2">
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
                Auto Match
              </button>
              <button
                onClick={() => updateUserSettings({ tempoMode: 'locked', lastAdvancedTempoMode: 'locked' })}
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
        )}

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
