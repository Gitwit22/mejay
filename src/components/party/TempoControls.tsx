import { Gauge, Lock, Unlock } from 'lucide-react';
import { useDJStore } from '@/stores/djStore';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import { GatedSection } from '@/components/ui/GatedControl';

export function TempoControls() {
  const { settings, updateUserSettings, deckA, deckB, activeDeck, tracks } = useDJStore();
  
  const currentDeck = activeDeck === 'A' ? deckA : deckB;
  const currentTrack = tracks.find(t => t.id === currentDeck.trackId);

  const autoTargetBpm = settings.autoBaseBpm !== null
    ? Math.round((settings.autoBaseBpm + (settings.autoOffsetBpm ?? 0)) * 10) / 10
    : null;

  return (
    <GatedSection feature="tempoControl" label="Upgrade for Tempo Control">
      <div className="glass-card space-y-4">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Gauge className="w-4 h-4 text-accent" />
          Tempo Control
        </h3>

        {/* Tempo Mode Toggle */}
        <div>
          <span className="text-xs text-muted-foreground block mb-2">Mode</span>
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => updateUserSettings({ tempoMode: 'auto' })}
              className={cn(
                'flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all',
                settings.tempoMode === 'auto'
                  ? 'bg-accent text-accent-foreground'
                  : 'bg-white/5 text-muted-foreground hover:bg-white/10'
              )}
            >
              <Unlock className="w-3.5 h-3.5" />
              Auto Match
            </button>
            <button
              onClick={() => updateUserSettings({ tempoMode: 'locked' })}
              className={cn(
                'flex items-center justify-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all',
                settings.tempoMode === 'locked'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-white/5 text-muted-foreground hover:bg-white/10'
              )}
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
              max={180}
              step={1}
              className="w-full"
            />
          </div>
        )}

        {/* Auto Match Offset Slider */}
        {settings.tempoMode === 'auto' && (
          <div>
            <div className="flex justify-between mb-2">
              <span className="text-xs text-muted-foreground">Tempo Offset</span>
              <span className="text-xs font-semibold text-accent">
                {settings.autoOffsetBpm >= 0 ? '+' : ''}{Math.round(settings.autoOffsetBpm)} BPM
              </span>
            </div>
            <Slider
              value={[settings.autoOffsetBpm ?? 0]}
              onValueChange={([v]) => updateUserSettings({ autoOffsetBpm: v })}
              min={-20}
              max={20}
              step={1}
              className="w-full"
            />
            <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground">
              <span>
                Base: {settings.autoBaseBpm !== null ? Math.round(settings.autoBaseBpm) : '—'} BPM
              </span>
              <span>
                Target: {autoTargetBpm !== null ? Math.round(autoTargetBpm) : '—'} BPM
              </span>
            </div>
          </div>
        )}

        {/* Max Tempo Stretch */}
        <div>
          <div className="flex justify-between mb-2">
            <span className="text-xs text-muted-foreground">Max Tempo Change</span>
            <span className="text-xs font-semibold text-accent">±{settings.maxTempoPercent}%</span>
          </div>
          <Slider
            value={[settings.maxTempoPercent]}
            onValueChange={([v]) => updateUserSettings({ maxTempoPercent: v })}
            min={2}
            max={15}
            step={1}
            className="w-full"
          />
          <p className="text-[9px] text-muted-foreground mt-1">
            Limits tempo stretching to avoid artifacts
          </p>
        </div>

        {/* Energy Mode */}
        <div>
          <span className="block text-xs text-muted-foreground mb-2">Energy Mode</span>
          <div className="energy-toggle">
            {(['chill', 'normal', 'hype'] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => updateUserSettings({ energyMode: mode })}
                className={cn(
                  'energy-option capitalize',
                  settings.energyMode === mode && 'active'
                )}
              >
                {mode === 'chill' && '😌 '}
                {mode === 'normal' && '🎵 '}
                {mode === 'hype' && '🔥 '}
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>
    </GatedSection>
  );
}
