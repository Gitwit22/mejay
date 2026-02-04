import { useState } from 'react';
import { Settings, ListMusic, Music, Library } from 'lucide-react';
import { useDJStore } from '@/stores/djStore';
import { cn } from '@/lib/utils';
import { NowPlaying } from './party/NowPlaying';
import { PartyQueuePanel } from './party/PartyQueuePanel';
import { MixControls } from './party/MixControls';
import { TempoControls } from './party/TempoControls';
import { VolumeControls } from './party/VolumeControls';
import { PartySourceChooser } from './party/PartySourceChooser';

type PanelView = 'queue' | 'settings';

export function PartyModeView() {
  const [activePanel, setActivePanel] = useState<PanelView>('queue');
  const { isPartyMode, partySource, partyTrackIds, nowPlayingIndex, playlists } = useDJStore();

  const upcomingCount = partyTrackIds.length - nowPlayingIndex - 1;
  
  // Get source label
  const getSourceLabel = () => {
    if (!partySource) return null;
    if (partySource.type === 'import') return 'Import List';
    const playlist = playlists.find(p => p.id === partySource.playlistId);
    return playlist ? `Playlist — ${playlist.name}` : 'Playlist';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <span className="text-[11px] text-muted-foreground uppercase tracking-[2px]">Auto DJ</span>
          <h2 className="text-[24px] font-bold text-gradient-accent">Party Mode</h2>
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
          <div className="flex items-center gap-1 p-1 rounded-xl bg-white/5">
            <button
              onClick={() => setActivePanel('queue')}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                activePanel === 'queue'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
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
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                activePanel === 'settings'
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Settings className="w-3.5 h-3.5" />
              Settings
            </button>
          </div>
        )}
      </div>

      {/* Main Content */}
      {!isPartyMode ? (
        <PartySourceChooser />
      ) : (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0 overflow-hidden">
          {/* Left Column - Now Playing */}
          <div className="flex flex-col gap-4 overflow-y-auto scrollbar-thin pr-1">
            <NowPlaying />
          </div>

          {/* Right Column - Queue or Settings */}
          <div className="flex flex-col gap-4 overflow-y-auto scrollbar-thin pr-1">
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
      )}
    </div>
  );
}
