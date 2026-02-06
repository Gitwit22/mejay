import { audioEngine, type DeckId } from '@/lib/audioEngine'
import type { Track } from '@/lib/db'
import { useDJStore } from '@/stores/djStore'

type MediaSessionPlaybackState = 'none' | 'paused' | 'playing'

const DEFAULT_SEEK_OFFSET_SECONDS = 10
const POSITION_UPDATE_INTERVAL_MS = 500

let isInitialized = false
let positionIntervalId: number | null = null

function isSupported(): boolean {
  return typeof navigator !== 'undefined' && 'mediaSession' in navigator
}

function getActiveDeck(state: ReturnType<typeof useDJStore.getState>): DeckId {
  return state.activeDeck
}

function getDeckState(state: ReturnType<typeof useDJStore.getState>, deck: DeckId) {
  return deck === 'A' ? state.deckA : state.deckB
}

function getActiveTrack(state: ReturnType<typeof useDJStore.getState>): Track | undefined {
  const deck = getActiveDeck(state)
  const trackId = getDeckState(state, deck).trackId
  if (!trackId) return undefined
  return state.tracks.find(t => t.id === trackId)
}

function toArtwork(track?: Track): MediaImage[] | undefined {
  // ME Jay tracks currently don't have embedded artwork.
  // Use stable app artwork so lock screen UI still looks good.
  // (Relative URLs are fine; Media Session will resolve them.)
  const base: MediaImage[] = [
    { src: '/image.jpg', sizes: '512x512', type: 'image/jpeg' },
    { src: '/party.jpg', sizes: '512x512', type: 'image/jpeg' },
    { src: '/favicon.ico', sizes: '48x48', type: 'image/x-icon' },
  ]

  // In case you later add track-level artwork (e.g. track.artworkUrl), append it here.
  void track

  return base
}

function setMetadata(track: Track | undefined): void {
  if (!isSupported()) return

  // MediaMetadata can be missing in older Safari builds; check it exists.
  const MediaMetadataCtor = (globalThis as any).MediaMetadata as (new (init: MediaMetadataInit) => MediaMetadata) | undefined
  if (!MediaMetadataCtor) return

  if (!track) {
    navigator.mediaSession.metadata = null
    return
  }

  navigator.mediaSession.metadata = new MediaMetadataCtor({
    title: track.displayName || 'ME Jay',
    artist: track.artist || 'ME Jay',
    album: 'ME Jay',
    artwork: toArtwork(track),
  })
}

function safeSetPlaybackState(state: MediaSessionPlaybackState): void {
  if (!isSupported()) return
  try {
    navigator.mediaSession.playbackState = state
  } catch {
    // Some browsers throw if setting playbackState is unsupported.
  }
}

function safeSetActionHandler(action: MediaSessionAction, handler: ((details: any) => void) | null): void {
  if (!isSupported()) return
  try {
    navigator.mediaSession.setActionHandler(action, handler as any)
  } catch {
    // Unsupported action (common on iOS/Safari) — ignore.
  }
}

function getPositionSnapshot(): { duration: number; position: number; playbackRate: number } | null {
  const state = useDJStore.getState()
  const deck = getActiveDeck(state)
  const deckState = getDeckState(state, deck)

  const duration = audioEngine.getDuration(deck) || deckState.duration || 0
  const position = audioEngine.getCurrentTime(deck) || deckState.currentTime || 0
  const playbackRate = audioEngine.getTempo(deck) || deckState.playbackRate || 1

  if (!Number.isFinite(duration) || duration <= 0) return null
  if (!Number.isFinite(position) || position < 0) return null
  if (!Number.isFinite(playbackRate) || playbackRate <= 0) return null

  return {
    duration,
    position: Math.min(position, duration),
    playbackRate,
  }
}

function updatePositionState(): void {
  if (!isSupported()) return
  if (!('setPositionState' in navigator.mediaSession)) return

  const snap = getPositionSnapshot()
  if (!snap) return

  try {
    navigator.mediaSession.setPositionState({
      duration: snap.duration,
      position: snap.position,
      playbackRate: snap.playbackRate,
    })
  } catch {
    // setPositionState can throw if duration is invalid or browser rejects the call.
  }
}

