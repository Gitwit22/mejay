import React from 'react'
import {ArrowLeft, ListMusic, Pause, Play, Repeat, Settings, Shuffle, SkipBack, SkipForward} from 'lucide-react'

import {useDJStore} from '@/stores/djStore'
import {cn} from '@/lib/utils'

type PartyTransportControlsProps = {
  className?: string
  onExit?: () => void
  onOpenQueue: () => void
  onOpenSettings: () => void
}

export function PartyTransportControls({className, onExit, onOpenQueue, onOpenSettings}: PartyTransportControlsProps) {
  const {
    deckA,
    deckB,
    activeDeck,
    partyTrackIds,
    nowPlayingIndex,
    settings,
    togglePlayPause,
    smartBack,
    restartCurrentTrack,
    skip,
    updateUserSettings,
  } = useDJStore()

  const currentDeck = activeDeck === 'A' ? deckA : deckB

  const hasMoreTracks = nowPlayingIndex < partyTrackIds.length - 1 || settings.loopPlaylist

  const backPressTimerRef = React.useRef<number | null>(null)
  const backLongPressFiredRef = React.useRef(false)

  const clearBackTimer = () => {
    if (backPressTimerRef.current !== null) {
      window.clearTimeout(backPressTimerRef.current)
      backPressTimerRef.current = null
    }
  }

  const onBackPointerDown = () => {
    backLongPressFiredRef.current = false
    clearBackTimer()
    backPressTimerRef.current = window.setTimeout(() => {
      backLongPressFiredRef.current = true
      restartCurrentTrack()
    }, 450)
  }

  const onBackPointerUp = () => {
    const wasLongPress = backLongPressFiredRef.current
    clearBackTimer()
    if (!wasLongPress) smartBack()
  }

  return (
    <div
      className={cn(
        'pointer-events-auto',
        'rounded-full border border-white/10 bg-background/70 backdrop-blur-xl shadow-[0_18px_60px_rgba(0,0,0,0.55)]',
        'px-3 py-2',
        className,
      )}
      role="group"
      aria-label="Transport controls"
    >
      <div className="flex items-center gap-2">
        {/* Exit */}
        {onExit && (
          <button
            type="button"
            onClick={onExit}
            className="h-11 w-11 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center"
            aria-label="Exit Party Mode"
            title="Exit"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}

        {/* Queue / Settings */}
        <button
          type="button"
          onClick={onOpenQueue}
          className="h-11 w-11 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center"
          aria-label="Open queue"
        >
          <ListMusic className="h-5 w-5" />
        </button>

        <button
          type="button"
          onClick={onOpenSettings}
          className="h-11 w-11 rounded-full border border-white/10 bg-white/5 hover:bg-white/10 transition-colors flex items-center justify-center"
          aria-label="Open settings"
        >
          <Settings className="h-5 w-5" />
        </button>

        {/* Transport */}
        <button
          onPointerDown={onBackPointerDown}
          onPointerUp={onBackPointerUp}
          onPointerCancel={clearBackTimer}
          onPointerLeave={clearBackTimer}
          onContextMenu={(e) => e.preventDefault()}
          className={cn('ctrl-btn ctrl-secondary !w-11 !h-11')}
          title="Back (tap) / Restart (hold)"
          type="button"
        >
          <SkipBack className="w-4 h-4" />
        </button>

        <button
          onClick={() => updateUserSettings({shuffleEnabled: !settings.shuffleEnabled})}
          className={cn('ctrl-btn ctrl-secondary !w-11 !h-11', settings.shuffleEnabled && 'ring-2 ring-primary')}
          title={settings.shuffleEnabled ? 'Shuffle On' : 'Shuffle Off'}
          type="button"
        >
          <Shuffle className="w-4 h-4" />
        </button>

        <button
          onClick={() => togglePlayPause()}
          className={cn('ctrl-btn ctrl-primary !w-14 !h-14')}
          type="button"
        >
          {currentDeck.isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6 ml-0.5" />}
        </button>

        <button
          onClick={() => skip('user')}
          className={cn('ctrl-btn ctrl-secondary !w-11 !h-11')}
          disabled={!hasMoreTracks}
          title="Skip"
          type="button"
        >
          <SkipForward className="w-4 h-4" />
        </button>

        <button
          onClick={() => updateUserSettings({loopPlaylist: !settings.loopPlaylist})}
          className={cn('ctrl-btn ctrl-secondary !w-11 !h-11', settings.loopPlaylist && 'ring-2 ring-accent')}
          title={settings.loopPlaylist ? 'Loop On' : 'Loop Off'}
          type="button"
        >
          <Repeat className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
