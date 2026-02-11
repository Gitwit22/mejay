import { Search, Upload, Music, MoreVertical, ListPlus, Check, Plus, X, Play, Trash2 } from 'lucide-react';
import { useState, useRef } from 'react';
import { useDJStore } from '@/stores/djStore';
import { cn, formatDuration } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function LibraryView() {
  const navigate = useNavigate();
  const { 
    tracks, 
    isLoadingTracks, 
    importTracks, 
    removeFromLibrary,
    clearAllImports,
    loadTrackToDeck, 
    deckA,
    playlists,
    addTrackToPlaylist,
    createPlaylist,
    switchPartySourceSmooth,
  } = useDJStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddToPlaylist, setShowAddToPlaylist] = useState<string | null>(null);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [playlistSearchQuery, setPlaylistSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Count only tracks that have a valid fileBlob (playable)
  const playableTracks = tracks.filter(t => t.fileBlob);
  const playableCount = playableTracks.length;

  const filteredTracks = tracks.filter(track =>
    track.displayName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredPlaylists = playlists.filter(p =>
    p.name.toLowerCase().includes(playlistSearchQuery.toLowerCase())
  );

  const fileInputId = 'mejay-import-audio';

  const handleClearAllImports = async () => {
    if (tracks.length === 0) return;
    const ok = window.confirm(
      'This will permanently remove all imported tracks from your device and clear all playlists. Continue?',
    );
    if (!ok) return;
    await clearAllImports();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await importTracks(files);
    }
    // Reset input
    e.target.value = '';
  };

  const handleTrackClick = async (trackId: string) => {
    await loadTrackToDeck(trackId, 'A');
  };

  const handleAddToPlaylist = async (playlistId: string, trackId: string) => {
    await addTrackToPlaylist(playlistId, trackId);
    const playlist = playlists.find(p => p.id === playlistId);
    toast({
      title: 'Added to playlist',
      description: `Track added to "${playlist?.name}"`,
    });
    setShowAddToPlaylist(null);
  };

  const handleCreateAndAdd = async (trackId: string) => {
    if (!newPlaylistName.trim()) return;
    await createPlaylist(newPlaylistName.trim());
    // Find the newly created playlist
    const newPlaylist = useDJStore.getState().playlists.find(p => p.name === newPlaylistName.trim());
    if (newPlaylist) {
      await addTrackToPlaylist(newPlaylist.id, trackId);
      toast({
        title: 'Created & added',
        description: `Track added to "${newPlaylistName.trim()}"`,
      });
    }
    setNewPlaylistName('');
    setShowAddToPlaylist(null);
  };

  const handlePlayImportList = async () => {
    if (playableCount === 0) {
      toast({
        title: 'No playable tracks',
        description: 'Import some music files first, or they may have been lost after refresh.',
        variant: 'destructive',
      });
      return;
    }
    await switchPartySourceSmooth({ type: 'import' });
    navigate('/app?tab=party');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <span className="text-[11px] text-muted-foreground uppercase tracking-[2px]">Your Music</span>
          <h2 className="text-[28px] font-bold text-gradient-accent">Library</h2>
        </div>

        <button
          onClick={handlePlayImportList}
          disabled={playableCount === 0}
          className={cn(
            'mt-1 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors',
            playableCount > 0
              ? 'bg-white/5 hover:bg-white/10 border border-white/10'
              : 'bg-white/5 border border-white/10 opacity-50 cursor-not-allowed'
          )}
          title={playableCount > 0 ? 'Start Party Mode from your Import List' : 'Import music to start Party Mode'}
          type="button"
        >
          <Play className="w-4 h-4" />
          Play Import
        </button>
      </div>

      {/* Import Button */}
      <input
        ref={fileInputRef}
        id={fileInputId}
        type="file"
        // iOS Safari + Gmail downloads can label MP3 attachments as `application/octet-stream`,
        // which makes them appear greyed out if we only accept `audio/*`.
        // Keep this audio-only (no image/video) to avoid iOS offering camera/photo sources.
        accept=".mp3,.m4a,.aac,.wav,.mp4,audio/*,video/*,audio/mpeg,audio/mp3,audio/x-m4a,audio/aac,audio/wav,application/octet-stream"
        multiple
        onChange={handleFileSelect}
        // iOS Safari won’t open the picker reliably when the input is display:none.
        className="sr-only"
      />
      <label
        htmlFor={fileInputId}
        className="btn-primary-gradient flex items-center justify-center gap-2.5 w-full py-4 text-[15px] mb-5 cursor-pointer"
      >
        <Upload className="w-5 h-5" />
        Choose Files
      </label>

      <button
        onClick={handleClearAllImports}
        disabled={tracks.length === 0}
        className={cn(
          'flex items-center justify-center gap-2.5 w-full py-3 text-[13px] rounded-xl border transition-colors mb-5',
          tracks.length > 0
            ? 'border-destructive/40 text-destructive bg-destructive/10 hover:bg-destructive/15'
            : 'border-white/10 text-muted-foreground bg-white/5 opacity-50 cursor-not-allowed',
        )}
        type="button"
        title={tracks.length > 0 ? 'Remove all imported tracks and clear playlists' : 'No imports to clear'}
      >
        <Trash2 className="w-4 h-4" />
        Clear Imports
      </button>

      {/* Search Bar */}
      <div className="flex items-center gap-3 glass-card !p-3 !rounded-xl mb-4">
        <Search className="w-5 h-5 text-muted-foreground" />
        <input
          type="text"
          placeholder="Search tracks..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="flex-1 bg-transparent border-none text-sm outline-none placeholder:text-muted-foreground"
        />
      </div>

      {/* Track List */}
      <div className="flex flex-col gap-2 flex-1 overflow-visible md:overflow-y-auto pb-[calc(84px+env(safe-area-inset-bottom,0)+24px)]">
        {isLoadingTracks ? (
          <div className="flex items-center justify-center py-10">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filteredTracks.length === 0 ? (
          <div className="text-center py-10">
            <Music className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <h4 className="text-lg font-semibold mb-2">No Tracks Yet</h4>
            <p className="text-sm text-muted-foreground mb-5">
              Import some music to get started
            </p>
          </div>
        ) : (
          filteredTracks.map((track) => (
            <div
              key={track.id}
              onClick={() => handleTrackClick(track.id)}
              className={cn(
                'track-item group relative',
                deckA.trackId === track.id && 'playing'
              )}
            >
              {/* Album Art Placeholder */}
              <div className="album-art w-12 h-12 !rounded-lg flex-shrink-0">
                <Music className="w-5 h-5 text-white/60" />
              </div>

              {/* Track Info */}
              <div className="flex-1 min-w-0">
                <h5 className="text-sm font-medium truncate">{track.displayName}</h5>
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <span>{formatDuration(track.duration)}</span>
                  {track.analysisStatus === 'analyzing' && (
                    <span className="badge-analyzing">Analyzing</span>
                  )}
                  {track.analysisStatus === 'ready' && (
                    <span className="badge-ready">Ready</span>
                  )}
                  {track.analysisStatus === 'basic' && (
                    <span className="badge-basic">Basic</span>
                  )}
                </p>
              </div>

              {/* BPM & Actions */}
              <div className="text-right flex items-center gap-2">
                {track.bpm ? (
                  <div>
                    <span className="text-xs font-semibold text-accent">{Math.round(track.bpm)}</span>
                    <span className="block text-[11px] text-muted-foreground">BPM</span>
                  </div>
                ) : null}
                
                {/* 3-dot menu */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      onClick={(e) => e.stopPropagation()}
                      className="p-2 rounded-lg transition-opacity hover:bg-white/10"
                      aria-label="Track actions"
                    >
                      <MoreVertical className="w-4 h-4 text-muted-foreground" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenuItem onSelect={() => setShowAddToPlaylist(track.id)}>
                      <span className="flex items-center gap-2">
                        <ListPlus className="w-4 h-4" />
                        Add to Playlist...
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onSelect={() => {
                        removeFromLibrary(track.id);
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <X className="w-4 h-4" />
                        Delete
                      </span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add to Playlist Modal */}
      {showAddToPlaylist && (
        <div 
          className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50"
          onClick={() => {
            setShowAddToPlaylist(null);
          }}
        >
          <div 
            className="glass-card w-full max-w-sm mx-4 mb-4 sm:mb-0 max-h-[70vh] flex flex-col animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Add to Playlist</h3>
              <button
                onClick={() => {
                  setShowAddToPlaylist(null);
                }}
                className="p-1 rounded-lg hover:bg-white/10"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search playlists */}
            <div className="flex items-center gap-2 bg-white/5 rounded-lg px-3 py-2 mb-3">
              <Search className="w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search playlists..."
                value={playlistSearchQuery}
                onChange={(e) => setPlaylistSearchQuery(e.target.value)}
                className="flex-1 bg-transparent text-sm outline-none"
              />
            </div>

            {/* Playlist list */}
            <div className="flex-1 overflow-y-auto space-y-1 mb-4">
              {filteredPlaylists.length === 0 && playlists.length > 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No playlists match your search
                </p>
              ) : playlists.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No playlists yet
                </p>
              ) : (
                filteredPlaylists.map((playlist) => {
                  const isAlreadyIn = playlist.trackIds.includes(showAddToPlaylist);
                  return (
                    <button
                      key={playlist.id}
                      onClick={() => !isAlreadyIn && handleAddToPlaylist(playlist.id, showAddToPlaylist)}
                      disabled={isAlreadyIn}
                      className={cn(
                        'w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left',
                        isAlreadyIn 
                          ? 'bg-white/5 opacity-50 cursor-not-allowed' 
                          : 'hover:bg-white/10'
                      )}
                    >
                      <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                        <Music className="w-5 h-5 text-white/80" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{playlist.name}</p>
                        <p className="text-xs text-muted-foreground">{playlist.trackIds.length} tracks</p>
                      </div>
                      {isAlreadyIn && (
                        <Check className="w-4 h-4 text-primary" />
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* Divider */}
            <div className="border-t border-white/10 pt-4">
              <p className="text-xs text-muted-foreground mb-2">Or create new playlist</p>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="New playlist name..."
                  value={newPlaylistName}
                  onChange={(e) => setNewPlaylistName(e.target.value)}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
                />
                <button
                  onClick={() => handleCreateAndAdd(showAddToPlaylist)}
                  disabled={!newPlaylistName.trim()}
                  className="btn-primary-gradient px-4 py-2 text-sm disabled:opacity-50"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
