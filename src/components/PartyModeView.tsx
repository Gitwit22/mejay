import { Play, Pause, SkipForward, Music, Shuffle } from 'lucide-react';
import { motion } from 'framer-motion';
import { useDJStore } from '@/stores/djStore';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/utils';

export function PartyModeView() {
  const {
    tracks,
    deckA,
    deckB,
    activeDeck,
    isPartyMode,
    queue,
    settings,
    startPartyMode,
    stopPartyMode,
    togglePlayPause,
    skip,
    setCrossfade,
    updateUserSettings,
  } = useDJStore();

  const currentDeck = activeDeck === 'A' ? deckA : deckB;
  const currentTrack = tracks.find(t => t.id === currentDeck.trackId);
  const nextTrack = queue[0] ? tracks.find(t => t.id === queue[0]) : null;

  const progress = currentDeck.duration > 0 
    ? (currentDeck.currentTime / currentDeck.duration) * 100 
    : 0;

  const handleStartParty = () => {
    if (tracks.length > 0) {
      startPartyMode();
    }
  };

  const handleEnergyChange = (mode: 'chill' | 'normal' | 'hype') => {
    updateUserSettings({ energyMode: mode });
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="mb-5">
        <span className="text-[11px] text-muted-foreground uppercase tracking-[2px]">Auto DJ</span>
        <h2 className="text-[28px] font-bold text-gradient-accent">Party Mode</h2>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col">
        {/* Now Playing Card */}
        <div className="glass-card mb-4">
          {/* Album Art with Vinyl Effect */}
          <motion.div
            className={cn(
              'album-art album-art-glow w-[180px] h-[180px] mx-auto mb-5',
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
                {/* Vinyl Lines */}
                <svg className="w-full h-full absolute" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="40" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
                  <circle cx="50" cy="50" r="30" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
                  <circle cx="50" cy="50" r="20" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="0.5" />
                  <circle cx="50" cy="50" r="8" fill="rgba(255,255,255,0.3)" />
                </svg>
                <Music className="w-10 h-10 text-white/40 relative z-10" />
              </div>
            ) : (
              <Music className="w-12 h-12 text-white/40" />
            )}
          </motion.div>

          {/* Track Info */}
          <div className="text-center mb-4">
            <h3 className="text-xl font-semibold mb-1">
              {currentTrack?.displayName || 'No Track Selected'}
            </h3>
            <p className="text-sm text-muted-foreground">
              {isPartyMode ? 'Party Mode Active' : 'Press Play to Start'}
            </p>
          </div>

          {/* BPM Display */}
          {currentTrack?.bpm && (
            <div className="flex justify-center gap-6 mb-4">
              <div className="text-center">
                <span className="text-2xl font-bold text-accent font-display">
                  {Math.round(currentTrack.bpm)}
                </span>
                <span className="block text-[10px] text-muted-foreground uppercase tracking-wider">
                  BPM
                </span>
              </div>
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
            <div className="flex justify-between mt-2 text-[11px] text-muted-foreground">
              <span>{formatDuration(currentDeck.currentTime)}</span>
              <span>{formatDuration(currentDeck.duration)}</span>
            </div>
          </div>

          {/* Controls */}
          <div className="flex justify-center items-center gap-5">
            <button
              onClick={() => updateUserSettings({ shuffleEnabled: !settings.shuffleEnabled })}
              className={cn(
                'ctrl-btn ctrl-secondary',
                settings.shuffleEnabled && 'ring-2 ring-primary'
              )}
            >
              <Shuffle className="w-5 h-5" />
            </button>

            <button
              onClick={isPartyMode ? () => togglePlayPause() : handleStartParty}
              className="ctrl-btn ctrl-primary"
              disabled={tracks.length === 0}
            >
              {currentDeck.isPlaying ? (
                <Pause className="w-7 h-7" />
              ) : (
                <Play className="w-7 h-7 ml-1" />
              )}
            </button>

            <button
              onClick={skip}
              className="ctrl-btn ctrl-secondary"
              disabled={!isPartyMode || queue.length === 0}
            >
              <SkipForward className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Settings Card */}
        <div className="glass-card">
          {/* Crossfade Slider */}
          <div className="mb-4">
            <div className="flex justify-between mb-2">
              <span className="text-xs text-muted-foreground">Crossfade</span>
              <span className="text-xs font-semibold text-accent">{settings.crossfadeSeconds}s</span>
            </div>
            <input
              type="range"
              min="2"
              max="16"
              value={settings.crossfadeSeconds}
              onChange={(e) => updateUserSettings({ crossfadeSeconds: Number(e.target.value) })}
              className="w-full accent-primary"
            />
          </div>

          {/* Max Tempo Slider */}
          <div className="mb-4">
            <div className="flex justify-between mb-2">
              <span className="text-xs text-muted-foreground">Max Tempo Change</span>
              <span className="text-xs font-semibold text-accent">±{settings.maxTempoPercent}%</span>
            </div>
            <input
              type="range"
              min="2"
              max="12"
              value={settings.maxTempoPercent}
              onChange={(e) => updateUserSettings({ maxTempoPercent: Number(e.target.value) })}
              className="w-full accent-primary"
            />
          </div>

          {/* Energy Toggle */}
          <div>
            <span className="block text-xs text-muted-foreground mb-2">Energy Mode</span>
            <div className="energy-toggle">
              {(['chill', 'normal', 'hype'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => handleEnergyChange(mode)}
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

        {/* Next Up */}
        {nextTrack && (
          <div className="mt-4 flex items-center gap-3 p-3.5 rounded-xl bg-white/5">
            <div className="album-art w-12 h-12 !rounded-lg">
              <Music className="w-5 h-5 text-white/60" />
            </div>
            <div className="flex-1">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Next Up</span>
              <p className="text-sm font-medium truncate">{nextTrack.displayName}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
