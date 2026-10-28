/** Larger files (long WAV/FLAC masters) are played without a waveform rather than decoded in the browser. */
export const MAX_WAVEFORM_BYTES = 60 * 1024 * 1024
export const WAVEFORM_BUCKETS = 600

/** Peak level (0 to 1) of each of `buckets` equal slices of the samples. */
export function computePeaks(samples: Float32Array, buckets: number = WAVEFORM_BUCKETS): number[] {
  if (samples.length === 0 || buckets <= 0) return []
  const size = samples.length / buckets
  const peaks: number[] = []
  for (let bucket = 0; bucket < buckets; bucket += 1) {
    const start = Math.floor(bucket * size)
    const end = Math.max(start + 1, Math.floor((bucket + 1) * size))
    let peak = 0
    for (let index = start; index < end && index < samples.length; index += 1) {
      const value = Math.abs(samples[index])
      if (value > peak) peak = value
    }
    peaks.push(Math.min(1, peak))
  }
  return peaks
}

/** Loudest channel at each sample, so a hard-panned part still shows. */
function mixDown(buffer: AudioBuffer): Float32Array {
  const mixed = new Float32Array(buffer.length)
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel)
    for (let index = 0; index < data.length; index += 1) {
      const value = Math.abs(data[index])
      if (value > mixed[index]) mixed[index] = value
    }
  }
  return mixed
}

/**
 * Downloads and decodes a song for its waveform. Resolves null (no waveform; the song still plays)
 * when the file is too large, the browser cannot decode it, or Web Audio is unavailable.
 */
export async function loadPeaks(url: string, signal?: AbortSignal, buckets: number = WAVEFORM_BUCKETS): Promise<number[] | null> {
  const Context = typeof window === 'undefined' ? undefined : window.AudioContext ?? (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext
  if (!Context) return null
  let response: Response
  try {
    response = await fetch(url, {credentials: 'include', signal})
  } catch {
    return null
  }
  if (!response.ok) return null
  const declared = Number(response.headers.get('content-length') ?? 0)
  if (declared > MAX_WAVEFORM_BYTES) {
    await response.body?.cancel().catch(() => undefined)
    return null
  }
  let bytes: ArrayBuffer
  try {
    bytes = await response.arrayBuffer()
  } catch {
    return null
  }
  if (bytes.byteLength > MAX_WAVEFORM_BYTES) return null
  const context = new Context()
  try {
    const decoded = await context.decodeAudioData(bytes)
    return computePeaks(mixDown(decoded), buckets)
  } catch {
    return null
  } finally {
    void context.close().catch(() => undefined)
  }
}
