import { Search, Upload, Trash2, Music } from 'lucide-react';
import { useState, useRef } from 'react';
import { useDJStore } from '@/stores/djStore';
import { cn, formatDuration } from '@/lib/utils';

export function LibraryView() {
  const { tracks, isLoadingTracks, importTracks, deleteTrackById, loadTrackToDeck, deckA } = useDJStore();
  const [searchQuery, setSearchQuery] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredTracks = tracks.filter(track =>
    track.displayName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      await importTracks(files);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleTrackClick = async (trackId: string) => {
    await loadTrackToDeck(trackId, 'A');
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="mb-5">
        <span className="text-[11px] text-muted-foreground uppercase tracking-[2px]">Your Music</span>
        <h2 className="text-[28px] font-bold text-gradient-accent">Library</h2>
      </div>

      {/* Import Button */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        multiple
        onChange={handleFileSelect}
        className="hidden"
      />
      <button
        onClick={handleImport}
        className="btn-primary-gradient flex items-center justify-center gap-2.5 w-full py-4 text-[15px] mb-5"
      >
        <Upload className="w-5 h-5" />
        Import Music
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
      <div className="flex flex-col gap-2 flex-1 overflow-y-auto pb-4">
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
                'track-item group',
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
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteTrackById(track.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-2 rounded-lg transition-opacity hover:bg-destructive/20"
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
