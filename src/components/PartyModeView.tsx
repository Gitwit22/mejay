import { useMemo, useState } from 'react';
import { Settings, ListMusic, Music, Library } from 'lucide-react';
import { useDJStore } from '@/stores/djStore';
import { cn } from '@/lib/utils';
import { Switch } from '@/components/ui/switch';
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
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';

type PanelView = 'queue' | 'settings';

export function PartyModeView() {
  const [activePanel, setActivePanel] = useState<PanelView>('queue');
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<PanelView>('queue');
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
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3 flex-shrink-0">
        <div>
          <span className="text-[11px] text-muted-foreground uppercase tracking-[2px]">Auto DJ</span>
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

            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-white/5 w-full sm:w-auto">
              <span className="text-[10px] text-muted-foreground">Auto Mix</span>
              <Switch
                checked={settings.mixTriggerMode !== 'manual'}
                onCheckedChange={(checked) => updateUserSettings({ mixTriggerMode: checked ? 'remaining' : 'manual' })}
              />
            </div>

            <div className="flex items-center gap-1 p-1 rounded-xl bg-white/5 w-full sm:w-auto">
              {/* Mobile: open drawers. Desktop: switch inline panels. */}
              <button
                onClick={() => {
                  setActivePanel('queue');
                  setMobilePanel('queue');
                  setMobilePanelOpen(true);
                }}
                className={cn(
                  'flex lg:hidden items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                  'text-muted-foreground hover:text-foreground'
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
                onClick={() => {
                  setActivePanel('settings');
                  setMobilePanel('settings');
                  setMobilePanelOpen(true);
                }}
                className={cn(
                  'flex lg:hidden items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                  'text-muted-foreground hover:text-foreground'
                )}
                type="button"
              >
                <Settings className="w-3.5 h-3.5" />
                Settings
              </button>

              <button
                onClick={() => setActivePanel('queue')}
                className={cn(
                  'hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
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
                  'hidden lg:flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
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
        )}
      </div>

      {/* Main Content */}
      {!isPartyMode ? (
        <PartySourceChooser />
      ) : (
        <div className="flex-1 min-h-0 overflow-hidden">
          {/* Mobile: play area only (no inline scroll). */}
          <div className="lg:hidden h-full overflow-hidden">
            <NowPlaying />
          </div>

          {/* Desktop: split layout with internal scrolling columns. */}
          <div className="hidden lg:grid flex-1 grid-cols-2 gap-4 min-h-0 overflow-hidden">
            <div className="flex flex-col gap-4 overflow-y-auto scrollbar-thin pr-1 min-h-0">
              <NowPlaying />
            </div>

            <div className="flex flex-col gap-4 overflow-y-auto scrollbar-thin pr-1 min-h-0">
              {activePanel === 'queue' ? (
                <PartyQueuePanel />
              ) : (
                <>
                  <VolumeControls />
                  <MixControls />
                  <TempoControls />
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mobile bottom sheet: Queue / Settings */}
      <Drawer open={mobilePanelOpen} onOpenChange={setMobilePanelOpen}>
        <DrawerContent className="mejay-drawer">
          <DrawerHeader className="pb-2">
            <DrawerTitle>{mobilePanel === 'queue' ? 'Queue' : 'Settings'}</DrawerTitle>
          </DrawerHeader>
          <div className="flex-1 min-h-0 overflow-hidden px-4 pb-[calc(env(safe-area-inset-bottom,0)+16px)]">
            {mobilePanel === 'queue' ? (
              <div className="h-full overflow-hidden">
                <PartyQueuePanel />
              </div>
            ) : (
              <div className="h-full overflow-y-auto space-y-4 scrollbar-thin pr-1">
                <VolumeControls />
                <MixControls />
                <TempoControls />
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
