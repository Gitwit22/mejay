import {AudioToolError, runFfprobe} from './ffmpeg'

export type AudioProbe = {
  /** Container as ffprobe names it, e.g. "wav", "flac", "mp3", "aiff". */
  container: string
  codec: string
  durationMs: number
  bitRate: number | null
  sampleRate: number | null
  bitDepth: number | null
  channels: number | null
  /** Lower-cased tag names to values, from the container and the audio stream. */
  tags: Record<string, string>
  hasCoverArt: boolean
}

type FfprobeStream = {
  codec_type?: string
  codec_name?: string
  sample_rate?: string
  channels?: number
  bits_per_raw_sample?: string
  bits_per_sample?: number
  bit_rate?: string
  duration?: string
  tags?: Record<string, string>
  disposition?: {attached_pic?: number}
}

type FfprobeOutput = {
  streams?: FfprobeStream[]
  format?: {format_name?: string; duration?: string; bit_rate?: string; tags?: Record<string, string>}
}

const positive = (value: string | number | undefined): number | null => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}

const lowerKeys = (tags: Record<string, string> | undefined): Record<string, string> =>
  Object.fromEntries(Object.entries(tags ?? {}).map(([key, value]) => [key.toLowerCase(), value]))

/** Turns ffprobe JSON into audio facts. Throws when there is no decodable audio stream. */
export function parseProbe(raw: string): AudioProbe {
  let data: FfprobeOutput
  try {
    data = JSON.parse(raw) as FfprobeOutput
  } catch {
    throw new AudioToolError('ffprobe returned unreadable output')
  }
  const audio = data.streams?.find((stream) => stream.codec_type === 'audio')
  if (!audio?.codec_name) throw new AudioToolError('No audio stream found')
  const durationSeconds = positive(data.format?.duration) ?? positive(audio.duration)
  if (!durationSeconds) throw new AudioToolError('Audio duration could not be determined')
  const bitDepth = positive(audio.bits_per_raw_sample) ?? positive(audio.bits_per_sample)
  return {
    container: (data.format?.format_name ?? '').split(',')[0] || audio.codec_name,
    codec: audio.codec_name,
    durationMs: Math.round(durationSeconds * 1000),
    bitRate: positive(audio.bit_rate) ?? positive(data.format?.bit_rate),
    sampleRate: positive(audio.sample_rate),
    bitDepth,
    channels: positive(audio.channels),
    tags: {...lowerKeys(audio.tags), ...lowerKeys(data.format?.tags)},
    hasCoverArt: Boolean(data.streams?.some((stream) => stream.codec_type === 'video' && stream.disposition?.attached_pic === 1)),
  }
}

export async function probeAudio(filePath: string): Promise<AudioProbe> {
  const {stdout} = await runFfprobe(['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', filePath], {timeoutMs: 60_000})
  return parseProbe(stdout)
}