function stopPositionInterval(): void {
  if (positionIntervalId !== null) {
    window.clearInterval(positionIntervalId)
    positionIntervalId = null
  }
}

function ensurePositionIntervalRunning(): void {
  if (positionIntervalId !== null) return
  positionIntervalId = window.setInterval(() => {
    updatePositionState()
  }, POSITION_UPDATE_INTERVAL_MS)
}

function seekTo(timeSeconds: number): void {
  const state = useDJStore.getState()
  const deck = getActiveDeck(state)
  const deckState = getDeckState(state, deck)

  const duration = audioEngine.getDuration(deck) || deckState.duration || 0
  const clamped = Math.max(0, duration > 0 ? Math.min(timeSeconds, duration) : timeSeconds)

  useDJStore.getState().seek(deck, clamped)
  updatePositionState()
}

export function initMediaSession(): void {
  if (isInitialized) return
  isInitialized = true

  if (typeof window === 'undefined') return
  if (!isSupported()) return

  // Register lock screen / headset controls.
  safeSetActionHandler('play', () => {
    useDJStore.getState().play()
    safeSetPlaybackState('playing')
    ensurePositionIntervalRunning()
    updatePositionState()
  })

  safeSetActionHandler('pause', () => {
    useDJStore.getState().pause()
    safeSetPlaybackState('paused')
    updatePositionState()
  })

  safeSetActionHandler('nexttrack', () => {
    useDJStore.getState().skip('user')
  })

  safeSetActionHandler('previoustrack', () => {
    useDJStore.getState().smartBack()
  })

  safeSetActionHandler('seekto', (details: { seekTime?: number }) => {
    seekTo(details?.seekTime ?? 0)
  })

  safeSetActionHandler('seekforward', (details: { seekOffset?: number }) => {
    const offset = details?.seekOffset ?? DEFAULT_SEEK_OFFSET_SECONDS
    const state = useDJStore.getState()
    const deck = getActiveDeck(state)
    const current = audioEngine.getCurrentTime(deck) || getDeckState(state, deck).currentTime || 0
    seekTo(current + offset)
  })

  safeSetActionHandler('seekbackward', (details: { seekOffset?: number }) => {
    const offset = details?.seekOffset ?? DEFAULT_SEEK_OFFSET_SECONDS
    const state = useDJStore.getState()
    const deck = getActiveDeck(state)
    const current = audioEngine.getCurrentTime(deck) || getDeckState(state, deck).currentTime || 0
    seekTo(current - offset)
  })

  // Keep metadata and playback state in sync.
  useDJStore.subscribe(
    s => {
      const activeDeck = s.activeDeck
      const deckState = activeDeck === 'A' ? s.deckA : s.deckB
      return {
        activeDeck,
        activeTrackId: deckState.trackId,
        activeIsPlaying: deckState.isPlaying,
        anyIsPlaying: s.deckA.isPlaying || s.deckB.isPlaying,
      }
    },
    next => {
      const state = useDJStore.getState()
      const track = getActiveTrack(state)

      setMetadata(track)

      if (!next.activeTrackId) {
        safeSetPlaybackState('none')
        stopPositionInterval()
        return
      }

      if (next.anyIsPlaying) {
        safeSetPlaybackState('playing')
        ensurePositionIntervalRunning()
      } else {
        safeSetPlaybackState('paused')
        stopPositionInterval()
      }

      updatePositionState()
    },
    {
      fireImmediately: true,
      equalityFn: (a, b) =>
        a.activeDeck === b.activeDeck &&
        a.activeTrackId === b.activeTrackId &&
        a.activeIsPlaying === b.activeIsPlaying &&
        a.anyIsPlaying === b.anyIsPlaying,
    }
  )

  // Cleanup interval on page unload.
  window.addEventListener('pagehide', () => {
    stopPositionInterval()
  })
}
