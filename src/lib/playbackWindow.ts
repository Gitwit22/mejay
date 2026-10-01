/**
 * Where playback starts and where auto-advance cuts off, shared by the DJ store (which acts on
 * it) and the Now Playing display (which shows it), so the two can't disagree.
 */
type WindowTrack = { duration?: number; trueStartTime?: number; trueEndTime?: number } | undefined
type WindowSettings = { nextSongStartOffset?: number; endEarlySeconds?: number } | undefined

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function effectiveStartTimeSec(track: WindowTrack, settings: WindowSettings): number {
  const userOffset = settings?.nextSongStartOffset ?? 0
  // A detected leading-silence boundary is a floor so playback always skips silence.
  const silenceSkip = typeof track?.trueStartTime === 'number' && Number.isFinite(track.trueStartTime) && track.trueStartTime > 0
    ? track.trueStartTime
    : 0
  const duration = track?.duration
  if (!duration || !Number.isFinite(duration)) return Math.max(0, Math.max(userOffset, silenceSkip))
  // Never skip more than half of a (short) track via the user offset, otherwise the start lands
  // past the auto-advance cutoff and the track is skipped the moment it starts.
  const base = Math.max(Math.min(userOffset, duration * 0.5), silenceSkip)
  return clamp(base, 0, Math.max(0, duration - 0.25))
}

export function musicalEndSec(track: WindowTrack, deckDuration?: number): number {
  const duration = deckDuration && deckDuration > 0 ? deckDuration : (track?.duration ?? 0)
  if (!duration || !Number.isFinite(duration) || duration <= 0) return 0
  return typeof track?.trueEndTime === 'number' && Number.isFinite(track.trueEndTime) && track.trueEndTime > 0
    ? Math.min(track.trueEndTime, duration)
    : duration
}

/** Seconds trimmed from the end: the user setting, at most a quarter of the track. */
export function effectiveEndEarlySec(track: WindowTrack, settings: WindowSettings, deckDuration?: number): number {
  return Math.min(clamp(settings?.endEarlySeconds ?? 0, 0, 60), musicalEndSec(track, deckDuration) * 0.25)
}

/** Track-time at which the deck auto-advances (at least 1 s of playback). */
export function autoAdvanceCutoffSec(track: WindowTrack, settings: WindowSettings, deckDuration?: number): number {
  const end = musicalEndSec(track, deckDuration)
  if (end <= 0) return 0
  return Math.max(1, end - effectiveEndEarlySec(track, settings, deckDuration))
}
