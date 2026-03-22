import { Gauge, Sparkles } from 'lucide-react';
import { useDJStore } from '@/stores/djStore';
import { cn } from '@/lib/utils';
import { GatedSection } from '@/components/ui/GatedControl';
import { audioEngine } from '@/lib/audioEngine';
import { TEMPO_PRESET_OPTIONS, getTempoPresetLabel, normalizeTempoPreset } from '@/lib/tempoPresets';

export function TempoControls() {
  const {
    settings,
    updateUserSettings,
    deckA,
    deckB,
    activeDeck,
    tracks,
    lastTempoDebug,
  } = useDJStore();

  const currentDeck = activeDeck === 'A' ? deckA : deckB;
  const currentTrack = tracks.find(t => t.id === currentDeck.trackId);

  const tempoPreset = normalizeTempoPreset(settings.tempoPreset ?? 'original');
  const tempoPresetLabel = getTempoPresetLabel(tempoPreset);

  // Current effective BPM = native BPM × playback rate.
  const currentEffectiveBpm = currentTrack?.bpm
    ? Math.round(currentTrack.bpm * currentDeck.playbackRate)
    : null;

  return (
    <GatedSection feature="tempoControl" label="Upgrade for Tempo Control">
      <div className="glass-card space-y-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Gauge className="w-4 h-4 text-accent" />
          Tempo Vibe
        </h3>

        {/* Preset Buttons — the single tempo-vibe selection surface */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-muted-foreground">Select a vibe</span>
            <span className="text-xs font-semibold text-primary">{tempoPresetLabel}</span>
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
            Transitions match the current song's tempo — no audible speed-up or slow-down.
          </p>
        </div>

        {/* Current BPM Display */}
        <div className="flex items-center justify-between p-3 rounded-xl bg-white/5">
          <div>
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Effective BPM</span>
            <p className="text-xl font-bold text-foreground font-display">
              {currentEffectiveBpm ?? '—'}
            </p>
          </div>
          <div className="text-right">
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Original</span>
            <p className="text-sm text-muted-foreground">
              {currentTrack?.bpm ? Math.round(currentTrack.bpm) : '—'} BPM
            </p>
          </div>
        </div>

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
      </div>
    </GatedSection>
  );
}
