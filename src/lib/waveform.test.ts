import {afterEach, describe, expect, it, vi} from 'vitest'

import {computePeaks, loadPeaks, MAX_WAVEFORM_BYTES} from './waveform'

describe('waveform peaks', () => {
  it('takes the loudest sample in each slice, ignoring sign', () => {
    expect(computePeaks(new Float32Array([0.1, -0.8, 0.3, 0.2, -0.05, 0.5]), 3)).toEqual([expect.closeTo(0.8), expect.closeTo(0.3), expect.closeTo(0.5)])
    expect(computePeaks(new Float32Array([]), 10)).toEqual([])
    // More slices than samples still gives one value per slice.
    expect(computePeaks(new Float32Array([0.5]), 4)).toHaveLength(4)
  })
})

describe('loading a waveform', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  function stubAudioContext(decode: () => Promise<unknown>) {
    const close = vi.fn(async () => undefined)
    vi.stubGlobal('AudioContext', class { decodeAudioData = decode; close = close })
    return close
  }

  it('decodes the song and returns its peaks', async () => {
    const close = stubAudioContext(async () => ({numberOfChannels: 2, length: 4, getChannelData: (channel: number) => new Float32Array(channel ? [0, 0.9, 0, 0] : [0.2, 0, 0, -0.4])}))
    const fetchSpy = vi.fn(async () => new Response(new ArrayBuffer(8), {headers: {'content-length': '8'}}))
    vi.stubGlobal('fetch', fetchSpy)
    expect(await loadPeaks('/api/marketplace/assets/a/audio', undefined, 2)).toEqual([expect.closeTo(0.9), expect.closeTo(0.4)])
    expect(fetchSpy).toHaveBeenCalledWith('/api/marketplace/assets/a/audio', expect.objectContaining({credentials: 'include'}))
    expect(close).toHaveBeenCalled()
  })

  it('skips files too large to decode, and files the browser cannot decode', async () => {
    const decode = vi.fn(async () => { throw new Error('bad') })
    stubAudioContext(decode)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', {headers: {'content-length': String(MAX_WAVEFORM_BYTES + 1)}})))
    expect(await loadPeaks('/big.wav')).toBeNull()
    expect(decode).not.toHaveBeenCalled()

    vi.stubGlobal('fetch', vi.fn(async () => new Response(new ArrayBuffer(8))))
    expect(await loadPeaks('/odd.flac')).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', {status: 404})))
    expect(await loadPeaks('/missing')).toBeNull()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline') }))
    expect(await loadPeaks('/offline')).toBeNull()
  })
})
