import { Library, ListMusic, Music, Play } from 'lucide-react';
import { useDJStore } from '@/stores/djStore';
import { cn } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

export function PartySourceChooser() {
  const { tracks, playlists, startPartyMode } = useDJStore();
  
  // Count only tracks that have a valid fileBlob (playable)
  const playableTracks = tracks.filter(t => t.fileBlob);
  const playableCount = playableTracks.length;

  const handlePlayFromImport = async () => {
    if (playableCount === 0) {
      toast({
        title: 'No playable tracks',
        description: 'Import some music files first, or they may have been lost after refresh.',
        variant: 'destructive',
      });
      return;
    }
    await startPartyMode({ type: 'import' });
  };

  const handlePlayFromPlaylist = async (playlistId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;
    
    // Check how many tracks in this playlist are playable
    const playableInPlaylist = playlist.trackIds.filter(id => {
      const track = tracks.find(t => t.id === id);
      return track?.fileBlob;
    });
    
    if (playableInPlaylist.length === 0) {
      toast({
        title: 'No playable tracks',
        description: 'This playlist has no playable tracks. Files may have been lost after refresh.',
        variant: 'destructive',
      });
      return;
    }
    
    await startPartyMode({ type: 'playlist', playlistId });
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
                {tracks.length > 0 
                  ? `${playableCount} of ${tracks.length} tracks playable` 
                  : 'No tracks imported yet'}
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
              {playlists.map((playlist) => {
                const playableInPlaylist = playlist.trackIds.filter(id => {
                  const track = tracks.find(t => t.id === id);
                  return track?.fileBlob;
                }).length;
                
                return (
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
                        {playableInPlaylist} of {playlist.trackIds.length} tracks playable
                      </p>
                    </div>
                    <Play className="w-5 h-5 text-muted-foreground" />
                  </button>
                );
              })}
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
