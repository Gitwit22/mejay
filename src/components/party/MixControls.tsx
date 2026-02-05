import { Timer } from 'lucide-react';
import { useDJStore } from '@/stores/djStore';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import { GatedControl } from '@/components/ui/GatedControl';

export function MixControls() {
  const { settings, updateUserSettings, triggerMixNow, isPartyMode } = useDJStore();

  return (
    <div className="glass-card space-y-4">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Timer className="w-4 h-4 text-primary" />
        Mix Timing
      </h3>

      {/* Next Song Start Offset - FREE */}
      <div>
        <div className="flex justify-between mb-2">
          <span className="text-xs text-muted-foreground">Next Song Start At</span>
          <span className="text-xs font-semibold text-accent">{settings.nextSongStartOffset}s</span>
        </div>
        <Slider
          value={[settings.nextSongStartOffset]}
          onValueChange={([v]) => updateUserSettings({ nextSongStartOffset: v })}
          min={0}
          max={60}
          step={1}
          className="w-full"
        />
        <p className="text-[9px] text-muted-foreground mt-1">
          Skip intro: start incoming track at this position
        </p>
      </div>

      {/* Mix Trigger Mode - GATED (Time Left / Time In only) */}
      <div>
        <span className="text-xs text-muted-foreground block mb-2">Bring In When</span>
        <div className="grid grid-cols-3 gap-1.5">
          {(['remaining', 'elapsed', 'manual'] as const).map((mode) => {
            const isGated = mode !== 'manual';
            const isActive = settings.mixTriggerMode === mode;

            if (isGated) {
              return (
                <GatedControl key={mode} feature="advancedMixTiming">
                  <button
                    className={cn(
                      'w-full px-2 py-1.5 rounded-lg text-[10px] font-medium capitalize transition-all',
                      isActive
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-white/5 text-muted-foreground hover:bg-white/10'
                    )}
                  >
                    {mode === 'remaining' ? 'Time Left' : 'Time In'}
                  </button>
                </GatedControl>
              );
            }

            return (
              <button
                key={mode}
                onClick={() => updateUserSettings({ mixTriggerMode: mode })}
                className={cn(
                  'px-2 py-1.5 rounded-lg text-[10px] font-medium capitalize transition-all',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-white/5 text-muted-foreground hover:bg-white/10'
                )}
              >
                Manual
              </button>
            );
          })}
        </div>
      </div>

      {/* Mix Trigger Seconds - GATED */}
      {settings.mixTriggerMode !== 'manual' && (
        <GatedControl feature="advancedMixTiming">
          <div>
            <div className="flex justify-between mb-2">
              <span className="text-xs text-muted-foreground">
                {settings.mixTriggerMode === 'remaining' ? 'Seconds Remaining' : 'Seconds Into Track'}
              </span>
              <span className="text-xs font-semibold text-accent">{settings.mixTriggerSeconds}s</span>
            </div>
            <Slider
              value={[settings.mixTriggerSeconds]}
              onValueChange={([v]) => updateUserSettings({ mixTriggerSeconds: v })}
              min={5}
              max={60}
              step={1}
              className="w-full"
            />
          </div>
        </GatedControl>
      )}

      {/* Manual Mix Button - FREE */}
      {settings.mixTriggerMode === 'manual' && isPartyMode && (
        <button
          onClick={triggerMixNow}
          className="w-full py-3 rounded-xl bg-gradient-to-r from-primary to-accent text-white font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          Mix Now
        </button>
      )}

      {/* Crossfade Duration - GATED */}
      <GatedControl feature="advancedMixTiming">
        <div>
          <div className="flex justify-between mb-2">
            <span className="text-xs text-muted-foreground">Crossfade Duration</span>
            <span className="text-xs font-semibold text-accent">{settings.crossfadeSeconds}s</span>
          </div>
          <Slider
            value={[settings.crossfadeSeconds]}
            onValueChange={([v]) => updateUserSettings({ crossfadeSeconds: v })}
            min={2}
            max={16}
            step={1}
            className="w-full"
          />
        </div>
      </GatedControl>
    </div>
  );
}
