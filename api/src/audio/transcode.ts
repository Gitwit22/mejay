import type {TrackTagData} from './metadata'
import type {AudioProbe} from './probe'

/** Delivery MP3: constant 320 kbps, the highest MP3 bitrate players universally support. */
export const DELIVERY_BITRATE = '320k'
export const PREVIEW_BITRATE = '128k'
/** Store previews are 10-second clips that fade in and out. */
export const PREVIEW_SECONDS = 10
export const PREVIEW_FADE_IN_SECONDS = 1
export const PREVIEW_FADE_OUT_SECONDS = 1.5
/** Automatic start for songs long enough to skip the intro. */
const AUTO_START_SECONDS = 30
export const COVER_SIZE_PX = 1400
/** MP3 tops out at 48 kHz; higher-rate masters are resampled, others keep their rate. */
const MP3_MAX_SAMPLE_RATE = 48_000

/** ID3v2.3 text tags. Keys are ffmpeg metadata names; TSRC is written verbatim as the ISRC frame. */
export function id3Tags(tags: TrackTagData): Array<[string, string]> {
  const entries: Array<[string, string | null]> = [
    ['title', tags.title],
    ['artist', tags.artist],
    ['album_artist', tags.albumArtist],
    ['album', tags.album],
    ['track', `${tags.trackNumber}/${tags.trackTotal}`],
    ['disc', String(tags.discNumber)],
    ['date', tags.year],
    ['genre', tags.genre],
    ['publisher', tags.label],
    ['copyright', tags.copyright],
    ['TSRC', tags.isrc],
    ['comment', 'Purchased on MeJay'],
  ]
  return entries.filter((entry): entry is [string, string] => Boolean(entry[1]?.trim())).map(([key, value]) => [key, value.replace(/[\r\n]+/g, ' ').trim()])
}

const metadataArgs = (tags: TrackTagData) => id3Tags(tags).flatMap(([key, value]) => ['-metadata', `${key}=${value}`])

const coverInputArgs = (coverPath: string | null) => (coverPath ? ['-i', coverPath] : [])
const coverMapArgs = (coverPath: string | null) => (coverPath
  ? ['-map', '1:v:0', '-c:v', 'copy', '-disposition:v:0', 'attached_pic', '-metadata:s:v:0', 'title=Album cover', '-metadata:s:v:0', 'comment=Cover (front)']
  : [])

const sampleRateArgs = (probe: AudioProbe) => (probe.sampleRate && probe.sampleRate > MP3_MAX_SAMPLE_RATE ? ['-ar', String(MP3_MAX_SAMPLE_RATE)] : [])

/** Square cover scaled down (never up) to a phone-friendly JPEG. */
export function coverArgs(inputPath: string, outputPath: string): string[] {
  return [
    '-i', inputPath,
    '-vf', `scale=${COVER_SIZE_PX}:${COVER_SIZE_PX}:force_original_aspect_ratio=decrease`,
    '-frames:v', '1', '-q:v', '3', '-pix_fmt', 'yuvj420p',
    outputPath,
  ]
}

/** Full-length tagged MP3. Source tags are dropped so only approved release metadata ships. */
export function deliveryArgs(args: {sourcePath: string; coverPath: string | null; outputPath: string; tags: TrackTagData; probe: AudioProbe}): string[] {
  return [
    '-i', args.sourcePath,
    ...coverInputArgs(args.coverPath),
    '-map', '0:a:0',
    ...coverMapArgs(args.coverPath),
    '-map_metadata', '-1',
    '-c:a', 'libmp3lame', '-b:a', DELIVERY_BITRATE,
    ...sampleRateArgs(args.probe),
    '-id3v2_version', '3', '-write_id3v1', '1',
    ...metadataArgs(args.tags),
    args.outputPath,
  ]
}

/** Latest start (ms) that still leaves a full 10-second clip; 0 for songs shorter than that. */
export function maxPreviewStartMs(durationMs: number): number {
  return Math.max(0, Math.floor(durationMs - PREVIEW_SECONDS * 1000))
}

/**
 * Where the preview starts. `requestedStartMs` is the artist's choice (null = automatic: 30 s in for
 * songs of 90 s or more, otherwise the top), clamped so the clip never runs past the end.
 */
export function previewWindow(durationMs: number, requestedStartMs: number | null = null): {startSeconds: number; lengthSeconds: number} {
  const durationSeconds = durationMs / 1000
  const wanted = requestedStartMs === null || requestedStartMs === undefined
    ? (durationSeconds >= AUTO_START_SECONDS * 3 ? AUTO_START_SECONDS : 0)
    : requestedStartMs / 1000
  const startSeconds = Math.round(Math.max(0, Math.min(wanted, maxPreviewStartMs(durationMs) / 1000)) * 1000) / 1000
  const lengthSeconds = Math.max(1, Math.min(PREVIEW_SECONDS, durationSeconds - startSeconds))
  return {startSeconds, lengthSeconds: Math.round(lengthSeconds * 1000) / 1000}
}

/** 10-second tagged clip that fades in and out, for store previews. */
export function previewArgs(args: {sourcePath: string; coverPath: string | null; outputPath: string; tags: TrackTagData; probe: AudioProbe; requestedStartMs?: number | null}): string[] {
  const {startSeconds, lengthSeconds} = previewWindow(args.probe.durationMs, args.requestedStartMs ?? null)
  const fadeIn = Math.min(PREVIEW_FADE_IN_SECONDS, lengthSeconds / 4)
  const fadeOut = Math.min(PREVIEW_FADE_OUT_SECONDS, lengthSeconds / 4)
  return [
    '-ss', String(startSeconds), '-t', String(lengthSeconds), '-i', args.sourcePath,
    ...coverInputArgs(args.coverPath),
    '-map', '0:a:0',
    ...coverMapArgs(args.coverPath),
    '-map_metadata', '-1',
    '-af', `afade=t=in:d=${fadeIn.toFixed(3)},afade=t=out:st=${Math.max(0, lengthSeconds - fadeOut).toFixed(3)}:d=${fadeOut.toFixed(3)}`,
    '-c:a', 'libmp3lame', '-b:a', PREVIEW_BITRATE,
    ...sampleRateArgs(args.probe),
    '-id3v2_version', '3',
    ...metadataArgs({...args.tags, title: `${args.tags.title} (Preview)`}),
    args.outputPath,
  ]
}
