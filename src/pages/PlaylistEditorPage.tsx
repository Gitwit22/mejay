import { useState, useCallback, useMemo, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useDJStore } from '@/stores/djStore';
import { cn, formatDuration } from '@/lib/utils';
import { Track } from '@/lib/db';
import { toast } from '@/hooks/use-toast';
import {
  ArrowLeft,
  Save,
  X,
  Music,
  Plus,
  Trash2,
  ChevronUp,
  ChevronDown,
  Search,
  Library,
  ListMusic,
  Loader2,
  AlertCircle,
  Check,
} from 'lucide-react';

export default function PlaylistEditorPage() {
  const { playlistId } = useParams<{ playlistId: string }>();
  const navigate = useNavigate();

  const playlists = useDJStore((s) => s.playlists);
  const tracks = useDJStore((s) => s.tracks);
  const isLoadingTracks = useDJStore((s) => s.isLoadingTracks);

  const playlist = playlists.find((p) => p.id === playlistId);

  // --- Local editor state ---
  const [editorName, setEditorName] = useState('');
  const [editorTrackIds, setEditorTrackIds] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);

  // Initialize editor state from playlist data
  useEffect(() => {
    if (playlist && !initialized) {
      setEditorName(playlist.name);
      setEditorTrackIds([...playlist.trackIds]);
      setInitialized(true);
    }
  }, [playlist, initialized]);

  // Dirty state detection
  const isDirty = useMemo(() => {
    if (!playlist) return false;
    if (editorName !== playlist.name) return true;
    if (editorTrackIds.length !== playlist.trackIds.length) return true;
    return editorTrackIds.some((id, i) => id !== playlist.trackIds[i]);
  }, [playlist, editorName, editorTrackIds]);

  // All library tracks (ready ones with blobs)
  const libraryTracks = useMemo(
    () => tracks.filter((t) => t.status === 'ready'),
    [tracks],
  );

  // Tracks in the editor playlist (resolve from IDs)
  const trackMap = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks]);
  const editorTracks = useMemo(
    () =>
      editorTrackIds
        .map((id) => trackMap.get(id))
        .filter((t): t is Track => t !== undefined),
    [editorTrackIds, trackMap],
  );

  // Set of track IDs currently in the playlist (for quick lookup)
  const inPlaylistSet = useMemo(() => new Set(editorTrackIds), [editorTrackIds]);

  // Filtered My Music tracks based on search
  const filteredLibraryTracks = useMemo(() => {
    if (!searchQuery.trim()) return libraryTracks;
    const q = searchQuery.toLowerCase();
    return libraryTracks.filter(
      (t) =>
        t.displayName.toLowerCase().includes(q) ||
        (t.artist && t.artist.toLowerCase().includes(q)) ||
        (t.fileName && t.fileName.toLowerCase().includes(q)),
    );
  }, [libraryTracks, searchQuery]);

  // --- Actions ---
  const goBack = useCallback(() => {
    navigate('/app?tab=playlists');
  }, [navigate]);

  const handleAddTrack = useCallback(
    (trackId: string) => {
      if (inPlaylistSet.has(trackId)) return;
      setEditorTrackIds((prev) => [...prev, trackId]);
    },
    [inPlaylistSet],
  );

  const handleRemoveTrack = useCallback((trackId: string) => {
    setEditorTrackIds((prev) => prev.filter((id) => id !== trackId));
  }, []);

  const handleMoveUp = useCallback((index: number) => {
    if (index <= 0) return;
    setEditorTrackIds((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, []);

  const handleMoveDown = useCallback((index: number) => {
    setEditorTrackIds((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!playlistId || !isDirty) return;
    setIsSaving(true);
    try {
      const { updatePlaylistDetails } = useDJStore.getState();
      await updatePlaylistDetails(playlistId, {
        name: editorName.trim() || 'Untitled Playlist',
        trackIds: editorTrackIds,
      });
      toast({ title: 'Playlist saved', description: `"${editorName.trim()}" updated successfully.` });
      goBack();
    } catch {
      toast({ title: 'Save failed', description: 'Could not save the playlist. Please try again.', variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [playlistId, isDirty, editorName, editorTrackIds, goBack]);

  const handleCancel = useCallback(() => {
    if (isDirty) {
      const ok = window.confirm('You have unsaved changes. Discard them?');
      if (!ok) return;
    }
    goBack();
  }, [isDirty, goBack]);

  // --- Not Found State ---
  if (!playlistId || (!playlist && !isLoadingTracks)) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
        <AlertCircle className="w-16 h-16 text-muted-foreground" />
        <h2 className="text-xl font-bold">Playlist Not Found</h2>
        <p className="text-sm text-muted-foreground text-center">
          This playlist may have been deleted or the link is invalid.
        </p>
        <button onClick={goBack} className="btn-primary-gradient px-6 py-3 flex items-center gap-2">
          <ArrowLeft className="w-4 h-4" />
          Back to Playlists
        </button>
      </div>
    );
  }

  // --- Loading State ---
  if (!initialized || isLoadingTracks) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6">
        <Loader2 className="w-10 h-10 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading playlist…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ===== HEADER ===== */}
      <div className="flex-shrink-0 border-b border-white/10 p-4">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={handleCancel}
            className="p-2 rounded-lg hover:bg-white/10 transition-colors"
            title="Back"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="flex-1 min-w-0">
            <input
              type="text"
              value={editorName}
              onChange={(e) => setEditorName(e.target.value)}
              className="w-full bg-transparent text-xl font-bold outline-none border-b border-transparent focus:border-primary transition-colors placeholder:text-muted-foreground"
              placeholder="Playlist name…"
            />
          </div>

          <div className="flex gap-2 flex-shrink-0">
            <button
              onClick={handleCancel}
              className="btn-glass px-4 py-2 text-sm flex items-center gap-1.5"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={!isDirty || isSaving}
              className={cn(
                'px-4 py-2 text-sm flex items-center gap-1.5 rounded-xl transition-colors',
                isDirty && !isSaving
                  ? 'btn-primary-gradient'
                  : 'bg-white/5 text-muted-foreground cursor-not-allowed border border-white/10',
              )}
            >
              {isSaving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Save className="w-4 h-4" />
              )}
              Save
            </button>
          </div>
        </div>

        {isDirty && (
          <p className="text-xs text-yellow-400 pl-11">Unsaved changes</p>
        )}
      </div>

      {/* ===== MAIN CONTENT: Two-panel layout ===== */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* --- LEFT PANEL: Songs in Playlist --- */}
        <div className="flex-1 flex flex-col border-r border-white/10 min-h-0">
          <div className="flex items-center gap-2 p-4 border-b border-white/5 flex-shrink-0">
            <ListMusic className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wider">
              Songs in Playlist
            </h3>
            <span className="text-xs text-muted-foreground ml-auto">
              {editorTracks.length} track{editorTracks.length !== 1 ? 's' : ''}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {editorTracks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4 py-10">
                <Music className="w-12 h-12 text-muted-foreground mb-3" />
                <h4 className="text-sm font-semibold mb-1">No songs yet</h4>
                <p className="text-xs text-muted-foreground">
                  Add songs from <strong>My Music</strong> on the right to build your playlist.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {editorTracks.map((track, index) => (
                  <div
                    key={track.id}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-white/5 group transition-colors"
                  >
                    <span className="text-xs text-muted-foreground w-6 text-center flex-shrink-0">
                      {index + 1}
                    </span>
                    <div className="album-art w-10 h-10 !rounded-lg flex-shrink-0">
                      <Music className="w-4 h-4 text-white/60" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <h5 className={cn('text-sm font-medium truncate', track.status !== 'ready' && 'text-muted-foreground')}>
                        {track.displayName}
                      </h5>
                      <p className="text-xs text-muted-foreground truncate">
                        {track.artist || 'Unknown Artist'}
                        {track.duration > 0 && <span> · {formatDuration(track.duration)}</span>}
                        {track.bpm ? <span> · {Math.round(track.bpm)} BPM</span> : null}
                      </p>
                    </div>

                    {/* Reorder + Remove */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      <button
                        onClick={() => handleMoveUp(index)}
                        disabled={index === 0}
                        className="p-1.5 rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move up"
                      >
                        <ChevronUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleMoveDown(index)}
                        disabled={index === editorTracks.length - 1}
                        className="p-1.5 rounded hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed"
                        title="Move down"
                      >
                        <ChevronDown className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => handleRemoveTrack(track.id)}
                        className="p-1.5 rounded hover:bg-destructive/20"
                        title="Remove from playlist"
                      >
                        <Trash2 className="w-3.5 h-3.5 text-destructive" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* --- RIGHT PANEL: My Music --- */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-2 p-4 border-b border-white/5 flex-shrink-0">
            <Library className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold uppercase tracking-wider">
              My Music
            </h3>
            <span className="text-xs text-muted-foreground ml-auto">
              {libraryTracks.length} song{libraryTracks.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* Search */}
          <div className="p-3 border-b border-white/5 flex-shrink-0">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by title, artist…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:border-primary transition-colors"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {libraryTracks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4 py-10">
                <Music className="w-12 h-12 text-muted-foreground mb-3" />
                <h4 className="text-sm font-semibold mb-1">No music yet</h4>
                <p className="text-xs text-muted-foreground">
                  Import songs from the <strong>Import</strong> tab to start building playlists.
                </p>
              </div>
            ) : filteredLibraryTracks.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-4 py-10">
                <Search className="w-10 h-10 text-muted-foreground mb-3" />
                <h4 className="text-sm font-semibold mb-1">No matches</h4>
                <p className="text-xs text-muted-foreground">
                  Try a different search term.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {filteredLibraryTracks.map((track) => {
                  const alreadyAdded = inPlaylistSet.has(track.id);
                  return (
                    <div
                      key={track.id}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 rounded-lg transition-colors',
                        alreadyAdded ? 'opacity-60' : 'hover:bg-white/5 cursor-pointer',
                      )}
                      onDoubleClick={() => handleAddTrack(track.id)}
                    >
                      <div className="album-art w-10 h-10 !rounded-lg flex-shrink-0">
                        <Music className="w-4 h-4 text-white/60" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h5 className="text-sm font-medium truncate">{track.displayName}</h5>
                        <p className="text-xs text-muted-foreground truncate">
                          {track.artist || 'Unknown Artist'}
                          {track.duration > 0 && <span> · {formatDuration(track.duration)}</span>}
                          {track.bpm ? <span> · {Math.round(track.bpm)} BPM</span> : null}
                        </p>
                      </div>

                      {alreadyAdded ? (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground flex-shrink-0 px-2 py-1">
                          <Check className="w-3.5 h-3.5" />
                          Added
                        </span>
                      ) : (
                        <button
                          onClick={() => handleAddTrack(track.id)}
                          className="p-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 transition-colors flex-shrink-0"
                          title="Add to playlist"
                        >
                          <Plus className="w-4 h-4 text-primary" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
