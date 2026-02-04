import { Library, ListMusic, Plus, Music, Play } from 'lucide-react';
import { useDJStore } from '@/stores/djStore';
import { cn } from '@/lib/utils';

export function PartySourceChooser() {
  const { tracks, playlists, startPartyMode } = useDJStore();

  const handlePlayFromImport = () => {
    if (tracks.length > 0) {
      startPartyMode({ type: 'import' });
    }
  };

  const handlePlayFromPlaylist = (playlistId: string) => {
    startPartyMode({ type: 'playlist', playlistId });
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center">
      <div className="glass-card max-w-md w-full text-center">
        <Music className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
        <h3 className="text-xl font-bold mb-2">Choose what to play</h3>
        <p className="text-sm text-muted-foreground mb-6">
          Select a source to start your party
        </p>

        <div className="space-y-3">
          {/* Play from Import List */}
          <button
            onClick={handlePlayFromImport}
            disabled={tracks.length === 0}
            className={cn(
              'w-full flex items-center gap-4 p-4 rounded-xl transition-all',
              tracks.length > 0
                ? 'bg-white/5 hover:bg-white/10 border border-white/10 hover:border-primary/50'
                : 'bg-white/5 opacity-50 cursor-not-allowed'
            )}
          >
            <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center">
              <Library className="w-6 h-6 text-primary" />
            </div>
            <div className="flex-1 text-left">
              <h4 className="font-semibold">Play from Import List</h4>
              <p className="text-xs text-muted-foreground">
                {tracks.length > 0 ? `${tracks.length} tracks available` : 'No tracks imported yet'}
              </p>
            </div>
            <Play className="w-5 h-5 text-muted-foreground" />
          </button>

          {/* Playlists */}
          {playlists.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider text-left">
                Or choose a playlist
              </p>
              {playlists.map((playlist) => (
                <button
                  key={playlist.id}
                  onClick={() => handlePlayFromPlaylist(playlist.id)}
                  disabled={playlist.trackIds.length === 0}
                  className={cn(
                    'w-full flex items-center gap-4 p-4 rounded-xl transition-all',
                    playlist.trackIds.length > 0
                      ? 'bg-white/5 hover:bg-white/10 border border-white/10 hover:border-accent/50'
                      : 'bg-white/5 opacity-50 cursor-not-allowed'
                  )}
                >
                  <div className="w-12 h-12 rounded-xl bg-accent/20 flex items-center justify-center">
                    <ListMusic className="w-6 h-6 text-accent" />
                  </div>
                  <div className="flex-1 text-left">
                    <h4 className="font-semibold">{playlist.name}</h4>
                    <p className="text-xs text-muted-foreground">
                      {playlist.trackIds.length} tracks
                    </p>
                  </div>
                  <Play className="w-5 h-5 text-muted-foreground" />
                </button>
              ))}
            </div>
          ) : (
            <div className="p-4 rounded-xl border border-dashed border-white/20 text-center">
              <ListMusic className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No playlists yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Create playlists from the Playlists tab
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
