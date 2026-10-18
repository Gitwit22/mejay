import { Plus, Trash2, Play, Edit2, Shield } from 'lucide-react';
import { useState, useMemo } from 'react';
import { useDJStore } from '@/stores/djStore';
import { useNavigate } from 'react-router-dom';

export function PlaylistsView() {
  const navigate = useNavigate();
  const { playlists, tracks, createPlaylist, deletePlaylistById, startPartyMode } = useDJStore();
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');

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
                  if (!window.confirm(`Delete the playlist "${playlist.name}"? Your tracks stay in My Music.`)) return;
                  void deletePlaylistById(playlist.id);
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
