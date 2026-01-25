import { Plus, ListMusic, Trash2, Music } from 'lucide-react';
import { useState } from 'react';
import { useDJStore } from '@/stores/djStore';
import { cn } from '@/lib/utils';

export function PlaylistsView() {
  const { playlists, tracks, createPlaylist, deletePlaylistById, startPartyMode } = useDJStore();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [selectedPlaylist, setSelectedPlaylist] = useState<string | null>(null);

  const handleCreate = async () => {
    if (newPlaylistName.trim()) {
      await createPlaylist(newPlaylistName.trim());
      setNewPlaylistName('');
      setShowCreateDialog(false);
    }
  };

  const handlePlayPlaylist = (playlistId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (playlist && playlist.trackIds.length > 0) {
      startPartyMode(playlist.trackIds);
    }
  };

  const selectedPlaylistData = playlists.find(p => p.id === selectedPlaylist);
  const playlistTracks = selectedPlaylistData
    ? tracks.filter(t => selectedPlaylistData.trackIds.includes(t.id))
    : [];

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

        {/* Play Button */}
        {playlistTracks.length > 0 && (
          <button
            onClick={() => handlePlayPlaylist(selectedPlaylist)}
            className="btn-primary-gradient flex items-center justify-center gap-2.5 w-full py-4 text-[15px] mb-5"
          >
            <ListMusic className="w-5 h-5" />
            Play This Set
          </button>
        )}

        {/* Track List */}
        <div className="flex flex-col gap-2 flex-1 overflow-y-auto pb-4">
          {playlistTracks.length === 0 ? (
            <div className="text-center py-10">
              <Music className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
              <h4 className="text-lg font-semibold mb-2">Empty Playlist</h4>
              <p className="text-sm text-muted-foreground">
                Add tracks from your Library
              </p>
            </div>
          ) : (
            playlistTracks.map((track) => (
              <div key={track.id} className="track-item">
                <div className="album-art w-12 h-12 !rounded-lg flex-shrink-0">
                  <Music className="w-5 h-5 text-white/60" />
                </div>
                <div className="flex-1 min-w-0">
                  <h5 className="text-sm font-medium truncate">{track.displayName}</h5>
                  <p className="text-xs text-muted-foreground">
                    {track.bpm ? `${Math.round(track.bpm)} BPM` : 'No BPM'}
                  </p>
                </div>
              </div>
            ))
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
      <div className="grid grid-cols-2 gap-3 flex-1 overflow-y-auto pb-4">
        {/* Create Playlist Button */}
        <button
          onClick={() => setShowCreateDialog(true)}
          className="create-playlist-btn"
        >
          <Plus className="w-8 h-8" />
          <span className="text-xs font-medium">Create Party Set</span>
        </button>

        {/* Playlists */}
        {playlists.map((playlist) => (
          <div
            key={playlist.id}
            onClick={() => setSelectedPlaylist(playlist.id)}
            className="playlist-card group relative"
          >
            {/* Cover Art Grid */}
            <div className="aspect-square rounded-xl mb-2.5 grid grid-cols-2 grid-rows-2 gap-0.5 overflow-hidden">
              <div className="bg-gradient-to-br from-primary to-secondary" />
              <div className="bg-gradient-to-br from-secondary to-accent" />
              <div className="bg-gradient-to-br from-accent to-primary" />
              <div className="bg-gradient-to-br from-secondary to-primary" />
            </div>

            <h5 className="text-sm font-semibold mb-0.5 truncate">{playlist.name}</h5>
            <p className="text-[11px] text-muted-foreground">
              {playlist.trackIds.length} tracks
            </p>

            {/* Delete Button */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                deletePlaylistById(playlist.id);
              }}
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 p-2 rounded-lg bg-background/80 transition-opacity hover:bg-destructive/20"
            >
              <Trash2 className="w-4 h-4 text-destructive" />
            </button>
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
    </div>
  );
}
