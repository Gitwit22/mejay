import { Plus, ListMusic, Trash2, Music, Play, Edit2, ArrowUpDown, GripVertical, Shield } from 'lucide-react';
import { useState, useCallback } from 'react';
import { useDJStore } from '@/stores/djStore';
import { cn, formatDuration } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';
import { Track } from '@/lib/db';

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
            dragOverIndex === index && draggedIndex !== index && "border-t-2 border-primary"
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
            <h5 className="text-sm font-medium truncate">{track.displayName}</h5>
            <p className="text-xs text-muted-foreground flex items-center gap-2">
              {track.bpm ? `${Math.round(track.bpm)} BPM` : 'No BPM'}
              <span>•</span>
              <span>{formatDuration(track.duration)}</span>
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
  const { playlists, tracks, createPlaylist, deletePlaylistById, startPartyMode, removeFromPlaylist, clearPlaylistTracks } = useDJStore();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [selectedPlaylist, setSelectedPlaylist] = useState<string | null>(null);
  const [isReordering, setIsReordering] = useState(false);

  const handleCreate = async () => {
    if (newPlaylistName.trim()) {
      await createPlaylist(newPlaylistName.trim());
      setNewPlaylistName('');
      setShowCreateDialog(false);
    }
  };

  const handlePlayPlaylist = async (playlistId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (playlist && playlist.trackIds.length > 0) {
      await startPartyMode({ type: 'playlist', playlistId });
      // Navigate to party mode tab
      navigate('/app?tab=party');
    }
  };

  const selectedPlaylistData = playlists.find(p => p.id === selectedPlaylist);
  const playlistTracks = selectedPlaylistData
    ? selectedPlaylistData.trackIds
        .map(id => tracks.find(t => t.id === id))
        .filter((t): t is Track => t !== undefined)
    : [];

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
          <p className="text-sm text-muted-foreground">{playlistTracks.length} tracks</p>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 mb-5">
          {playlistTracks.length > 0 && (
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

        {/* Track List */}
        <div className="flex flex-col gap-2 flex-1 overflow-y-auto pb-[calc(84px+env(safe-area-inset-bottom,0)+24px)]">
          {playlistTracks.length === 0 ? (
            <div className="text-center py-10">
              <Music className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
              <h4 className="text-lg font-semibold mb-2">Empty Playlist</h4>
              <p className="text-sm text-muted-foreground">
                Add tracks from your Library using the ⋯ menu
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

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="mb-5">
        <span className="text-[11px] text-muted-foreground uppercase tracking-[2px]">Party Sets</span>
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
          <span className="text-[11px] font-medium">Create Party Set</span>
        </button>

        {/* Playlists */}
        {playlists.map((playlist) => (
          <div
            key={playlist.id}
            className="playlist-card group relative !p-2"
          >
            {/* Cover Art Grid */}
            <div 
              onClick={() => setSelectedPlaylist(playlist.id)}
              className="aspect-square rounded-lg mb-2 grid grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden cursor-pointer"
            >
              <div className="bg-gradient-to-br from-primary to-secondary" />
              <div className="bg-gradient-to-br from-secondary to-accent" />
              <div className="bg-gradient-to-br from-accent to-primary" />
              <div className="bg-gradient-to-br from-secondary to-primary" />
            </div>

            <h5 className="text-[13px] font-semibold mb-0.5 truncate">{playlist.name}</h5>
            <p className="text-[10px] text-muted-foreground">
              {playlist.trackIds.length} tracks
            </p>

            {/* Actions */}
            <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {playlist.trackIds.length > 0 && (
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
                  setSelectedPlaylist(playlist.id);
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
            <h3 className="text-lg font-bold mb-4">Create Party Set</h3>
            <input
              type="text"
              placeholder="Set name..."
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
