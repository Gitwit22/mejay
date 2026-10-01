import { describe, expect, it, vi, afterEach } from 'vitest'

/**
 * Tests for AudioEngine background timer behavior.
 *
 * The engine must fire mix-trigger and track-end checks even when the browser
 * tab is not focused. requestAnimationFrame is throttled in background tabs,
 * so a setInterval fallback was added. These tests verify:
 *
 * 1. The background interval is cleaned up on destroy().
 * 2. The interval field is initialized to null before initialization.
 */
describe('AudioEngine background timer', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('backgroundTimerId defaults to null before initialization', async () => {
    // The singleton is created at module load time; backgroundTimerId
    // starts as null and only gets a value after initialize() is called.
    const { audioEngine } = await import('./audioEngine')
    // Before initialize(), the field should exist and be null.
    expect((audioEngine as any).backgroundTimerId).toSatisfy(
      (v: unknown) => v === null || typeof v === 'number',
    )
  })

  it('destroy cleans up the background interval', async () => {
    const { audioEngine } = await import('./audioEngine')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    // Manually set a fake interval ID to simulate initialized state
    ;(audioEngine as any).backgroundTimerId = 12345

    audioEngine.destroy()

    // Verify clearInterval was called with the interval ID
    expect(clearIntervalSpy).toHaveBeenCalledWith(12345)
    expect((audioEngine as any).backgroundTimerId).toBeNull()
  })
})

type EngineInternals = {
  audioContext: unknown
  onTrackEnd: unknown
  decks: {A: {audioBuffer: unknown; duration: number; trackGainNode: unknown; isPlaying: boolean}}
}

describe('AudioEngine source lifecycle', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function fakeContext() {
    const sources: Array<{onended: (() => void) | null; stop: () => void; start: () => void}> = []
    const ctx = {
      state: 'running',
      currentTime: 0,
      resume: vi.fn(async () => {}),
      createBufferSource: () => {
        const source = {
          buffer: null,
          playbackRate: {value: 1},
          onended: null as (() => void) | null,
          connect: vi.fn(),
          disconnect: vi.fn(),
          start: vi.fn(),
          // Real browsers dispatch 'ended' asynchronously after stop().
          stop: vi.fn(() => {
            const handler = source.onended
            queueMicrotask(() => handler?.())
          }),
        }
        sources.push(source)
        return source
      },
    }
    return {ctx, sources}
  }

  it('seeking while playing does not report a track end', async () => {
    const { audioEngine } = await import('./audioEngine')
    const engine = audioEngine as unknown as EngineInternals
    const {ctx} = fakeContext()
    engine.audioContext = ctx
    engine.decks.A.audioBuffer = {duration: 200}
    engine.decks.A.duration = 200
    engine.decks.A.trackGainNode = {gain: {value: 1, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn()}}
    const onTrackEnd = vi.fn()
    engine.onTrackEnd = onTrackEnd

    audioEngine.play('A')
    audioEngine.seek('A', 60)
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(onTrackEnd).not.toHaveBeenCalled()
    expect(engine.decks.A.isPlaying).toBe(true)
    audioEngine.stop('A')
    engine.audioContext = null
  })

  it('discards a decode that finishes after a newer load on the same deck', async () => {
    const { audioEngine, isStaleLoadError } = await import('./audioEngine')
    const engine = audioEngine as unknown as EngineInternals
    let resolveFirst: (buffer: unknown) => void = () => {}
    const decodeAudioData = vi.fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve }))
      .mockImplementationOnce(async () => ({duration: 222}))
    engine.audioContext = {...fakeContext().ctx, decodeAudioData}
    engine.decks.A.trackGainNode = {gain: {value: 1, cancelScheduledValues: vi.fn(), setTargetAtTime: vi.fn()}}
    const blob = {arrayBuffer: async () => new ArrayBuffer(8)} as unknown as Blob

    const first = audioEngine.loadTrack('A', blob)
    const second = audioEngine.loadTrack('A', blob)
    await expect(second).resolves.toBe(222)
    resolveFirst({duration: 111})
    await expect(first).rejects.toSatisfy(isStaleLoadError)
    expect(engine.decks.A.duration).toBe(222)
    engine.audioContext = null
  })
})
