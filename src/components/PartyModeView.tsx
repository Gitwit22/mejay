import { useState } from 'react';
import { Settings, ListMusic } from 'lucide-react';
import { useDJStore } from '@/stores/djStore';
import { cn } from '@/lib/utils';
import { NowPlaying } from './party/NowPlaying';
import { QueuePanel } from './party/QueuePanel';
import { MixControls } from './party/MixControls';
import { TempoControls } from './party/TempoControls';
import { ScratchPad } from './party/ScratchPad';

type PanelView = 'queue' | 'settings';

export function PartyModeView() {
  const [activePanel, setActivePanel] = useState<PanelView>('queue');
  const { queue } = useDJStore();

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <span className="text-[11px] text-muted-foreground uppercase tracking-[2px]">Auto DJ</span>
          <h2 className="text-[24px] font-bold text-gradient-accent">Party Mode</h2>
        </div>
        
        {/* Panel Toggle */}
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
            {queue.length > 0 && (
              <span className="ml-1 px-1.5 py-0.5 rounded-full bg-white/20 text-[10px]">
                {queue.length}
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
      </div>

      {/* Main Content - Responsive Grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0 overflow-hidden">
        {/* Left Column - Now Playing + Controls */}
        <div className="flex flex-col gap-4 overflow-y-auto scrollbar-thin pr-1">
          <NowPlaying />
          
          {/* Mobile: Show scratch pad inline */}
          <div className="lg:hidden">
            <ScratchPad />
          </div>
        </div>

        {/* Right Column - Queue or Settings */}
        <div className="flex flex-col gap-4 overflow-y-auto scrollbar-thin pr-1">
          {activePanel === 'queue' ? (
            <QueuePanel />
          ) : (
            <>
              <MixControls />
              <TempoControls />
              {/* Desktop: Show scratch pad in settings */}
              <div className="hidden lg:block">
                <ScratchPad />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
