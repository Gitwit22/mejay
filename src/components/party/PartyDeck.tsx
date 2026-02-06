import {useMemo} from 'react'
import {Music} from 'lucide-react'

import {useDJStore} from '@/stores/djStore'
import {cn, formatDuration} from '@/lib/utils'

type PartyDeckProps = {
  deck: 'A' | 'B'
  className?: string
}

export function PartyDeck({deck, className}: PartyDeckProps) {
  const {tracks, deckA, deckB, activeDeck, settings} = useDJStore()

  const deckState = deck === 'A' ? deckA : deckB

  const track = useMemo(
    () => tracks.find((t) => t.id === deckState.trackId),
    [tracks, deckState.trackId],
  )

  const progressPct = deckState.duration > 0 ? (deckState.currentTime / deckState.duration) * 100 : 0

  const startAt = track
    ? Math.max(0, Math.min(settings.nextSongStartOffset ?? 0, Math.max(0, track.duration - 0.25)))
    : 0
  const startPct = deckState.duration > 0 ? (startAt / deckState.duration) * 100 : 0

  const isActive = activeDeck === deck

  return (
    <section
      className={cn(
        'h-full min-h-0 overflow-hidden',
        // Deck internal layout contract
        'flex flex-col',
        // Visuals
        'bg-white/5',
        className,
      )}
      aria-label={`Deck ${deck}`}
    >
      {/* Track title / BPM */}
      <div className={cn('shrink-0 px-3 pt-3 pb-2', isActive && 'bg-white/5')}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold tracking-[2px] text-muted-foreground">DECK {deck}</span>
              {isActive && (
                <span className="badge-ready">Active</span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2 min-w-0">
              <Music className="w-4 h-4 text-white/50 shrink-0" />
              <h3 className="text-sm font-semibold truncate">
                {track?.displayName || 'No track loaded'}
              </h3>
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className="text-[11px] text-muted-foreground">BPM</div>
            <div className="text-lg leading-none font-bold text-accent font-display">
              {track?.bpm ? Math.round(track.bpm * deckState.playbackRate) : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Waveform / progress */}
      <div className="flex-1 min-h-0 px-3 py-2 flex flex-col justify-center">
        <div className="slider-track">
          {startAt > 0.01 && (
            <>
              <div className="start-trim-shade" style={{width: `${Math.max(0, Math.min(100, startPct))}%`}} />
              <div
                className="start-trim-tick"
                style={{left: `${Math.max(0, Math.min(100, startPct))}%`}}
                aria-hidden="true"
              />
            </>
          )}
          <div className="slider-fill transition-all duration-200" style={{width: `${progressPct}%`}} />
        </div>

        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground tabular-nums">
          <span>{formatDuration(deckState.currentTime)}</span>
          <span>-{formatDuration(Math.max(0, deckState.duration - deckState.currentTime))}</span>
        </div>
      </div>

      {/* Deck controls (small + non-scrolling) */}
      <div className="shrink-0 px-3 pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[10px] text-muted-foreground">
            Pitch: <span className="text-foreground font-medium">{((deckState.playbackRate - 1) * 100).toFixed(1)}%</span>
          </div>
          <div className="text-[10px] text-muted-foreground">
            {deckState.isPlaying ? 'Playing' : 'Paused'}
          </div>
        </div>
      </div>
    </section>
  )
}
