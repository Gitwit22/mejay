import { Plus, ListMusic, Trash2, Music, Play, Edit2, ArrowUpDown, GripVertical, Shield, Upload, Check } from 'lucide-react';
import { useState, useCallback, useMemo, useRef } from 'react';
import { useDJStore } from '@/stores/djStore';
import { cn, formatDuration } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { Track } from '@/lib/db';
import { toast } from '@/hooks/use-toast';

// Playlist Track List Component with drag reordering
function PlaylistTrackList({ 
  tracks, 
  playlistId, 
  isReordering, 
  onRemove 
}: { 
  tracks: Track[]; 
  playlistId: string; 
  isReordering: boolean; 
  onRemove: (trackId: string) => void;
}) {
  const { reorderPlaylistTracks } = useDJStore();
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (index: number) => {
    setDraggedIndex(index);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (toIndex: number) => {
    if (draggedIndex !== null && draggedIndex !== toIndex) {
      reorderPlaylistTracks(playlistId, draggedIndex, toIndex);
    }
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  return (
    <>
      {tracks.map((track, index) => (
        <div 
          key={track.id} 
          className={cn(
            "track-item group transition-all",
            isReordering && "cursor-grab active:cursor-grabbing",
            draggedIndex === index && "opacity-50",
            dragOverIndex === index && draggedIndex !== index && "border-t-2 border-primary",
            track.status !== 'ready' && !isReordering && "opacity-60"
          )}
          draggable={isReordering}
          onDragStart={() => handleDragStart(index)}
          onDragOver={(e) => handleDragOver(e, index)}
          onDrop={() => handleDrop(index)}
          onDragEnd={handleDragEnd}
        >
          {isReordering ? (
            <GripVertical className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          ) : (
            <span className="text-xs text-muted-foreground w-6">{index + 1}</span>
          )}
          <div className="album-art w-12 h-12 !rounded-lg flex-shrink-0">
            <Music className="w-5 h-5 text-white/60" />
          </div>
          <div className="flex-1 min-w-0">
            <h5 className={cn("text-sm font-medium truncate", track.status !== 'ready' && "text-muted-foreground")}>{track.displayName}</h5>
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              {track.status === 'missing' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">Unavailable</span>
              )}
              {track.status === 'ready' && track.bpm ? `${Math.round(track.bpm)} BPM` : (track.status === 'ready' ? 'No BPM' : '')}
              {track.status === 'ready' && <span>•</span>}
              {track.status === 'ready' && <span>{formatDuration(track.duration)}</span>}
            </p>
          </div>
          {!isReordering && (
            <button
              onClick={() => onRemove(track.id)}
              className="opacity-0 group-hover:opacity-100 p-2 rounded-lg transition-opacity hover:bg-destructive/20"
            >
              <Trash2 className="w-4 h-4 text-destructive" />
            </button>
          )}
        </div>
      ))}
    </>
  );
}

export function PlaylistsView() {
  const navigate = useNavigate();
  const { playlists, tracks, createPlaylist, deletePlaylistById, startPartyMode, removeFromPlaylist, clearPlaylistTracks, importTracks, addTrackToPlaylist } = useDJStore();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [selectedPlaylist, setSelectedPlaylist] = useState<string | null>(null);
  const [isReordering, setIsReordering] = useState(false);
  const [recentImportIds, setRecentImportIds] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleCreate = async () => {
    if (newPlaylistName.trim()) {
      await createPlaylist(newPlaylistName.trim());
      setNewPlaylistName('');
      setShowCreateDialog(false);
    }
  };

  const handlePlayPlaylist = async (playlistId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;
    // Only proceed if there is at least one ready (playable) track in the playlist.
    const hasReady = playlist.trackIds.some(id => {
      const t = tracks.find(t => t.id === id);
      return t && t.fileBlob && t.status === 'ready';
    });
    if (!hasReady) return;
    await startPartyMode({ type: 'playlist', playlistId });
    navigate('/app?tab=party');
  };

  const handleImportForPlaylist = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !selectedPlaylist) return;

    const audioExtRe = /\.(mp3|wav|m4a|aac|flac|ogg)$/i;
    const invalid = Array.from(files).find((f) => {
      const type = (f.type || '').toLowerCase();
      return !(type.startsWith('audio/') || audioExtRe.test(f.name));
    });
    if (invalid) {
      toast({ title: 'Audio files only', description: 'Please select an audio file (mp3, wav, m4a, etc.).', variant: 'destructive' });
      e.target.value = '';
      return;
    }

    const beforeIds = new Set(useDJStore.getState().tracks.map(t => t.id));
    try {
      await importTracks(files);
      const afterTracks = useDJStore.getState().tracks;
      const newIds = new Set<string>();
      for (const t of afterTracks) {
        if (!beforeIds.has(t.id)) newIds.add(t.id);
      }
      setRecentImportIds(prev => {
        const merged = new Set(prev);
        for (const id of newIds) merged.add(id);
        return merged;
      });
      if (newIds.size > 0) {
        toast({ title: 'Import complete', description: `${newIds.size} track${newIds.size !== 1 ? 's' : ''} imported. Tap + to add to this playlist.` });
      }
    } catch {
      toast({ title: 'Import failed', description: 'Something went wrong. Try again.', variant: 'destructive' });
    }
    e.target.value = '';
  };

  const handleQuickAdd = async (trackId: string) => {
    if (!selectedPlaylist) return;
    await addTrackToPlaylist(selectedPlaylist, trackId);
    const playlist = playlists.find(p => p.id === selectedPlaylist);
    toast({ title: 'Added to playlist', description: `Track added to "${playlist?.name}"` });
  };

  const handleAddAllImported = async () => {
    if (!selectedPlaylist) return;
    const playlist = playlists.find(p => p.id === selectedPlaylist);
    if (!playlist) return;
    let addedCount = 0;
    for (const track of recentlyImportedTracks) {
      if (track.status === 'ready' && !playlist.trackIds.includes(track.id)) {
        await addTrackToPlaylist(selectedPlaylist, track.id);
        addedCount++;
      }
    }
    if (addedCount > 0) {
      toast({ title: 'Added to playlist', description: `${addedCount} track${addedCount !== 1 ? 's' : ''} added to "${playlist.name}"` });
    }
  };

  const recentlyImportedTracks = tracks.filter(t => recentImportIds.has(t.id));

  const selectedPlaylistData = playlists.find(p => p.id === selectedPlaylist);
  // Include all known tracks for the playlist (both ready and missing) so the UI
  // can show unavailable tracks instead of silently hiding them.
  const playlistTracks = selectedPlaylistData
    ? selectedPlaylistData.trackIds
        .map(id => tracks.find(t => t.id === id))
        .filter((t): t is Track => t !== undefined)
    : [];
  const playlistReadyCount = playlistTracks.filter(t => t.status === 'ready' && t.fileBlob).length;
  const playlistMissingCount = playlistTracks.length - playlistReadyCount;

  const handleClearPlaylist = async (playlistId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist || playlist.trackIds.length === 0) return;
    const ok = window.confirm(`Remove all tracks from "${playlist.name}"?`);
    if (!ok) return;
    await clearPlaylistTracks(playlistId);
  };

  if (selectedPlaylist && selectedPlaylistData) {
    return (
      <div className="flex flex-col h-full">
        {/* Header */}
        <div className="mb-5">
          <button
            onClick={() => setSelectedPlaylist(null)}
            className="text-[11px] text-primary uppercase tracking-[2px] hover:underline"
          >
            ← Back to Playlists
          </button>
          <h2 className="text-[28px] font-bold text-gradient-accent">{selectedPlaylistData.name}</h2>
          <p className="text-sm text-muted-foreground">
            {playlistReadyCount} track{playlistReadyCount !== 1 ? 's' : ''}
            {playlistMissingCount > 0 && (
              <span className="ml-1.5 text-yellow-400">· {playlistMissingCount} unavailable</span>
            )}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mb-5">
          {playlistReadyCount > 0 && (
            <button
              onClick={() => handlePlayPlaylist(selectedPlaylist)}
              className="btn-primary-gradient flex items-center justify-center gap-2.5 flex-1 py-4 text-[15px]"
            >
              <Play className="w-5 h-5" />
              Play This Set
            </button>
          )}

          <button
            onClick={() => handleClearPlaylist(selectedPlaylist)}
            disabled={selectedPlaylistData.trackIds.length === 0}
            className={cn(
              'flex items-center justify-center gap-2 px-4 py-4 rounded-xl text-[15px] transition-colors',
              selectedPlaylistData.trackIds.length > 0
                ? 'bg-destructive/10 text-destructive hover:bg-destructive/15 border border-destructive/30'
                : 'bg-white/5 text-muted-foreground border border-white/10 opacity-50 cursor-not-allowed',
            )}
            title="Clear all tracks from this set"
          >
            <Trash2 className="w-5 h-5" />
            Clear
          </button>

          <button
            onClick={() => setIsReordering(!isReordering)}
            className={cn(
              'flex items-center justify-center gap-2 px-4 py-4 rounded-xl text-[15px] transition-colors',
              isReordering 
                ? 'bg-primary text-primary-foreground' 
                : 'btn-glass'
            )}
          >
            <ArrowUpDown className="w-5 h-5" />
            {isReordering ? 'Done' : 'Reorder'}
          </button>
        </div>

        {/* Import Button for Playlist */}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center justify-center gap-2.5 w-full py-3 text-[13px] rounded-xl border border-primary/40 text-primary bg-primary/10 hover:bg-primary/15 transition-colors mb-4"
        >
          <Upload className="w-4 h-4" />
          Import Songs to Add
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*,application/octet-stream,.mp3,.wav,.m4a,.aac,.flac,.ogg"
          multiple
          onChange={handleImportForPlaylist}
          className="sr-only"
        />

        {/* Recently Imported Section */}
        {recentlyImportedTracks.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs text-muted-foreground uppercase tracking-wider">Recently Imported — Tap + to add</h4>
              {(() => {
                const notYetAdded = recentlyImportedTracks.filter(t => t.status === 'ready' && !selectedPlaylistData?.trackIds.includes(t.id));
                return notYetAdded.length > 0 ? (
                  <button
                    onClick={handleAddAllImported}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium btn-primary-gradient"
                    type="button"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add All ({notYetAdded.length})
                  </button>
                ) : null;
              })()}
            </div>
            <div className="flex flex-col gap-1.5">
              {recentlyImportedTracks.map((track) => {
                const alreadyInPlaylist = selectedPlaylistData?.trackIds.includes(track.id);
                return (
                  <div key={track.id} className="track-item group">
                    <div className="album-art w-10 h-10 !rounded-lg flex-shrink-0">
                      <Music className="w-4 h-4 text-white/60" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h5 className="text-sm font-medium truncate">{track.displayName}</h5>
                      <p className="text-xs text-muted-foreground flex items-center gap-2">
                        <span>{formatDuration(track.duration)}</span>
                        {track.bpm ? <span>{Math.round(track.bpm)} BPM</span> : null}
                      </p>
                    </div>
                    {alreadyInPlaylist ? (
                      <span className="p-2 text-primary"><Check className="w-4 h-4" /></span>
                    ) : (
                      <button
                        onClick={() => handleQuickAdd(track.id)}
                        disabled={track.status !== 'ready'}
                        className="p-2 rounded-lg bg-primary/20 hover:bg-primary/30 transition-colors disabled:opacity-40"
                        title="Add to this playlist"
                      >
                        <Plus className="w-4 h-4 text-primary" />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Track List */}
        <div className="flex flex-col gap-2 flex-1 overflow-y-auto pb-[calc(84px+env(safe-area-inset-bottom,0)+24px)]">
          {playlistTracks.length === 0 && recentlyImportedTracks.length === 0 ? (
            <div className="text-center py-10">
              <Music className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
              <h4 className="text-lg font-semibold mb-2">Empty Playlist</h4>
              <p className="text-sm text-muted-foreground">
                Import songs above or add tracks from <strong>My Music</strong> using the ⋯ menu.
              </p>
            </div>
          ) : (
            <PlaylistTrackList
              tracks={playlistTracks}
              playlistId={selectedPlaylist}
              isReordering={isReordering}
              onRemove={(trackId) => removeFromPlaylist(selectedPlaylist, trackId)}
            />
          )}
        </div>
      </div>
    );
  }

  // Precompute ready/total counts for all playlist cards to avoid per-render inline scans.
  const playlistCardStats = useMemo(() => {
    // Build a track-ID → track map for O(1) lookups inside the playlist loops.
    const trackMap = new Map(tracks.map(t => [t.id, t]));
    const stats: Record<string, { ready: number; total: number }> = {};
    for (const playlist of playlists) {
      let ready = 0;
      for (const id of playlist.trackIds) {
        const t = trackMap.get(id);
        if (t && t.status === 'ready') ready++;
      }
      stats[playlist.id] = { ready, total: playlist.trackIds.length };
    }
    return stats;
  }, [playlists, tracks]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="mb-5">
        <span className="text-[11px] text-muted-foreground uppercase tracking-[2px]">Your Sets</span>
        <h2 className="text-[28px] font-bold text-gradient-accent">Playlists</h2>
      </div>

      {/* Playlist Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 flex-1 overflow-y-auto pb-[calc(84px+env(safe-area-inset-bottom,0)+24px)]">
        {/* Create Playlist Button */}
        <button
          onClick={() => setShowCreateDialog(true)}
          className="create-playlist-btn !py-4 !gap-1.5"
        >
          <Plus className="w-6 h-6" />
          <span className="text-[11px] font-medium">Create Playlist</span>
        </button>

        {/* Playlists */}
        {playlists.map((playlist) => (
          <div
            key={playlist.id}
            className="playlist-card group relative !p-2"
          >
            {/* Cover Art Grid */}
            <div 
              onClick={() => handlePlayPlaylist(playlist.id)}
              className="aspect-square rounded-lg mb-2 grid grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden cursor-pointer"
            >
              <div className="bg-gradient-to-br from-primary to-secondary" />
              <div className="bg-gradient-to-br from-secondary to-accent" />
              <div className="bg-gradient-to-br from-accent to-primary" />
              <div className="bg-gradient-to-br from-secondary to-primary" />
            </div>

            <h5 className="text-[13px] font-semibold mb-0.5 truncate">{playlist.name}</h5>
            <p className="text-[10px] text-muted-foreground">
              {(() => {
                const { ready, total } = playlistCardStats[playlist.id] ?? { ready: 0, total: 0 };
                if (ready < total) return `${ready}/${total} tracks`;
                return `${total} track${total !== 1 ? 's' : ''}`;
              })()}
            </p>

            {/* Actions */}
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {(playlistCardStats[playlist.id]?.ready ?? 0) > 0 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handlePlayPlaylist(playlist.id);
                  }}
                  className="p-2 rounded-lg bg-primary/80 hover:bg-primary transition-colors"
                  title="Play"
                >
                  <Play className="w-4 h-4 text-white" />
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/app/playlist/${playlist.id}/edit`);
                }}
                className="p-2 rounded-lg bg-background/80 hover:bg-white/20 transition-colors"
                title="Edit"
              >
                <Edit2 className="w-4 h-4" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  deletePlaylistById(playlist.id);
                }}
                className="p-2 rounded-lg bg-background/80 hover:bg-destructive/20 transition-colors"
                title="Delete"
              >
                <Trash2 className="w-4 h-4 text-destructive" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Create Playlist Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="glass-card w-full max-w-sm">
            <h3 className="text-lg font-bold mb-4">Create Playlist</h3>
            <input
              type="text"
              placeholder="Playlist name..."
              value={newPlaylistName}
              onChange={(e) => setNewPlaylistName(e.target.value)}
              className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm outline-none focus:border-primary mb-4"
              autoFocus
            />
            <div className="flex gap-3">
              <button
                onClick={() => setShowCreateDialog(false)}
                className="btn-glass flex-1 py-3"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                className="btn-primary-gradient flex-1 py-3"
                disabled={!newPlaylistName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Dev Admin Button */}
      {import.meta.env.DEV && (
        <button
          onClick={() => navigate('/app/dev-admin')}
          className="fixed bottom-[calc(84px+env(safe-area-inset-bottom,0)+8px)] right-4 p-2 rounded-lg bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 transition-colors z-10"
          title="Dev Admin"
        >
          <Shield className="w-4 h-4 text-red-400" />
        </button>
      )}
    </div>
  );
}
