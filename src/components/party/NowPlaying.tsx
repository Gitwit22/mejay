import { Play, Pause, SkipForward, Music, Shuffle, Repeat } from 'lucide-react';
import { motion } from 'framer-motion';
import { useDJStore } from '@/stores/djStore';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/utils';

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
    skip,
    updateUserSettings,
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

  return (
    <div className="glass-card">
      {/* Album Art with Vinyl Effect */}
      <motion.div
        className={cn(
          'album-art album-art-glow w-[160px] h-[160px] mx-auto mb-4',
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
      <div className="text-center mb-3">
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
      {currentTrack?.bpm && (
        <div className="flex justify-center gap-4 mb-3">
          <div className="text-center">
            <span className="text-xl font-bold text-accent font-display">
              {Math.round(currentTrack.bpm * currentDeck.playbackRate)}
            </span>
            <span className="block text-[9px] text-muted-foreground uppercase tracking-wider">
              BPM
            </span>
          </div>
          {currentDeck.playbackRate !== 1 && (
            <div className="text-center">
              <span className="text-xl font-bold text-muted-foreground font-display">
                {((currentDeck.playbackRate - 1) * 100).toFixed(1)}%
              </span>
              <span className="block text-[9px] text-muted-foreground uppercase tracking-wider">
                Pitch
              </span>
            </div>
          )}
        </div>
      )}

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="slider-track">
          <div 
            className="slider-fill transition-all duration-200"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground">
          <span>{formatDuration(currentDeck.currentTime)}</span>
          <span>-{formatDuration(currentDeck.duration - currentDeck.currentTime)}</span>
        </div>
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
        >
          <Shuffle className="w-4 h-4" />
        </button>

        <button
          onClick={() => togglePlayPause()}
          className="ctrl-btn ctrl-primary"
        >
          {currentDeck.isPlaying ? (
            <Pause className="w-6 h-6" />
          ) : (
            <Play className="w-6 h-6 ml-0.5" />
          )}
        </button>

        <button
          onClick={skip}
          className="ctrl-btn ctrl-secondary"
          disabled={!hasMoreTracks}
          title="Skip"
        >
          <SkipForward className="w-4 h-4" />
        </button>
        
        <button
          onClick={() => updateUserSettings({ loopPlaylist: !settings.loopPlaylist })}
          className={cn(
            'ctrl-btn ctrl-secondary',
            settings.loopPlaylist && 'ring-2 ring-accent'
          )}
          title={settings.loopPlaylist ? 'Loop On' : 'Loop Off'}
        >
          <Repeat className="w-4 h-4" />
        </button>
      </div>

      {/* Next Up Preview */}
      {nextTrack && (
        <div className="mt-4 flex items-center gap-2 p-2.5 rounded-lg bg-white/5">
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
