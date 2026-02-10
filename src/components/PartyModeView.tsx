import { useMemo, useState } from 'react';
import { ListMusic, Music, Library, Settings } from 'lucide-react';
import { useDJStore } from '@/stores/djStore';
import { cn } from '@/lib/utils';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { NowPlaying } from './party/NowPlaying';
import { PartyQueuePanel } from './party/PartyQueuePanel';
import { MixControls } from './party/MixControls';
import { TempoControls } from './party/TempoControls';
import { VolumeControls } from './party/VolumeControls';
import { PartySourceChooser } from './party/PartySourceChooser';

type PanelView = 'queue' | 'settings';

export function PartyModeView() {
  const [activePanel, setActivePanel] = useState<PanelView>('queue');
  const [saveOpen, setSaveOpen] = useState(false);
  const [playlistName, setPlaylistName] = useState('');

  const {
    isPartyMode,
    partySource,
    partyTrackIds,
    nowPlayingIndex,
    playlists,
    settings,
    updateUserSettings,
    switchPartySourceSmooth,
    saveCurrentPartyAsPlaylist,
  } = useDJStore();

  const upcomingCount = partyTrackIds.length - nowPlayingIndex - 1;

  const selectedSourceValue = useMemo(() => {
    if (!partySource) return undefined;
    return partySource.type === 'import' ? 'import' : (partySource.playlistId ?? undefined);
  }, [partySource]);
  
  // Get source label
  const getSourceLabel = () => {
    if (!partySource) return null;
    if (partySource.type === 'import') return 'Import List';
    const playlist = playlists.find(p => p.id === partySource.playlistId);
    return playlist ? `Playlist — ${playlist.name}` : 'Playlist';
  };

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Single scroll owner for Party Mode (prevents double-scroll with app shell). */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-thin pb-[calc(84px+env(safe-area-inset-bottom,0)+28px)]">
        {/* Header (sticky within the Party Mode scroll container) */}
        <div className="sticky top-0 z-20 bg-background/80 backdrop-blur border-b border-white/10">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 py-3">
            <div>
              <h2 className="text-[22px] sm:text-[24px] font-bold text-gradient-accent">Party Mode</h2>
              {isPartyMode && partySource && (
                <div className="flex items-center gap-1.5 mt-1">
                  {partySource.type === 'import' ? (
                    <Library className="w-3 h-3 text-muted-foreground" />
                  ) : (
                    <Music className="w-3 h-3 text-muted-foreground" />
                  )}
                  <span className="text-[10px] text-muted-foreground">
                    Playing from: {getSourceLabel()}
                  </span>
                </div>
              )}
            </div>

            {/* Panel Toggle */}
            {isPartyMode && (
              <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
                <div className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-xl bg-white/5 w-full sm:w-auto">
                  <span className="text-[10px] text-muted-foreground">Source</span>
                  <Select
                    value={selectedSourceValue}
                    onValueChange={async (value) => {
                      if (value === selectedSourceValue) return;
                      if (value === 'import') {
                        await switchPartySourceSmooth({ type: 'import' });
                        return;
                      }
                      await switchPartySourceSmooth({ type: 'playlist', playlistId: value });
                    }}
                  >
                    <SelectTrigger className="h-8 w-full sm:w-[190px] bg-white/5 border-white/10 text-xs">
                      <SelectValue placeholder="Choose source" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="import">Import List</SelectItem>
                      {playlists.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {partySource?.type === 'import' && (
                    <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
                      <DialogTrigger asChild>
                        <button
                          type="button"
                          className="text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                          title="Save the current import list as a playlist"
                        >
                          Save
                        </button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Save as Playlist</DialogTitle>
                          <DialogDescription>
                            Save your current Import List so you can reuse it later.
                          </DialogDescription>
                        </DialogHeader>

                        <div className="space-y-2">
                          <label className="text-sm font-medium">Playlist name</label>
                          <Input
                            value={playlistName}
                            onChange={(e) => setPlaylistName(e.target.value)}
                            placeholder="e.g. Friday Night Set"
                          />
                        </div>

                        <DialogFooter>
                          <Button variant="secondary" onClick={() => setSaveOpen(false)} type="button">
                            Cancel
                          </Button>
                          <Button
                            onClick={async () => {
                              const id = await saveCurrentPartyAsPlaylist(playlistName);
                              if (!id) {
                                toast({
                                  title: 'Could not save playlist',
                                  description: 'Enter a name and make sure Party Mode has tracks.',
                                  variant: 'destructive',
                                });
                                return;
                              }
                              toast({
                                title: 'Playlist saved',
                                description: `Saved as “${playlistName.trim()}”.`,
                              });
                              setPlaylistName('');
                              setSaveOpen(false);
                            }}
                            disabled={!playlistName.trim()}
                            type="button"
                          >
                            Save Playlist
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>

                <div className="hidden lg:flex items-center gap-1 p-1 rounded-xl bg-white/5 w-full sm:w-auto">
                  {/* Desktop: switch inline panels. */}
                  <button
                    onClick={() => setActivePanel('queue')}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                      activePanel === 'queue'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    type="button"
                  >
                    Queue
                    {upcomingCount > 0 && (
                      <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/20 text-[10px]">
                        {upcomingCount}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setActivePanel('settings')}
                    className={cn(
                      'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                      activePanel === 'settings'
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    type="button"
                  >
                    Settings
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Main Content */}
        <div className="pt-3">
          {!isPartyMode ? (
            <PartySourceChooser />
          ) : (
            <>
              {/* Mobile: single column (outer container scrolls). */}
              <div className="lg:hidden space-y-4">
                <NowPlaying />

                <div className="rounded-xl border border-white/10 bg-white/5 backdrop-blur-sm overflow-hidden">
                  {/* Mobile panel switcher: Queue <-> Settings */}
                  <div className="p-2">
                    <div className="flex items-center gap-1 p-1 rounded-xl bg-white/5">
                      <button
                        onClick={() => setActivePanel('queue')}
                        className={cn(
                          'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all',
                          activePanel === 'queue'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                        type="button"
                      >
                        <ListMusic className="w-3.5 h-3.5" />
                        Queue
                        {upcomingCount > 0 && (
                          <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/20 text-[10px]">
                            {upcomingCount}
                          </span>
                        )}
                      </button>
                      <button
                        onClick={() => setActivePanel('settings')}
                        className={cn(
                          'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all',
                          activePanel === 'settings'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                        type="button"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        Settings
                      </button>
                    </div>
                  </div>

                  <div className="px-4 pb-4">
                    {activePanel === 'queue' ? (
                      <PartyQueuePanel className="rounded-none border-0 bg-transparent backdrop-blur-none p-0" />
                    ) : (
                      <div className="space-y-4 pt-2">
                        <VolumeControls />
                        <MixControls />
                        <TempoControls />
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Desktop: two-column layout (outer container scrolls). */}
              <div className="hidden lg:grid grid-cols-2 gap-4 items-start">
                <NowPlaying />
                {activePanel === 'queue' ? (
                  <PartyQueuePanel />
                ) : (
                  <div className="space-y-4">
                    <VolumeControls />
                    <MixControls />
                    <TempoControls />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
