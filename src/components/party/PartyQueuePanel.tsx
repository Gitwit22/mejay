import { Music, GripVertical, Play, SkipForward, Shuffle, Repeat, Check, Trash2 } from 'lucide-react';
import { useDJStore } from '@/stores/djStore';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/utils';
import { useRef, useEffect } from 'react';
import { computeTempoShiftInfo, getTempoCapDecision } from '@/lib/tempoMatch';
import { usePlanStore } from '@/stores/planStore';

type PartyQueuePanelProps = {
  className?: string;
};

export function PartyQueuePanel({ className }: PartyQueuePanelProps) {
  const {
    partyTrackIds,
    nowPlayingIndex,
    pendingNextIndex,
    tracks,
    playlists,
    partySource,
    settings,
    activeDeck,
    deckA,
    deckB,
    shufflePartyTracks,
    playNow,
    playNext,
    moveTrackInParty,
    updateUserSettings,
    removeFromCurrentSource,
  } = useDJStore();

  const tempoControlEnabled = usePlanStore((s) => s.hasFeature('tempoControl'));

  const targetBpm = (() => {
    if (settings.tempoMode === 'locked') return settings.lockedBpm;

    if (settings.tempoMode === 'auto') {
      if (settings.autoBaseBpm !== null && Number.isFinite(settings.autoBaseBpm)) {
        const offset = Number.isFinite(settings.autoOffsetBpm) ? (settings.autoOffsetBpm ?? 0) : 0;
        return settings.autoBaseBpm + offset;
      }
    }

    const currentDeck = activeDeck === 'A' ? deckA : deckB;
    const currentTrack = currentDeck.trackId ? tracks.find((t) => t.id === currentDeck.trackId) : undefined;
    if (!currentTrack?.bpm) return null;
    return currentTrack.bpm * (currentDeck.playbackRate || 1);
  })();

  const playingFromLabel = (() => {
    if (partySource?.type === 'playlist' && partySource.playlistId) {
      const name = playlists.find(p => p.id === partySource.playlistId)?.name;
      return name ? `Playlist — ${name}` : 'Playlist';
    }
    return 'Import List';
  })();

  const listRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLDivElement>(null);

  // Get all party tracks with their indices
  const partyTracks = partyTrackIds.map((id, index) => ({
    track: tracks.find(t => t.id === id),
    index,
    state: index < nowPlayingIndex ? 'played' : index === nowPlayingIndex ? 'playing' : 'upcoming',
    isPendingNext: pendingNextIndex === index,
  })).filter(item => item.track);

  // Auto-scroll to current track
  useEffect(() => {
    if (currentRef.current && listRef.current) {
      currentRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [nowPlayingIndex]);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('text/plain', index.toString());
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
    if (fromIndex !== toIndex) {
      moveTrackInParty(fromIndex, toIndex);
    }
  };

  return (
    <div className={cn('glass-card flex flex-col min-h-0', className)}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Queue</h3>
          <p className="text-[10px] text-muted-foreground truncate">Playing from: {playingFromLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => updateUserSettings({ shuffleEnabled: !settings.shuffleEnabled })}
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              settings.shuffleEnabled 
                ? 'bg-primary/20 text-primary' 
                : 'text-muted-foreground hover:text-foreground'
            )}
            title={settings.shuffleEnabled ? 'Shuffle On' : 'Shuffle Off'}
          >
            <Shuffle className="w-4 h-4" />
          </button>
          <button
            onClick={shufflePartyTracks}
            className="text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-white/5"
          >
            Shuffle Now
          </button>
          <button
            onClick={() => updateUserSettings({ loopPlaylist: !settings.loopPlaylist })}
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              settings.loopPlaylist 
                ? 'bg-primary/20 text-primary' 
                : 'text-muted-foreground hover:text-foreground'
            )}
            title={settings.loopPlaylist ? 'Loop On' : 'Loop Off'}
          >
            <Repeat className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Track List */}
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-1 scrollbar-thin pr-1 pb-[calc(84px+env(safe-area-inset-bottom,0)+28px)]"
      >
        {partyTracks.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            No tracks in queue
          </div>
        ) : (
          partyTracks.map(({ track, index, state, isPendingNext }) => (
            <div
              key={`${track!.id}-${index}`}
              ref={state === 'playing' ? currentRef : null}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, index)}
              className={cn(
                'flex items-center gap-2 p-2 rounded-lg transition-colors group',
                state === 'playing' && 'bg-primary/20 border border-primary/30',
                state === 'upcoming' && 'bg-white/5 hover:bg-white/10',
                isPendingNext && 'ring-2 ring-accent',
                'cursor-grab active:cursor-grabbing'
              )}
            >
              <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-muted-foreground" />
              
              {/* State indicator */}
              <div className="w-5 flex justify-center">
                {state === 'playing' ? (
                  <span className="text-primary text-xs">▶</span>
                ) : state === 'played' ? (
                  <Check className="w-3 h-3 text-muted-foreground" />
                ) : (
                  <span className="text-[10px] text-muted-foreground">{index + 1}</span>
                )}
              </div>
              
              <div className="album-art w-8 h-8 !rounded-md">
                <Music className="w-3 h-3 text-white/60" />
              </div>
              
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{track!.displayName}</p>
                <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                  {track!.bpm && <span>{Math.round(track!.bpm)} BPM</span>}
                  {track!.bpm && targetBpm && Number.isFinite(targetBpm) && (
                    (() => {
                      const info = computeTempoShiftInfo(track!.bpm!, targetBpm);
                      const hint = info.interpretation === 'half' ? '½×' : info.interpretation === 'double' ? '2×' : null;

                      const cap = getTempoCapDecision({
                        tempoControlEnabled,
                        tempoMode: settings.tempoMode,
                        requiredShiftPct: info.requiredShiftPct,
                        rawMaxTempoPercent: settings.maxTempoPercent,
                        nearCapFraction: 0.8,
                      });

                      const dotClasses = cap.variant === 'disabled'
                        ? 'bg-white/30 ring-white/10'
                        : (cap.variant === 'over_cap'
                            ? 'bg-rose-500/80 ring-rose-500/30'
                            : (cap.variant === 'near_cap'
                                ? 'bg-yellow-500/80 ring-yellow-500/30'
                                : 'bg-emerald-500/80 ring-emerald-500/30'));

                      const tooltip = cap.variant === 'disabled'
                        ? 'Tempo Control disabled (upgrade required)'
                        : (cap.variant === 'over_cap'
                            ? `Will NOT tempo-match (needs ~${Math.round(info.requiredShiftPct)}% > cap ${Math.round(cap.capPctUsed)}%). Still quantizes + crossfades.`
                            : (cap.variant === 'near_cap'
                                ? `Will tempo-match (near cap: ~${Math.round(info.requiredShiftPct)}% of ${Math.round(cap.capPctUsed)}%).`
                                : `Will tempo-match (~${Math.round(info.requiredShiftPct)}% shift).`));

                      return (
                        <span className="inline-flex items-center gap-1">
                          <span
                            className={cn(
                              'inline-block h-1.5 w-1.5 rounded-full ring-2 ring-offset-0 ring-transparent',
                              dotClasses
                            )}
                            title={tooltip}
                          />
                          <span title={tooltip}>{Math.round(info.requiredShiftPct)}%{hint ? ` ${hint}` : ''}</span>
                        </span>
                      );
                    })()
                  )}
                  <span>{formatDuration(track!.duration)}</span>
                  {isPendingNext && <span className="text-accent font-medium">Up Next</span>}
                </div>
              </div>
              
              {/* Actions for any non-current track (mobile shows without hover) */}
              <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                {state !== 'playing' && (
                  <>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        playNow(index);
                      }}
                      className="p-1 rounded hover:bg-primary/20 text-muted-foreground hover:text-primary"
                      title="Play Now"
                    >
                      <Play className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        playNext(index);
                      }}
                      className="p-1 rounded hover:bg-accent/20 text-muted-foreground hover:text-accent"
                      title="Play Next"
                    >
                      <SkipForward className="w-3 h-3" />
                    </button>
                  </>
                )}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFromCurrentSource(track!.id);
                  }}
                  className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                  title="Remove"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Stats */}
      <div className="mt-3 pt-3 border-t border-white/10 text-[10px] text-muted-foreground">
        {partyTrackIds.length} tracks • {nowPlayingIndex + 1} of {partyTrackIds.length} • {formatDuration(
          partyTracks
            .filter(t => t.state === 'upcoming')
            .reduce((acc, t) => acc + (t.track?.duration || 0), 0)
        )} remaining
      </div>
    </div>
  );
}
