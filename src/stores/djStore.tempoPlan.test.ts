import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/use-toast', () => ({
  toast: vi.fn(),
}))

vi.mock('@/stores/planStore', () => ({
  usePlanStore: {
    getState: () => ({
      plan: 'pro',
      hasFeature: vi.fn(() => true),
      openUpgradeModal: vi.fn(),
    }),
    subscribe: vi.fn(() => () => {}),
  },
}))

vi.mock('@/lib/bpmDetector', () => ({
  analyzeBPM: vi.fn(async () => ({ bpm: 120, hasBeat: true })),
}))

vi.mock('@/lib/audioEngine', () => {
  const audioEngine = {
    pause: vi.fn(),
    play: vi.fn(),
    playAt: vi.fn(),
    stop: vi.fn(),
    destroy: vi.fn(),

    isPlaying: vi.fn(() => false),
    getAudioContextTime: vi.fn(() => 0),
    getDuration: vi.fn(() => 180),
    getCurrentTime: vi.fn(() => 0),
    getTempo: vi.fn(() => 1),
    getEffectiveTempo: vi.fn(() => 1),
    isTempoRamping: vi.fn(() => false),
    setTempo: vi.fn(),
    rampTempo: vi.fn(),

    seek: vi.fn(),
    setCrossfade: vi.fn(),
    scheduleCrossfade: vi.fn(),
    scheduleStop: vi.fn(),
    enableMixCheck: vi.fn(),
    setMixTriggerConfig: vi.fn(),
    resetMixTrigger: vi.fn(),

    loadTrack: vi.fn(async () => 180),
    loadTrackWithOffset: vi.fn(async () => 180),
    setBaseBpm: vi.fn(),
    getBaseBpm: vi.fn(() => 100),

    setLimiterEnabled: vi.fn(),
    setLimiterStrength: vi.fn(),
    setMasterVolume: vi.fn(),

    setTrackGain: vi.fn(),

    // Beat grid helpers: keep deterministic.
    getNextBeatTimeFrom: vi.fn((_deck: any, from: number) => from),
    getPrevBeatTimeFrom: vi.fn((_deck: any, from: number) => from),

    calculateTempoRatio: vi.fn(() => 1.25),

    setOnTimeUpdate: vi.fn(),
    setOnTrackEnd: vi.fn(),
    setOnMixTrigger: vi.fn(),

    analyzeLoudness: vi.fn(async () => ({ loudnessDb: -14 })),
    calculateGain: vi.fn(() => 0),
  }

  return { audioEngine }
})

vi.mock('@/lib/db', () => ({
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
  clearTracksAndPlaylists: vi.fn(async () => {}),
}))

import { useDJStore } from './djStore'
import { audioEngine } from '@/lib/audioEngine'

const makeTrack = (id: string, bpm: number) => ({
  id,
  localPath: `${id}.mp3`,
  displayName: id,
  duration: 180,
  bpm,
  hasBeat: true,
  analysisStatus: 'ready' as const,
  fileBlob: new Blob(['x'], { type: 'audio/mpeg' }),
  addedAt: Date.now(),
})

const flush = async () => {
  // Allow queued promises from loadTrackWithOffset().then(...) to run.
  await Promise.resolve()
  await Promise.resolve()
}

