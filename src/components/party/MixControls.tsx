import { Timer } from 'lucide-react';
import { useDJStore } from '@/stores/djStore';
import { Slider } from '@/components/ui/slider';

const DEFAULT_START_OFFSET_SECONDS = 15;
const DEFAULT_END_EARLY_SECONDS = 5;
const DEFAULT_CROSSFADE_SECONDS = 8;

export function MixControls() {
  const { settings, updateUserSettings, tracks, partyTrackIds, nowPlayingIndex } = useDJStore();

  const nextIndex = nowPlayingIndex + 1;
  const nextTrackId = nextIndex < partyTrackIds.length ? partyTrackIds[nextIndex] : settings.loopPlaylist ? partyTrackIds[0] : null;
  const nextTrack = nextTrackId ? tracks.find(t => t.id === nextTrackId) : null;

  // 0s → 60–120s depending on track length
  const startOffsetMax = nextTrack?.duration
    ? Math.min(120, Math.max(60, Math.floor(nextTrack.duration / 4)))
    : 120;

  return (
    <div className="glass-card space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <Timer className="w-4 h-4 text-primary" />
          Mix Timing
        </h3>
        <button
          onClick={() =>
            updateUserSettings({
              nextSongStartOffset: DEFAULT_START_OFFSET_SECONDS,
              endEarlySeconds: DEFAULT_END_EARLY_SECONDS,
              crossfadeSeconds: DEFAULT_CROSSFADE_SECONDS,
            })
          }
          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          title="Reset mix timing to defaults"
          type="button"
        >
          Reset to Defaults
        </button>
      </div>

      {/* A) Incoming Track */}
      <div>
        <div className="flex justify-between mb-2">
          <span className="text-xs text-muted-foreground">Start Offset</span>
          <span className="text-xs font-semibold text-accent">{Math.round(settings.nextSongStartOffset)}s</span>
        </div>
        <Slider
          value={[settings.nextSongStartOffset]}
          onValueChange={([v]) => updateUserSettings({ nextSongStartOffset: v })}
          min={0}
          max={startOffsetMax}
          step={1}
          className="w-full"
        />
        <p className="text-[9px] text-muted-foreground mt-1">
          Skip intro: start incoming track at this position
        </p>
      </div>

      {/* B) Outgoing Track */}
      <div>
        <div className="flex justify-between mb-2">
          <span className="text-xs text-muted-foreground">End Early</span>
          <span className="text-xs font-semibold text-accent">{Math.round(settings.endEarlySeconds ?? 0)}s</span>
        </div>
        <Slider
          value={[settings.endEarlySeconds ?? 0]}
          onValueChange={([v]) => updateUserSettings({ endEarlySeconds: v })}
          min={0}
          max={60}
          step={1}
          className="w-full"
        />
        <p className="text-[9px] text-muted-foreground mt-1">
          Fade out this many seconds before the track ends
        </p>
      </div>

      {/* C) Crossfade */}
      <div>
        <div className="flex justify-between mb-2">
          <span className="text-xs text-muted-foreground">Crossfade Duration</span>
          <span className="text-xs font-semibold text-accent">{Math.round(settings.crossfadeSeconds)}s</span>
        </div>
        <Slider
          value={[settings.crossfadeSeconds]}
          onValueChange={([v]) => updateUserSettings({ crossfadeSeconds: v })}
          min={1}
          max={20}
          step={1}
          className="w-full"
        />
        <p className="text-[9px] text-muted-foreground mt-1">How long the transition lasts</p>
      </div>

      {/* Tiny summary */}
      <div className="pt-1 space-y-0.5">
        <p className="text-[9px] text-muted-foreground">Incoming starts at {Math.round(settings.nextSongStartOffset)}s</p>
        <p className="text-[9px] text-muted-foreground">Outgoing fades {Math.round(settings.endEarlySeconds ?? 0)}s early</p>
        <p className="text-[9px] text-muted-foreground">Crossfade {Math.round(settings.crossfadeSeconds)}s</p>
      </div>
    </div>
  );
}
