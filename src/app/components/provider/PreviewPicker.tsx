import {useCallback, useEffect, useRef, useState} from 'react'
import {Crosshair, Pause, Play, RotateCcw} from 'lucide-react'

import {Button} from '@/components/ui/button'
import {automaticPreviewStartMs, clampPreviewStartMs, formatPreviewStart, latestPreviewStartMs} from '@/lib/releaseTime'
import {loadPeaks} from '@/lib/waveform'

type Props = {
  /** The song to play: MeJay's MP3 of the master, the master, or a staged replacement. */
  audioUrl: string
  /** Fallback until the audio reports its own duration. */
  durationMs: number | null | undefined
  /** null = automatic. */
  startMs: number | null
  lengthMs: number
  onChange: (startMs: number | null) => void
  /** Names the song for screen readers when several pickers share a page. */
  songTitle: string
}

type Mode = 'preview' | 'song' | null

const STEP_MS = 1000
const BIG_STEP_MS = 5000

/**
 * Shows a song's waveform with the store preview as a highlighted window. The artist plays the real
 * audio and drags (or keys) the window to choose the section fans hear. Starts snap to whole seconds
 * because the start field takes minutes:seconds.
 */
export function PreviewPicker({audioUrl, durationMs, startMs, lengthMs, onChange, songTitle}: Props) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const frameRef = useRef<number | null>(null)
  const dragRef = useRef<{offsetMs: number} | null>(null)
  const [peaks, setPeaks] = useState<number[] | null | 'loading'>('loading')
  const [mediaDurationMs, setMediaDurationMs] = useState<number | null>(null)
  const [mode, setMode] = useState<Mode>(null)
  const [playheadMs, setPlayheadMs] = useState(0)
  const [playError, setPlayError] = useState<string | null>(null)

  const duration = mediaDurationMs ?? (durationMs && durationMs > 0 ? durationMs : null)
  const start = duration ? clampPreviewStartMs(startMs ?? automaticPreviewStartMs(duration), duration, lengthMs) : 0
  const end = duration ? Math.min(duration, start + lengthMs) : 0
  const latest = duration ? latestPreviewStartMs(duration, lengthMs) : 0

  // The waveform downloads the whole song, so on an album each picker waits until it is scrolled into view.
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const element = trackRef.current
    if (visible || !element) return
    const observer = new IntersectionObserver((entries) => { if (entries.some((entry) => entry.isIntersecting)) setVisible(true) }, {rootMargin: '200px'})
    observer.observe(element)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible) return
    const controller = new AbortController()
    setPeaks('loading')
    void loadPeaks(audioUrl, controller.signal).then((result) => { if (!controller.signal.aborted) setPeaks(result) })
    return () => controller.abort()
  }, [audioUrl, visible])

  const stop = useCallback(() => {
    audioRef.current?.pause()
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
    frameRef.current = null
    setMode(null)
  }, [])

  useEffect(() => () => {
    audioRef.current?.pause()
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current)
  }, [])

  // Follows playback every frame so the preview stops right at its end and the playhead moves smoothly.
  const follow = useCallback((stopAtMs: number | null) => {
    const tick = () => {
      const audio = audioRef.current
      if (!audio) return
      const now = audio.currentTime * 1000
      setPlayheadMs(now)
      if ((stopAtMs !== null && now >= stopAtMs) || audio.ended) {
        stop()
        return
      }
      frameRef.current = requestAnimationFrame(tick)
    }
    frameRef.current = requestAnimationFrame(tick)
  }, [stop])

  const play = async (next: Exclude<Mode, null>) => {
    const audio = audioRef.current
    if (!audio || !duration) return
    stop()
    setPlayError(null)
    audio.currentTime = (next === 'preview' ? start : playheadMs >= duration - 250 ? 0 : playheadMs) / 1000
    try {
      await audio.play()
    } catch {
      setPlayError("This song couldn't be played here. Try another browser, or set the start by typing it.")
      return
    }
    setMode(next)
    follow(next === 'preview' ? end : null)
  }

  const move = (nextStartMs: number) => {
    if (!duration) return
    const clamped = clampPreviewStartMs(nextStartMs, duration, lengthMs)
    if (clamped !== start || startMs === null) onChange(clamped)
  }

  const msAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || !duration || rect.width <= 0) return 0
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration
  }

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!duration || event.button !== 0) return
    const at = msAt(event.clientX)
    // Grabbing the window keeps its offset; clicking elsewhere centres the window on that point.
    const offsetMs = at >= start && at <= end ? at - start : lengthMs / 2
    dragRef.current = {offsetMs}
    event.currentTarget.setPointerCapture?.(event.pointerId)
    move(at - offsetMs)
  }
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragRef.current) move(msAt(event.clientX) - dragRef.current.offsetMs)
  }
  const onPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    dragRef.current = null
    event.currentTarget.releasePointerCapture?.(event.pointerId)
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? BIG_STEP_MS : STEP_MS
    const target = event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? start - step
      : event.key === 'ArrowRight' || event.key === 'ArrowUp' ? start + step
        : event.key === 'Home' ? 0
          : event.key === 'End' ? latest
            : null
    if (target === null) return
    event.preventDefault()
    move(target)
  }

  // Bars inside the preview window are highlighted; redrawn when the window moves or the size changes.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !Array.isArray(peaks) || peaks.length === 0 || !duration) return
    const draw = () => {
      const context = canvas.getContext('2d')
      if (!context) return
      const ratio = window.devicePixelRatio || 1
      const width = canvas.clientWidth * ratio
      const height = canvas.clientHeight * ratio
      if (width === 0 || height === 0) return
      canvas.width = width
      canvas.height = height
      context.clearRect(0, 0, width, height)
      const barWidth = width / peaks.length
      // Scaled to the song's loudest moment so quietly mastered songs still show their shape.
      const loudest = Math.max(...peaks) || 1
      peaks.forEach((peak, index) => {
        const at = ((index + 0.5) / peaks.length) * duration
        context.fillStyle = at >= start && at <= end ? '#34d399' : '#52525b'
        const barHeight = Math.max(ratio, (peak / loudest) * height * 0.9)
        context.fillRect(index * barWidth, (height - barHeight) / 2, Math.max(ratio, barWidth - ratio), barHeight)
      })
    }
    draw()
    window.addEventListener('resize', draw)
    return () => window.removeEventListener('resize', draw)
  }, [peaks, duration, start, end])

  const percent = (ms: number) => duration ? `${(ms / duration) * 100}%` : '0%'
  const range = `${formatPreviewStart(start)} to ${formatPreviewStart(end)}`

  return <div className="space-y-3 rounded-md border border-white/10 bg-zinc-950/60 p-3" aria-label={`Preview picker for ${songTitle}`} role="group">
    <audio ref={audioRef} src={audioUrl} preload="metadata"
      onLoadedMetadata={(event) => { const seconds = event.currentTarget.duration; if (Number.isFinite(seconds) && seconds > 0) setMediaDurationMs(Math.round(seconds * 1000)) }}
      onError={() => setPlayError("This song couldn't be loaded. Try again later, or set the start by typing it.")} />
    <div ref={trackRef} className="relative h-20 w-full cursor-pointer touch-none select-none overflow-hidden rounded bg-zinc-900"
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
      {Array.isArray(peaks) && peaks.length > 0
        ? <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
        : <div className="absolute inset-x-0 top-1/2 h-px bg-zinc-600" aria-hidden="true" />}
      {duration && <div role="slider" tabIndex={0} aria-label={`Preview section of ${songTitle}`}
        aria-valuemin={0} aria-valuemax={Math.round(latest / 1000)} aria-valuenow={Math.round(start / 1000)} aria-valuetext={`Preview ${range}`}
        onKeyDown={onKeyDown}
        className="absolute inset-y-0 cursor-grab rounded border-2 border-emerald-400 bg-emerald-400/15 outline-none focus-visible:ring-2 focus-visible:ring-emerald-200 active:cursor-grabbing"
        style={{left: percent(start), width: percent(end - start)}} />}
      {mode && <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-white" style={{left: percent(playheadMs)}} aria-hidden="true" />}
    </div>
    <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400">
      <span className="font-medium text-zinc-200">Preview {duration ? range : '…'}</span>
      {startMs === null && duration && <span>Automatic</span>}
      {peaks === 'loading' && <span>Loading waveform…</span>}
      {peaks === null && <span>Waveform unavailable for this file; you can still play it and choose the section.</span>}
    </div>
    <div className="flex flex-wrap gap-2">
      {mode === 'preview'
        ? <Button type="button" size="sm" variant="outline" onClick={stop}><Pause className="mr-1 h-4 w-4" />Stop</Button>
        : <Button type="button" size="sm" variant="outline" disabled={!duration} onClick={() => void play('preview')}><Play className="mr-1 h-4 w-4" />Play preview</Button>}
      {mode === 'song'
        ? <Button type="button" size="sm" variant="outline" onClick={stop}><Pause className="mr-1 h-4 w-4" />Pause song</Button>
        : <Button type="button" size="sm" variant="ghost" disabled={!duration} onClick={() => void play('song')}><Play className="mr-1 h-4 w-4" />Play song</Button>}
      {mode === 'song' && <Button type="button" size="sm" variant="ghost" onClick={() => move(playheadMs)}><Crosshair className="mr-1 h-4 w-4" />Start preview here</Button>}
      {startMs !== null && <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}><RotateCcw className="mr-1 h-4 w-4" />Use automatic</Button>}
    </div>
    <p className="text-xs text-zinc-500">Drag the green section, or focus it and use the arrow keys (Shift for 5 seconds), to choose what fans hear.</p>
    {playError && <p role="alert" className="text-xs text-red-400">{playError}</p>}
  </div>
}
