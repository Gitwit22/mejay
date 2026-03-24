import { Upload, Music, Trash2, CheckCircle2, Play, ListPlus, Check, Plus, X, Search, CheckSquare, Square } from 'lucide-react';
import { useState, useRef } from 'react';
import { useDJStore } from '@/stores/djStore';
import { cn, formatDuration } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';

export function ImportRoomView() {
  const navigate = useNavigate();
  const {
    tracks,
    isLoadingTracks,
    importTracks,
    clearAllImports,
    loadTrackToDeck,
    deckA,
    switchPartySourceSmooth,
    playlists,
    addTrackToPlaylist,
    createPlaylist,
  } = useDJStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [recentImportIds, setRecentImportIds] = useState<Set<string>>(new Set());
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [showAddToPlaylist, setShowAddToPlaylist] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [playlistSearchQuery, setPlaylistSearchQuery] = useState('');

  const fileInputId = 'mejay-import-audio';

  const handleClearAllImports = async () => {
    if (tracks.length === 0) return;
    const ok = window.confirm(
      'This will permanently remove all imported tracks from your device and clear all playlists. Continue?',
    );
    if (!ok) return;
    await clearAllImports();
    setRecentImportIds(new Set());
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      // Hard-block non-audio (100% in code).
      const audioExtRe = /\.(mp3|wav|m4a|aac|flac|ogg)$/i;
      const invalid = Array.from(files).find((f) => {
        const type = (f.type || '').toLowerCase();
        return !(type.startsWith('audio/') || audioExtRe.test(f.name));
      });

      if (invalid) {
        toast({
          title: 'Audio files only',
          description: 'Please select an audio file (mp3, wav, m4a, etc.).',
          variant: 'destructive',
        });
        e.target.value = '';
        return;
      }

      const beforeIds = new Set(useDJStore.getState().tracks.map(t => t.id));

      try {
        await importTracks(files);
        // Identify newly imported tracks
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
          toast({
            title: 'Import complete',
            description: `${newIds.size} track${newIds.size !== 1 ? 's' : ''} added to your library.`,
          });
        }
      } catch (error) {
        console.error('[Import] Import failed:', error);
        toast({
          title: 'Import failed',
          description: 'Something blocked the import on this device. Try again, or try a different browser (Safari) and ensure Private Browsing is off.',
          variant: 'destructive',
        });
      }
    }
    // Reset input
    e.target.value = '';
  };

  const recentTracks = tracks.filter(t => recentImportIds.has(t.id));
  const playableRecentCount = recentTracks.filter(t => t.fileBlob && t.status === 'ready').length;

  const toggleTrackSelection = (trackId: string) => {
    setSelectedTrackIds(prev => {
      const next = new Set(prev);
      if (next.has(trackId)) next.delete(trackId);
      else next.add(trackId);
      return next;
    });
  };

  const selectAllRecent = () => {
    const allIds = new Set(recentTracks.map(t => t.id));
    const allSelected = recentTracks.every(t => selectedTrackIds.has(t.id));
    if (allSelected) {
      setSelectedTrackIds(prev => {
        const next = new Set(prev);
        for (const id of allIds) next.delete(id);
        return next;
      });
    } else {
      setSelectedTrackIds(prev => {
        const next = new Set(prev);
        for (const id of allIds) next.add(id);
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

  const filteredPlaylists = playlists.filter(p =>
    p.name.toLowerCase().includes(playlistSearchQuery.toLowerCase())
  );

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
    setShowAddToPlaylist(false);
    exitSelectMode();
  };

  const handleCreateAndAddSelected = async () => {
    if (!newPlaylistName.trim()) return;
    await createPlaylist(newPlaylistName.trim());
    const newPlaylist = useDJStore.getState().playlists.find(p => p.name === newPlaylistName.trim());
    if (newPlaylist) {
      let addedCount = 0;
      for (const trackId of selectedTrackIds) {
        if (!newPlaylist.trackIds.includes(trackId)) {
          await addTrackToPlaylist(newPlaylist.id, trackId);
          addedCount++;
        }
      }
      toast({
        title: 'Created & added',
        description: `${addedCount} track${addedCount !== 1 ? 's' : ''} added to "${newPlaylistName.trim()}"`,
      });
    }
    setNewPlaylistName('');
    setShowAddToPlaylist(false);
    exitSelectMode();
  };

  const handlePlayAll = async () => {
    if (playableRecentCount === 0) return;
    await switchPartySourceSmooth({ type: 'import' });
    navigate('/app?tab=party');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="mb-5">
        <span className="text-[11px] text-muted-foreground uppercase tracking-[2px]">Add Music</span>
        <h2 className="text-[28px] font-bold text-gradient-accent">Import Room</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Import audio files to add them to your library.
        </p>
      </div>

      {/* Import Button */}
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        className="btn-primary-gradient flex items-center justify-center gap-2.5 w-full py-4 text-[15px] mb-5"
      >
        <Upload className="w-5 h-5" />
        Import Audio Files
      </button>

      <input
        ref={fileInputRef}
        id={fileInputId}
        type="file"
        accept="audio/*,application/octet-stream,.mp3,.wav,.m4a,.aac,.flac,.ogg"
        multiple
        onChange={handleFileSelect}
        className="sr-only"
      />

      {/* Clear All Button */}
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
        Clear All Library Tracks
      </button>

      {/* Content area */}
      <div className="flex flex-col gap-2 flex-1 overflow-visible md:overflow-y-auto pb-[calc(84px+env(safe-area-inset-bottom,0)+24px)]">
        {isLoadingTracks ? (
          <div className="flex items-center justify-center py-10">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : recentTracks.length > 0 ? (
          <>
            {/* Recently imported */}
            <div className="mb-2 flex items-center justify-between">
              <div>
                <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                  Recently Imported
                </h4>
                <p className="text-[11px] text-muted-foreground mb-3">
                  Tap a track to preview it, or hit <strong>Play All</strong> to start Play Mode.
                  Save tracks to a playlist before clearing.
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                {!isSelectMode && recentTracks.length > 0 && (
                  <button
                    onClick={() => setIsSelectMode(true)}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                    type="button"
                    title="Select tracks to add to playlist"
                  >
                    <CheckSquare className="w-3.5 h-3.5" />
                    Select
                  </button>
                )}
                {isSelectMode && (
                  <button
                    onClick={exitSelectMode}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                    type="button"
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                )}
                {playableRecentCount > 0 && !isSelectMode && (
                  <button
                    onClick={handlePlayAll}
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-medium bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
                    type="button"
                  >
                    <Play className="w-3.5 h-3.5" />
                    Play All
                  </button>
                )}
              </div>
            </div>

            {/* Selection Action Bar */}
            {isSelectMode && (
              <div className="flex items-center gap-3 mb-3 p-3 rounded-xl bg-primary/10 border border-primary/30">
                <button
                  onClick={selectAllRecent}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
                  type="button"
                >
                  {recentTracks.length > 0 && recentTracks.every(t => selectedTrackIds.has(t.id)) ? (
                    <><CheckSquare className="w-3.5 h-3.5" /> Deselect All</>
                  ) : (
                    <><Square className="w-3.5 h-3.5" /> Select All</>
                  )}
                </button>
                <span className="text-xs text-muted-foreground flex-1">
                  {selectedTrackIds.size} selected
                </span>
                <button
                  onClick={() => setShowAddToPlaylist(true)}
                  disabled={selectedTrackIds.size === 0}
                  className="inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-medium btn-primary-gradient disabled:opacity-40"
                  type="button"
                >
                  <ListPlus className="w-3.5 h-3.5" />
                  Add to Playlist
                </button>
              </div>
            )}

            {recentTracks.map((track) => (
              <div
                key={track.id}
                onClick={() => track.status === 'ready' ? handleTrackClick(track.id) : undefined}
                className={cn(
                  'track-item group relative',
                  track.status === 'ready' && 'cursor-pointer',
                  deckA.trackId === track.id && !isSelectMode && 'playing',
                  track.status !== 'ready' && 'opacity-60 cursor-not-allowed',
                  isSelectMode && selectedTrackIds.has(track.id) && 'bg-primary/10 border-primary/30'
                )}
              >
                {isSelectMode && (
                  <div className="flex-shrink-0">
                    {selectedTrackIds.has(track.id) ? (
                      <CheckSquare className="w-5 h-5 text-primary" />
                    ) : (
                      <Square className="w-5 h-5 text-muted-foreground" />
                    )}
                  </div>
                )}
                <div className="album-art w-12 h-12 !rounded-lg flex-shrink-0">
                  <Music className="w-5 h-5 text-white/60" />
                </div>
                <div className="flex-1 min-w-0">
                  <h5 className="text-sm font-medium truncate">{track.displayName}</h5>
                  <p className="text-xs text-muted-foreground flex items-center gap-2">
                    <span>{formatDuration(track.duration)}</span>
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
                {!isSelectMode && <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />}
              </div>
            ))}
          </>
        ) : (
          /* Empty state */
          <div className="text-center py-10">
            <Upload className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
            <h4 className="text-lg font-semibold mb-2">Import Your Music</h4>
            <p className="text-sm text-muted-foreground mb-2">
              Tap the button above to select audio files
            </p>
            <p className="text-xs text-muted-foreground">
              Supports MP3, WAV, M4A, AAC, FLAC, and OGG
            </p>
            {tracks.length > 0 && (
              <p className="text-xs text-muted-foreground mt-4 border-t border-white/10 pt-4">
                You have <strong>{tracks.length}</strong> track{tracks.length !== 1 ? 's' : ''} in your library.
                Browse them in <strong>My Music</strong>.
              </p>
            )}
          </div>
        )}
      </div>

      {/* Add to Playlist Modal */}
      {showAddToPlaylist && (
        <div 
          className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50"
          onClick={() => setShowAddToPlaylist(false)}
        >
          <div 
            className="glass-card w-full max-w-sm mx-4 mb-4 sm:mb-0 max-h-[70vh] flex flex-col animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">
                Add {selectedTrackIds.size} Track{selectedTrackIds.size !== 1 ? 's' : ''} to Playlist
              </h3>
              <button
                onClick={() => setShowAddToPlaylist(false)}
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
                  const allAlreadyIn = [...selectedTrackIds].every(id => playlist.trackIds.includes(id));
                  return (
                    <button
                      key={playlist.id}
                      onClick={() => !allAlreadyIn && handleAddSelectedToPlaylist(playlist.id)}
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

            {/* Create new playlist */}
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
                  onClick={handleCreateAndAddSelected}
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
