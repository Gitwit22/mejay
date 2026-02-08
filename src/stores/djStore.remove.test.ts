import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}))

vi.mock('@/stores/planStore', () => ({
  usePlanStore: {
    getState: () => ({
      plan: 'pro',
      openUpgradeModal: vi.fn(),
    }),
  },
}))

vi.mock('@/lib/bpmDetector', () => ({
  analyzeBPM: vi.fn(async () => ({ bpm: 120, hasBeat: true })),
}))

vi.mock('@/lib/audioEngine', () => {
  const audioEngine = {
    pause: vi.fn(),
    play: vi.fn(),
    stop: vi.fn(),
    destroy: vi.fn(),

    isPlaying: vi.fn(() => false),
    getTempo: vi.fn(() => 1),
    setTempo: vi.fn(),

    seek: vi.fn(),
    setCrossfade: vi.fn(),
    enableMixCheck: vi.fn(),
    setMixTriggerConfig: vi.fn(),

    loadTrack: vi.fn(async () => 180),
    loadTrackWithOffset: vi.fn(async () => 180),
    setBaseBpm: vi.fn(),

    analyzeLoudness: vi.fn(async () => ({ loudnessDb: -14 })),
    calculateGain: vi.fn(() => 0),
  }

  return { audioEngine }
})

vi.mock('@/lib/db', () => ({
  // Type-only exports sometimes remain in the emitted import list; provide placeholders.
  Track: {},
  Settings: {},
  Playlist: {},
  PartySource: {},

  getAllTracks: vi.fn(async () => []),
  getSettings: vi.fn(async () => ({})),
  addTrack: vi.fn(async () => {}),
  updateTrack: vi.fn(async () => {}),
  deleteTrack: vi.fn(async () => {}),
  updateSettings: vi.fn(async () => {}),
  generateId: vi.fn(() => 'test-id'),

  getAllPlaylists: vi.fn(async () => []),
  addPlaylist: vi.fn(async () => {}),
  updatePlaylist: vi.fn(async () => {}),
  deletePlaylist: vi.fn(async () => {}),

  resetLocalDatabase: vi.fn(async () => {}),
}))

import { useDJStore } from './djStore'
import { audioEngine } from '../lib/audioEngine'
import { deleteTrack, updatePlaylist } from '../lib/db'

const makeTrack = (id: string) => ({
  id,
  localPath: `${id}.mp3`,
  displayName: id,
  duration: 180,
  bpm: 120,
  hasBeat: true,
  analysisStatus: 'ready' as const,
  fileBlob: new Blob(['x'], { type: 'audio/mpeg' }),
  addedAt: Date.now(),
})

beforeEach(() => {
  vi.clearAllMocks()
  try {
    localStorage.clear()
  } catch {
    // ignore
  }
  try {
    sessionStorage.clear()
  } catch {
    // ignore
  }

  const state = useDJStore.getState()
  useDJStore.setState({
    ...state,
    tracks: [makeTrack('t1'), makeTrack('t2'), makeTrack('t3')],
    playlists: [
      { id: 'p1', name: 'P1', trackIds: ['t1', 't2'], createdAt: 0, updatedAt: 0 },
      { id: 'p2', name: 'P2', trackIds: ['t2'], createdAt: 0, updatedAt: 0 },
    ],
    isPartyMode: true,
    partySource: { type: 'import' },
    partyTrackIds: ['t1', 't2', 't3'],
    nowPlayingIndex: 1,
    pendingNextIndex: null,
    activeDeck: 'A',
    deckA: { ...state.deckA, trackId: 't2', isPlaying: true, playbackRate: 1 },
    deckB: { ...state.deckB, trackId: null, isPlaying: false, playbackRate: 1 },
  })
})

describe('DJ Store removal semantics', () => {
  it('removeFromLibrary removes from queue and adjusts nowPlayingIndex when removing earlier track', async () => {
    // Playing t3 at index 2.
    useDJStore.setState({
      partyTrackIds: ['t1', 't2', 't3'],
      nowPlayingIndex: 2,
      activeDeck: 'A',
      deckA: { ...useDJStore.getState().deckA, trackId: 't3', isPlaying: true },
    })

    await useDJStore.getState().removeFromLibrary('t1')

    const after = useDJStore.getState()
    expect(after.partyTrackIds).toEqual(['t2', 't3'])
    expect(after.nowPlayingIndex).toBe(1)

    // Still playing the same current track.
    expect(after.deckA.trackId).toBe('t3')
    expect(after.deckA.isPlaying).toBe(true)
  })

  it('removeFromLibrary advances to next when removing currently playing track', async () => {
    await useDJStore.getState().removeFromLibrary('t2')

    const after = useDJStore.getState()
    expect(after.partyTrackIds).toEqual(['t1', 't3'])
    expect(after.nowPlayingIndex).toBe(1)

    // Jumped to the new current track (t3).
    expect(after.deckA.trackId).toBe('t3')
    expect(after.deckA.isPlaying).toBe(true)

    expect(audioEngine.stop).toHaveBeenCalled()
    expect(audioEngine.play).toHaveBeenCalled()
    expect(deleteTrack).toHaveBeenCalledWith('t2')

    // Removed from all playlists.
    expect(updatePlaylist).toHaveBeenCalledWith('p1', expect.objectContaining({ trackIds: ['t1'] }))
    expect(updatePlaylist).toHaveBeenCalledWith('p2', expect.objectContaining({ trackIds: [] }))
  })

  it('removeFromPlaylist only affects that playlist, but updates queue if playing that playlist', async () => {
    useDJStore.setState({
      partySource: { type: 'playlist', playlistId: 'p1' },
      partyTrackIds: ['t1', 't2'],
      nowPlayingIndex: 0,
      activeDeck: 'A',
      deckA: { ...useDJStore.getState().deckA, trackId: 't1', isPlaying: true },
    })

    await useDJStore.getState().removeFromPlaylist('p1', 't2')

    const after = useDJStore.getState()
    expect(after.playlists.find((p: any) => p.id === 'p1')?.trackIds).toEqual(['t1'])
    expect(after.playlists.find((p: any) => p.id === 'p2')?.trackIds).toEqual(['t2'])

    // Queue had t2 removed but no forced advance (current is t1).
    expect(after.partyTrackIds).toEqual(['t1'])
    expect(after.nowPlayingIndex).toBe(0)

    // Should NOT delete the track from library.
    expect(deleteTrack).not.toHaveBeenCalled()
  })

  it('removeFromLibrary stops party mode when queue becomes empty', async () => {
    useDJStore.setState({
      partyTrackIds: ['t1'],
      nowPlayingIndex: 0,
      partySource: { type: 'import' },
      activeDeck: 'A',
      deckA: { ...useDJStore.getState().deckA, trackId: 't1', isPlaying: true },
    })

    await useDJStore.getState().removeFromLibrary('t1')

    const after = useDJStore.getState()
    expect(after.isPartyMode).toBe(false)
    expect(after.partyTrackIds).toEqual([])
  })
})
