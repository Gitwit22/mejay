import { Music, GripVertical, Play, X, Shuffle, Trash2 } from 'lucide-react';
import { useDJStore } from '@/stores/djStore';
import { cn } from '@/lib/utils';
import { formatDuration } from '@/lib/utils';

export function QueuePanel() {
  const {
    queue,
    tracks,
    settings,
    deckA,
    deckB,
    activeDeck,
    shuffleQueue,
    clearQueue,
    playNext,
    removeFromQueue,
    moveQueueItem,
    updateUserSettings,
  } = useDJStore();

  const currentDeck = activeDeck === 'A' ? deckA : deckB;
  const currentTrack = tracks.find(t => t.id === currentDeck.trackId);
  const queueTracks = queue.map(id => tracks.find(t => t.id === id)).filter(Boolean);

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
      moveQueueItem(fromIndex, toIndex);
    }
  };

  return (
    <div className="glass-card h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-foreground">Up Next</h3>
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
            onClick={shuffleQueue}
            className="text-[10px] text-muted-foreground hover:text-foreground px-2 py-1 rounded-lg hover:bg-white/5"
          >
            Shuffle Now
          </button>
          <button
            onClick={clearQueue}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive transition-colors"
            title="Clear Queue"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Now Playing */}
      {currentTrack && (
        <div className="mb-3 p-3 rounded-xl bg-primary/10 border border-primary/20">
          <span className="text-[10px] text-primary uppercase tracking-wider font-medium">Now Playing</span>
          <div className="flex items-center gap-3 mt-1">
            <div className="album-art w-10 h-10 !rounded-lg">
              <Music className="w-4 h-4 text-white/60" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{currentTrack.displayName}</p>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                {currentTrack.bpm && <span>{Math.round(currentTrack.bpm)} BPM</span>}
                <span>{formatDuration(currentTrack.duration)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Queue List */}
      <div className="flex-1 overflow-y-auto space-y-1 scrollbar-thin">
        {queueTracks.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            Queue is empty
          </div>
        ) : (
          queueTracks.map((track, index) => (
            <div
              key={track!.id}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, index)}
              className="flex items-center gap-2 p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors group cursor-grab active:cursor-grabbing"
            >
              <GripVertical className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-muted-foreground" />
              
              <span className="text-[10px] text-muted-foreground w-5">{index + 1}</span>
              
              <div className="album-art w-8 h-8 !rounded-md">
                <Music className="w-3 h-3 text-white/60" />
              </div>
              
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{track!.displayName}</p>
                <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
                  {track!.bpm && <span>{Math.round(track!.bpm)} BPM</span>}
                  <span>{formatDuration(track!.duration)}</span>
                </div>
              </div>
              
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => playNext(track!.id)}
                  className="p-1 rounded hover:bg-primary/20 text-muted-foreground hover:text-primary"
                  title="Play Next"
                >
                  <Play className="w-3 h-3" />
                </button>
                <button
                  onClick={() => removeFromQueue(track!.id)}
                  className="p-1 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive"
                  title="Remove"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Queue Stats */}
      <div className="mt-3 pt-3 border-t border-white/10 text-[10px] text-muted-foreground">
        {queueTracks.length} tracks • {formatDuration(queueTracks.reduce((acc, t) => acc + (t?.duration || 0), 0))} total
      </div>
    </div>
  );
}
