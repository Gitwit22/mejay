import { Play, Pause, SkipBack, SkipForward, Music, Shuffle, RotateCcw, Volume2 } from 'lucide-react';
import { motion } from 'framer-motion';
import { useDJStore } from '@/stores/djStore';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import { toast } from '@/hooks/use-toast';
import React from 'react';

export function NowPlaying() {
  const {
    tracks,
    deckA,
    deckB,
    activeDeck,
    isPartyMode,
    partyTrackIds,
    nowPlayingIndex,
    settings,
    togglePlayPause,
    smartBack,
    restartCurrentTrack,
    skip,
    updateUserSettings,
    setMasterVolume,
  } = useDJStore();

  const currentDeck = activeDeck === 'A' ? deckA : deckB;
  const currentTrack = tracks.find(t => t.id === currentDeck.trackId);
  
  // Get next track from party list
  const nextIndex = nowPlayingIndex + 1;
  const nextTrackId = nextIndex < partyTrackIds.length ? partyTrackIds[nextIndex] : null;
  const nextTrack = nextTrackId ? tracks.find(t => t.id === nextTrackId) : null;
  
  const hasMoreTracks = nowPlayingIndex < partyTrackIds.length - 1 || settings.loopPlaylist;

  const progress = currentDeck.duration > 0 
    ? (currentDeck.currentTime / currentDeck.duration) * 100 
    : 0;

  const startAt = currentTrack
    ? Math.max(0, Math.min(settings.nextSongStartOffset ?? 0, Math.max(0, currentTrack.duration - 0.25)))
    : 0;
  const startPct = currentDeck.duration > 0 ? (startAt / currentDeck.duration) * 100 : 0;

  const endEarlySeconds = Math.max(0, Math.min(settings.endEarlySeconds ?? 0, 60));
  const endAt = currentDeck.duration > 0
    ? Math.max(0, Math.min(currentDeck.duration, currentDeck.duration - endEarlySeconds))
    : 0;
  const endPct = currentDeck.duration > 0 ? (endAt / currentDeck.duration) * 100 : 0;

  const [skipLocked, setSkipLocked] = React.useState(false);
  const skipLockTimerRef = React.useRef<number | null>(null);
  const prevNowPlayingIndexRef = React.useRef(nowPlayingIndex);
  const prevActiveDeckRef = React.useRef(activeDeck);

  const clearSkipLock = () => {
    if (skipLockTimerRef.current !== null) {
      window.clearTimeout(skipLockTimerRef.current);
      skipLockTimerRef.current = null;
    }
    setSkipLocked(false);
  };

  // Unlock Skip once the store advances to the next track/deck.
  React.useEffect(() => {
    const indexChanged = prevNowPlayingIndexRef.current !== nowPlayingIndex;
    const deckChanged = prevActiveDeckRef.current !== activeDeck;

    prevNowPlayingIndexRef.current = nowPlayingIndex;
    prevActiveDeckRef.current = activeDeck;

    if (skipLocked && (indexChanged || deckChanged)) clearSkipLock();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nowPlayingIndex, activeDeck]);

  React.useEffect(() => {
    return () => {
      if (skipLockTimerRef.current !== null) {
        window.clearTimeout(skipLockTimerRef.current);
        skipLockTimerRef.current = null;
      }
    };
  }, []);

  const BACK_RESTART_THRESHOLD = 3;
  const elapsedSinceStart = Math.max(0, currentDeck.currentTime - startAt);
  const backTitle = elapsedSinceStart > BACK_RESTART_THRESHOLD ? 'Restart track' : 'Previous track';

  const handleSkip = () => {
    if (!hasMoreTracks) return;
    if (skipLocked) return;

    setSkipLocked(true);
    toast({
      title: 'Switching songs…',
      description: 'Please wait a moment.',
    });

    skip('user');

    // Fallback unlock in case the store takes longer to update.
    skipLockTimerRef.current = window.setTimeout(() => {
      clearSkipLock();
    }, 6000);
  };

  return (
    <div className="glass-card">
      {/* Album Art with Vinyl Effect */}
      <motion.div
        className={cn(
          'album-art album-art-glow w-[120px] h-[120px] sm:w-[160px] sm:h-[160px] mx-auto mb-3 sm:mb-4',
          currentDeck.isPlaying && 'vinyl-spin'
        )}
        animate={currentDeck.isPlaying ? { rotate: 360 } : { rotate: 0 }}
        transition={{
          duration: 3,
          repeat: currentDeck.isPlaying ? Infinity : 0,
          ease: 'linear',
        }}
      >
        {currentTrack ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <svg className="w-full h-full absolute" viewBox="0 0 100 100">
              <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
              <circle cx="50" cy="50" r="30" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
              <circle cx="50" cy="50" r="20" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
              <circle cx="50" cy="50" r="8" fill="rgba(255,255,255,0.3)" />
            </svg>
            <Music className="w-8 h-8 text-white/40 relative z-10" />
          </div>
        ) : (
          <Music className="w-10 h-10 text-white/40" />
        )}
      </motion.div>

      {/* Track Info */}
      <div className="text-center mb-2 sm:mb-3">
        <h3 className="text-lg font-semibold mb-0.5 truncate">
          {currentTrack?.displayName || 'No Track Selected'}
        </h3>
        <p className="text-xs text-muted-foreground">
          {isPartyMode 
            ? `${nowPlayingIndex + 1} of ${partyTrackIds.length}`
            : 'Press Play to Start'}
        </p>
      </div>

      {/* BPM Display */}
      {(currentTrack?.bpm || currentDeck.playbackRate !== 1) && (
        <div className="flex justify-center gap-4 mb-3">
          {currentTrack?.bpm && (
            <div className="text-center">
              <span className="text-xl font-bold text-accent font-display">
                {Math.round(currentTrack.bpm * currentDeck.playbackRate)}
              </span>
              <span className="block text-[9px] text-muted-foreground uppercase tracking-wider">
                BPM
              </span>
            </div>
          )}

          {currentDeck.playbackRate !== 1 && (
            <div className="text-center">
              <span className="text-xl font-bold text-muted-foreground font-display">
                {(() => {
                  const pct = (currentDeck.playbackRate - 1) * 100;
                  const semitones = 12 * Math.log2(Math.max(0.0001, currentDeck.playbackRate));
                  const sign = pct >= 0 ? '+' : '';
                  return `${sign}${pct.toFixed(1)}% (${semitones >= 0 ? '+' : ''}${semitones.toFixed(2)}st)`;
                })()}
              </span>
              <span className="block text-[9px] text-muted-foreground uppercase tracking-wider">
                Pitch
              </span>
            </div>
          )}
        </div>
      )}

      {/* Progress Bar */}
      <div className="mb-3 sm:mb-4">
        <div className="slider-track">
          {startAt > 0.01 && (
            <>
              <div
                className="start-trim-shade"
                style={{ width: `${Math.max(0, Math.min(100, startPct))}%` }}
              />
              <div
                className="start-trim-tick"
                style={{ left: `${Math.max(0, Math.min(100, startPct))}%` }}
                aria-hidden="true"
              />
            </>
          )}

          {endEarlySeconds > 0.01 && currentDeck.duration > 0 && (
            <>
              <div
                className="end-early-shade"
                style={{
                  left: `${Math.max(0, Math.min(100, endPct))}%`,
                  width: `${Math.max(0, Math.min(100, 100 - endPct))}%`,
                }}
              />
              <div
                className="end-early-tick"
                style={{ left: `${Math.max(0, Math.min(100, endPct))}%` }}
                aria-hidden="true"
              />
            </>
          )}
          <div 
            className="slider-fill transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground">
          <span>{formatDuration(currentDeck.currentTime)}</span>
          <span>-{formatDuration(currentDeck.duration - currentDeck.currentTime)}</span>
        </div>
        {startAt > 0.01 && (
          <div className="mt-1 text-[10px] text-muted-foreground">
            Start: {formatDuration(startAt)}
          </div>
        )}

        {endEarlySeconds > 0.01 && currentDeck.duration > 0 && (
          <div className="mt-1 text-[10px] text-muted-foreground">
            End: {formatDuration(endAt)} (-{Math.round(endEarlySeconds)}s)
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex justify-center items-center gap-4">
        <button
          onClick={() => updateUserSettings({ shuffleEnabled: !settings.shuffleEnabled })}
          className={cn(
            'ctrl-btn ctrl-secondary',
            settings.shuffleEnabled && 'ring-2 ring-primary'
          )}
          title={settings.shuffleEnabled ? 'Shuffle On' : 'Shuffle Off'}
          type="button"
        >
          <Shuffle className="w-4 h-4" />
        </button>

        <button
          onClick={() => smartBack()}
          className="ctrl-btn ctrl-secondary"
          title={backTitle}
          type="button"
        >
          <SkipBack className="w-4 h-4" />
        </button>

        <button
          onClick={() => togglePlayPause()}
          className="ctrl-btn ctrl-primary"
          type="button"
        >
          {currentDeck.isPlaying ? (
            <Pause className="w-6 h-6" />
          ) : (
            <Play className="w-6 h-6 ml-0.5" />
          )}
        </button>

        <button
          onClick={handleSkip}
          className="ctrl-btn ctrl-secondary"
          disabled={!hasMoreTracks || skipLocked}
          title={skipLocked ? 'Switching…' : 'Skip'}
          type="button"
        >
          <SkipForward className="w-4 h-4" />
        </button>

        <button
          onClick={() => restartCurrentTrack()}
          className="ctrl-btn ctrl-secondary"
          title="Restart track"
          type="button"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>

      {/* Master Volume */}
      <div className="mt-3 sm:mt-4 px-2">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Volume2 className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Volume</span>
          </div>
          <span className="text-xs font-semibold text-accent">
            {Math.round((settings.masterVolume ?? 0.9) * 100)}%
          </span>
        </div>
        <Slider
          value={[settings.masterVolume ?? 0.9]}
          onValueChange={([v]) => setMasterVolume(v)}
          min={0}
          max={1}
          step={0.01}
          className="w-full"
        />
      </div>

      {/* Next Up Preview */}
      {nextTrack && (
        <div className="hidden sm:flex mt-4 items-center gap-2 p-2.5 rounded-lg bg-white/5">
          <div className="album-art w-8 h-8 !rounded-md">
            <Music className="w-3 h-3 text-white/60" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-[9px] text-muted-foreground uppercase tracking-wider">Next</span>
            <p className="text-xs font-medium truncate">{nextTrack.displayName}</p>
          </div>
          {nextTrack.bpm && (
            <span className="text-[10px] text-muted-foreground">{Math.round(nextTrack.bpm)} BPM</span>
          )}
        </div>
      )}
    </div>
  );
}
