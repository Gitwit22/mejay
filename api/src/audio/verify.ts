import {AudioToolError, runFfmpeg} from './ffmpeg'
import {probeAudio, type AudioProbe} from './probe'

export type VerifyExpectation = {
  durationMs: number
  toleranceMs?: number
  title: string
  artist: string
  album: string
  coverArt: boolean
}

/** Pure checks on a probe, unit-tested. Returns human-readable problems (empty = good). */
export function checkProbe(probe: AudioProbe, expected: VerifyExpectation): string[] {
  const problems: string[] = []
  const tolerance = expected.toleranceMs ?? 500
  if (probe.codec !== 'mp3') problems.push(`expected mp3 audio, got ${probe.codec}`)
  if (Math.abs(probe.durationMs - expected.durationMs) > tolerance) {
    problems.push(`duration ${probe.durationMs}ms differs from expected ${expected.durationMs}ms`)
  }
  for (const [key, value] of [['title', expected.title], ['artist', expected.artist], ['album', expected.album]] as const) {
    if (probe.tags[key] !== value) problems.push(`tag ${key} is "${probe.tags[key] ?? ''}", expected "${value}"`)
  }
  if (expected.coverArt && !probe.hasCoverArt) problems.push('cover art is missing')
  return problems
}

/** Decodes the whole file (catches truncation/corruption), then checks duration, tags and cover. */
export async function verifyMp3(filePath: string, expected: VerifyExpectation): Promise<AudioProbe> {
  await runFfmpeg(['-v', 'error', '-xerror', '-i', filePath, '-f', 'null', '-'], {timeoutMs: 5 * 60_000})
  const probe = await probeAudio(filePath)
  const problems = checkProbe(probe, expected)
  if (problems.length > 0) throw new AudioToolError(`Output verification failed: ${problems.join('; ')}`)
  return probe
}