describe('DJ Store transition tempo plan regression', () => {
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

    // Ensure no pending crossfade timers from prior tests can mutate state.
    try {
      useDJStore.getState().stopPartyMode()
    } catch {
      // ignore
    }

    const state = useDJStore.getState()
    useDJStore.setState({
      ...state,
      tracks: [makeTrack('t1', 100), makeTrack('t2', 150)],
      isPartyMode: true,
      partySource: { type: 'import' },
      partyTrackIds: ['t1', 't2'],
      nowPlayingIndex: 0,
      pendingNextIndex: null,
      pendingSourceSwitch: null,
      queuedSourceSwitch: null,
      playHistoryTrackIds: [],
      activeDeck: 'A',
      mixInProgress: false,
      deckA: { ...state.deckA, trackId: 't1', isPlaying: true, playbackRate: 1 },
      deckB: { ...state.deckB, trackId: null, isPlaying: false, playbackRate: 1 },
      lastTransitionTempoMatchDisabled: false,
      lastTransitionTempoMatchRequiredPct: null,
      lastTransitionTempoMatchCeilingPct: null,
      lastTransitionTempoPlan: null,
      settings: {
        ...state.settings,
        tempoMode: 'auto',
        autoOffsetBpm: 0,
        maxTempoPercent: 8,
        crossfadeSeconds: 8,
        endEarlySeconds: 5,
      },
    })
  })

  it('nudge=0 + tempoMatch disabled => outgoingTargetRatio == 1', async () => {
    // Force required shift > cap.
    ;(audioEngine.getBaseBpm as any).mockReturnValue(100)
    ;(audioEngine.calculateTempoRatio as any).mockReturnValue(1.5)

    useDJStore.getState().skip('auto')
    await flush()

    const plan = useDJStore.getState().lastTransitionTempoPlan
    expect(plan).toBeTruthy()
    expect(plan?.tempoMatchDisabled).toBe(true)
    expect(plan?.disabledReason).toBe('over_cap')
    expect(plan?.outgoingTargetRatio).toBe(1)
  })

  it('exactly at cap should tempo-match (stable edge)', async () => {
    // outgoing 100 -> target 108 => exactly 8%.
    useDJStore.setState((s) => ({
      ...s,
      tracks: [makeTrack('t1', 100), makeTrack('t2', 108)],
      partyTrackIds: ['t1', 't2'],
      deckA: { ...s.deckA, trackId: 't1', isPlaying: true, playbackRate: 1 },
      settings: { ...s.settings, maxTempoPercent: 8, autoOffsetBpm: 0 },
    }))

    const before = useDJStore.getState()
    expect(before.partyTrackIds).toEqual(['t1', 't2'])
    expect(before.tracks.find(t => t.id === 't2')?.bpm).toBeCloseTo(108, 6)

    useDJStore.getState().skip('auto')
    await flush()

    const plan = useDJStore.getState().lastTransitionTempoPlan
    expect(plan).toBeTruthy()
    expect(plan?.outgoingBaseBpmUsed).toBeCloseTo(100, 6)
    expect(plan?.nextBaseBpmUsed).toBeCloseTo(108, 6)
    expect(plan?.targetBpmUsed).toBeCloseTo(108, 6)
    expect(plan?.requiredOutgoingPercent).toBeCloseTo(8, 6)
    expect(plan?.requiredIncomingPercent).toBeCloseTo(0, 6)
    expect(plan?.requiredPercent).toBeCloseTo(8, 6)
    expect(plan?.capPctUsed).toBeCloseTo(8, 6)
    expect(plan?.overCap).toBe(false)
    expect(plan?.disabledReason).toBe(null)
    expect(plan?.tempoMatchDisabled).toBe(false)
  })

  it('epsilon over cap disables with over_cap reason', async () => {
    useDJStore.setState((s) => ({
      ...s,
      tracks: [makeTrack('t1', 100), makeTrack('t2', 108.0001)],
      partyTrackIds: ['t1', 't2'],
      deckA: { ...s.deckA, trackId: 't1', isPlaying: true, playbackRate: 1 },
      settings: { ...s.settings, maxTempoPercent: 8, autoOffsetBpm: 0 },
    }))

    useDJStore.getState().skip('auto')
    await flush()

    const plan = useDJStore.getState().lastTransitionTempoPlan
    expect(plan).toBeTruthy()
    expect(plan?.tempoMatchDisabled).toBe(true)
    expect(plan?.disabledReason).toBe('over_cap')
  })

  it('ramp end alignment is exact', async () => {
    // Make it a match-enabled transition.
    useDJStore.setState((s) => ({
      settings: { ...s.settings, maxTempoPercent: 12 },
    }))

    useDJStore.getState().skip('auto')
    await flush()

    const plan = useDJStore.getState().lastTransitionTempoPlan
    expect(plan).toBeTruthy()

    if (plan?.rampStartAt !== null && plan?.rampEndAt !== null && plan?.rampSecActual !== null) {
      const epsilon = 1e-6
      expect(Math.abs((plan.rampStartAt + plan.rampSecActual) - plan.rampEndAt)).toBeLessThan(epsilon)
    }
  })

  it('crossfade-duration coupling: rampSecWanted follows clamp(crossfade*2,4,20)', async () => {
    useDJStore.setState((s) => ({
      settings: { ...s.settings, crossfadeSeconds: 8, maxTempoPercent: 12 },
    }))

    useDJStore.getState().skip('auto')
    await flush()

    const plan = useDJStore.getState().lastTransitionTempoPlan
    expect(plan).toBeTruthy()
    expect(plan?.rampSecWanted).toBe(16)

    // If tempo match gets disabled, there should be no scheduled ramp info.
    if (plan?.tempoMatchDisabled) {
      expect(plan?.rampStartAt).toBe(null)
      expect(plan?.rampSecActual).toBe(null)
    }
  })
})
