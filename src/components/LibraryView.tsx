import { Search, Music, MoreVertical, ListPlus, Check, Plus, X, Play, Shield, CheckSquare, Square } from 'lucide-react';
import { useState } from 'react';
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
    removeFromLibrary,
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
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  // When true, the modal adds multiple selected tracks instead of a single one
  const [showAddSelectedToPlaylist, setShowAddSelectedToPlaylist] = useState(false);

  // Count only tracks that are "ready" (have a fileBlob and status === "ready")
  const playableTracks = tracks.filter(t => t.fileBlob && t.status === 'ready');
  const playableCount = playableTracks.length;

  const filteredTracks = tracks.filter(track =>
    track.displayName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredPlaylists = playlists.filter(p =>
    p.name.toLowerCase().includes(playlistSearchQuery.toLowerCase())
  );

  const toggleTrackSelection = (trackId: string) => {
    setSelectedTrackIds(prev => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  const selectAllFiltered = () => {
    const allFilteredIds = new Set(filteredTracks.map(t => t.id));
    const allSelected = filteredTracks.every(t => selectedTrackIds.has(t.id));
    if (allSelected) {
      // Deselect all filtered
      setSelectedTrackIds(prev => {
        const next = new Set(prev);
        for (const id of allFilteredIds) next.delete(id);
        return next;
      });
    } else {
      // Select all filtered
      setSelectedTrackIds(prev => {
        const next = new Set(prev);
        for (const id of allFilteredIds) next.add(id);
        return next;
      });
    }
  };

  const exitSelectMode = () => {
    setIsSelectMode(false);
    setSelectedTrackIds(new Set());
  };

  const handleTrackClick = async (trackId: string) => {
    if (isSelectMode) {
      toggleTrackSelection(trackId);
      return;
    }
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

  const handleAddSelectedToPlaylist = async (playlistId: string) => {
    const playlist = playlists.find(p => p.id === playlistId);
    if (!playlist) return;
    let addedCount = 0;
    for (const trackId of selectedTrackIds) {
      if (!playlist.trackIds.includes(trackId)) {
        await addTrackToPlaylist(playlistId, trackId);
        addedCount++;
      }
    }
    toast({
      title: 'Added to playlist',
      description: `${addedCount} track${addedCount !== 1 ? 's' : ''} added to "${playlist.name}"`,
    });
    setShowAddSelectedToPlaylist(false);
    exitSelectMode();
  };

  const handleCreateAndAdd = async (trackId: string) => {
    if (!newPlaylistName.trim()) return;
    await createPlaylist(newPlaylistName.trim());
    const newPlaylist = useDJStore.getState().playlists.find(p => p.name === newPlaylistName.trim());
    if (newPlaylist) {
      if (showAddSelectedToPlaylist) {
        let addedCount = 0;
        for (const id of selectedTrackIds) {
          if (!newPlaylist.trackIds.includes(id)) {
            await addTrackToPlaylist(newPlaylist.id, id);
            addedCount++;
          }
        }
        toast({
          title: 'Created & added',
          description: `${addedCount} track${addedCount !== 1 ? 's' : ''} added to "${newPlaylistName.trim()}"`,
        });
        setShowAddSelectedToPlaylist(false);
        exitSelectMode();
      } else {
        await addTrackToPlaylist(newPlaylist.id, trackId);
        toast({
          title: 'Created & added',
          description: `Track added to "${newPlaylistName.trim()}"`,
        });
        setShowAddToPlaylist(null);
      }
    }
    setNewPlaylistName('');
  };

  const handlePlayAll = async () => {
    if (playableCount === 0) {
      toast({
        title: 'No playable tracks',
        description: 'Import some music first from the Import tab.',
        variant: 'destructive',
      });
      return;
    }
    await switchPartySourceSmooth({ type: 'import' });
    navigate('/app?tab=party');
  };

  // Determine which track IDs to use for the modal
  const modalTrackIds = showAddSelectedToPlaylist ? selectedTrackIds : (showAddToPlaylist ? new Set([showAddToPlaylist]) : new Set<string>());
  const isModalOpen = showAddToPlaylist !== null || showAddSelectedToPlaylist;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <span className="text-[11px] text-muted-foreground uppercase tracking-[2px]">Your Collection</span>
          <h2 className="text-[28px] font-bold text-gradient-accent">My Music</h2>
        </div>

        <div className="flex items-center gap-2 mt-1">
          {!isSelectMode && tracks.length > 0 && (
            <button
              onClick={() => setIsSelectMode(true)}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
              title="Select multiple tracks"
              type="button"
            >
              <CheckSquare className="w-4 h-4" />
              Select
            </button>
          )}
          {isSelectMode && (
            <button
              onClick={exitSelectMode}
              className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
              type="button"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
          )}
          <button
            onClick={handlePlayAll}
            disabled={playableCount === 0}
            className={cn(
              'inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors',
              playableCount > 0
                ? 'bg-white/5 hover:bg-white/10 border border-white/10'
                : 'bg-white/5 border border-white/10 opacity-50 cursor-not-allowed'
            )}
            title={playableCount > 0 ? 'Play all tracks in Play Mode' : 'Import music first from the Import tab'}
            type="button"
          >
            <Play className="w-4 h-4" />
            Play All
          </button>
        </div>
      </div>

      {/* Selection Action Bar */}
      {isSelectMode && (
        <div className="flex items-center gap-3 mb-4 p-3 rounded-xl bg-primary/10 border border-primary/30">
          <button
            onClick={selectAllFiltered}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
            type="button"
          >
            {filteredTracks.length > 0 && filteredTracks.every(t => selectedTrackIds.has(t.id)) ? (
              <><CheckSquare className="w-3.5 h-3.5" /> Deselect All</>
            ) : (
              <><Square className="w-3.5 h-3.5" /> Select All</>
            )}
          </button>
          <span className="text-xs text-muted-foreground flex-1">
            {selectedTrackIds.size} track{selectedTrackIds.size !== 1 ? 's' : ''} selected
          </span>
          <button
            onClick={() => setShowAddSelectedToPlaylist(true)}
            disabled={selectedTrackIds.size === 0}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium btn-primary-gradient disabled:opacity-40"
            type="button"
          >
            <ListPlus className="w-4 h-4" />
            Add to Playlist
          </button>
        </div>
      )}

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
            <p className="text-sm text-muted-foreground mb-2">
              Your music library is empty.
            </p>
            <p className="text-xs text-muted-foreground mb-5">
              Head to the <strong>Import</strong> tab to add audio files.
            </p>
          </div>
        ) : (
          filteredTracks.map((track) => (
            <div
              key={track.id}
              onClick={() => track.status === 'ready' ? handleTrackClick(track.id) : undefined}
              className={cn(
                'track-item group relative',
                deckA.trackId === track.id && !isSelectMode && 'playing',
                track.status !== 'ready' && 'opacity-50 cursor-not-allowed',
                isSelectMode && 'cursor-pointer',
                isSelectMode && selectedTrackIds.has(track.id) && 'bg-primary/10 border-primary/30'
              )}
            >
              {/* Selection checkbox */}
              {isSelectMode && (
                <div className="flex-shrink-0">
                  {selectedTrackIds.has(track.id) ? (
                    <CheckSquare className="w-5 h-5 text-primary" />
                  ) : (
                    <Square className="w-5 h-5 text-muted-foreground" />
                  )}
                </div>
              )}
              {/* Album Art Placeholder */}
              <div className="album-art w-12 h-12 !rounded-lg flex-shrink-0">
                <Music className="w-5 h-5 text-white/60" />
              </div>

              {/* Track Info */}
              <div className="flex-1 min-w-0">
                <h5 className="text-sm font-medium truncate">{track.displayName}</h5>
                <p className="text-xs text-muted-foreground flex items-center gap-2">
                  <span>{formatDuration(track.duration)}</span>
                  {track.status === 'missing' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 border border-yellow-500/30">Missing</span>
                  )}
                  {track.status === 'error' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-400 border border-red-500/30">Error</span>
                  )}
                  {track.status === 'ready' && track.analysisStatus === 'analyzing' && (
                    <span className="badge-analyzing">Analyzing</span>
                  )}
                  {track.status === 'ready' && track.analysisStatus === 'ready' && (
                    <span className="badge-ready">Ready</span>
                  )}
                  {track.status === 'ready' && track.analysisStatus === 'basic' && (
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
                
                {/* 3-dot menu (hidden in select mode) */}
                {!isSelectMode && (
                  <>
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
                  </>
                )}
                </DropdownMenu>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Add to Playlist Modal (single or multi-track) */}
      {isModalOpen && (
        <div 
          className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50"
          onClick={() => {
            setShowAddToPlaylist(null);
            setShowAddSelectedToPlaylist(false);
          }}
        >
          <div 
            className="glass-card w-full max-w-sm mx-4 mb-4 sm:mb-0 max-h-[70vh] flex flex-col animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">
                {showAddSelectedToPlaylist
                  ? `Add ${selectedTrackIds.size} Track${selectedTrackIds.size !== 1 ? 's' : ''} to Playlist`
                  : 'Add to Playlist'}
              </h3>
              <button
                onClick={() => {
                  setShowAddToPlaylist(null);
                  setShowAddSelectedToPlaylist(false);
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
                  const allAlreadyIn = [...modalTrackIds].every(id => playlist.trackIds.includes(id));
                  return (
                    <button
                      key={playlist.id}
                      onClick={() => {
                        if (allAlreadyIn) return;
                        if (showAddSelectedToPlaylist) {
                          handleAddSelectedToPlaylist(playlist.id);
                        } else if (showAddToPlaylist) {
                          handleAddToPlaylist(playlist.id, showAddToPlaylist);
                        }
                      }}
                      disabled={allAlreadyIn}
                      className={cn(
                        'w-full flex items-center gap-3 p-3 rounded-lg transition-colors text-left',
                        allAlreadyIn 
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
                      {allAlreadyIn && (
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
                  onClick={() => handleCreateAndAdd(showAddToPlaylist ?? '')}
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
