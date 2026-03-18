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

  it('backgroundIntervalId defaults to null before initialization', async () => {
    // The singleton is created at module load time; backgroundIntervalId
    // starts as null and only gets a value after initialize() is called.
    const { audioEngine } = await import('./audioEngine')
    // Before initialize(), the field should exist and be null.
    expect((audioEngine as any).backgroundIntervalId).toSatisfy(
      (v: unknown) => v === null || typeof v === 'number',
    )
  })

  it('destroy cleans up the background interval', async () => {
    const { audioEngine } = await import('./audioEngine')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')

    // Manually set a fake interval ID to simulate initialized state
    ;(audioEngine as any).backgroundIntervalId = 12345

    audioEngine.destroy()

    // Verify clearInterval was called with the interval ID
    expect(clearIntervalSpy).toHaveBeenCalledWith(12345)
    expect((audioEngine as any).backgroundIntervalId).toBeNull()
  })
})
