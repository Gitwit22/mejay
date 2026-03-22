import { Upload, Music, Trash2, CheckCircle2 } from 'lucide-react';
import { useState, useRef } from 'react';
import { useDJStore } from '@/stores/djStore';
import { cn, formatDuration } from '@/lib/utils';
import { toast } from '@/hooks/use-toast';

export function ImportRoomView() {
  const {
    tracks,
    isLoadingTracks,
    importTracks,
    clearAllImports,
  } = useDJStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [recentImportIds, setRecentImportIds] = useState<Set<string>>(new Set());

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
            <div className="mb-2">
              <h4 className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
                Recently Imported
              </h4>
              <p className="text-[11px] text-muted-foreground mb-3">
                These tracks are now in your library. Go to <strong>My Music</strong> to browse, or <strong>Playlists</strong> to organize them.
              </p>
            </div>
            {recentTracks.map((track) => (
              <div
                key={track.id}
                className="track-item group relative"
              >
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
                <CheckCircle2 className="w-4 h-4 text-green-400 flex-shrink-0" />
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
    </div>
  );
}
