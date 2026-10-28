import {act, fireEvent, render, screen, waitFor} from '@testing-library/react'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

import {loadPeaks} from '@/lib/waveform'
import {PreviewPicker} from './PreviewPicker'

vi.mock('@/lib/waveform', () => ({loadPeaks: vi.fn()}))

// jsdom has no PointerEvent; a MouseEvent carries clientX the same way.
class PointerEventStub extends MouseEvent {
  pointerId: number
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
  }
}

let frames: FrameRequestCallback[] = []
const runFrame = () => act(() => { const pending = frames; frames = []; pending.forEach((callback) => callback(0)) })

function renderPicker(props: Partial<Parameters<typeof PreviewPicker>[0]> = {}) {
  const onChange = vi.fn()
  const view = render(<PreviewPicker audioUrl="/api/marketplace/assets/a1/audio" durationMs={200_000} startMs={60_000} lengthMs={15_000} songTitle="MIA" onChange={onChange} {...props} />)
  const audio = view.container.querySelector('audio')!
  let time = 0
  Object.defineProperty(audio, 'currentTime', {configurable: true, get: () => time, set: (value: number) => { time = value }})
  const slider = screen.getByRole('slider', {name: 'Preview section of MIA'})
  const track = slider.parentElement!
  track.getBoundingClientRect = () => ({left: 0, width: 1000, top: 0, height: 80, right: 1000, bottom: 80, x: 0, y: 0, toJSON: () => ({})})
  return {...view, onChange, audio, slider, track, setTime: (seconds: number) => { time = seconds }}
}

describe('preview picker', () => {
  beforeEach(() => {
    frames = []
    vi.mocked(loadPeaks).mockReset().mockResolvedValue([0.2, 0.8, 0.5])
    vi.stubGlobal('PointerEvent', PointerEventStub)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', () => { frames = [] })
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined)
    vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    // jsdom has no canvas; the picker skips drawing when there is no 2D context.
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('loads the waveform for the song and shows the chosen section', async () => {
    const {slider} = renderPicker()
    expect(loadPeaks).toHaveBeenCalledWith('/api/marketplace/assets/a1/audio', expect.any(AbortSignal))
    expect(slider).toHaveAttribute('aria-valuetext', 'Preview 1:00 to 1:15')
    expect(slider).toHaveAttribute('aria-valuemax', '185')
    expect(slider.style.left).toBe('30%')
    expect(slider.style.width).toBe('7.5%')
    await waitFor(() => expect(screen.queryByText('Loading waveform…')).not.toBeInTheDocument())
  })

  it('waits to download the waveform until the picker is scrolled into view', () => {
    let reveal: (() => void) | null = null
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: IntersectionObserverCallback) { reveal = () => callback([{isIntersecting: true} as IntersectionObserverEntry], this as never) }
      observe() {}
      disconnect() {}
    })
    renderPicker()
    expect(loadPeaks).not.toHaveBeenCalled()
    act(() => reveal!())
    expect(loadPeaks).toHaveBeenCalledTimes(1)
  })

  it('shows an automatic start where the converter would put it, and can go back to automatic', () => {
    renderPicker({startMs: null})
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', 'Preview 0:30 to 0:45')
    expect(screen.getByText('Automatic')).toBeInTheDocument()
    expect(screen.queryByRole('button', {name: /Use automatic/})).not.toBeInTheDocument()
  })

  it('moves the section with the keyboard, in whole seconds and inside the song', () => {
    const {slider, onChange} = renderPicker()
    fireEvent.keyDown(slider, {key: 'ArrowRight'})
    expect(onChange).toHaveBeenLastCalledWith(61_000)
    fireEvent.keyDown(slider, {key: 'ArrowLeft', shiftKey: true})
    expect(onChange).toHaveBeenLastCalledWith(55_000)
    fireEvent.keyDown(slider, {key: 'End'})
    expect(onChange).toHaveBeenLastCalledWith(185_000)
    fireEvent.keyDown(slider, {key: 'Home'})
    expect(onChange).toHaveBeenLastCalledWith(0)
    fireEvent.click(screen.getByRole('button', {name: /Use automatic/}))
    expect(onChange).toHaveBeenLastCalledWith(null)
  })

  it('centres the section where the waveform is clicked, and drags it keeping the grab point', () => {
    const {track, onChange} = renderPicker()
    // Click at 1:40 (outside the 1:00-1:15 section): the section centres there.
    fireEvent.pointerDown(track, {clientX: 500, button: 0, pointerId: 1})
    expect(onChange).toHaveBeenLastCalledWith(93_000)
    fireEvent.pointerMove(track, {clientX: 600, pointerId: 1})
    expect(onChange).toHaveBeenLastCalledWith(113_000)
    fireEvent.pointerUp(track, {pointerId: 1})
    onChange.mockClear()
    fireEvent.pointerMove(track, {clientX: 700, pointerId: 1})
    expect(onChange).not.toHaveBeenCalled()

    // Grab inside the section 2 s in, drag to 1:20: it starts 2 s earlier, and stops at the song's end.
    fireEvent.pointerDown(track, {clientX: 310, button: 0, pointerId: 2})
    fireEvent.pointerMove(track, {clientX: 400, pointerId: 2})
    expect(onChange).toHaveBeenLastCalledWith(78_000)
    fireEvent.pointerMove(track, {clientX: 1000, pointerId: 2})
    expect(onChange).toHaveBeenLastCalledWith(185_000)
  })

  it('plays exactly the preview section and stops at its end', async () => {
    const {audio, setTime} = renderPicker()
    fireEvent.click(screen.getByRole('button', {name: /Play preview/}))
    await waitFor(() => expect(HTMLMediaElement.prototype.play).toHaveBeenCalled())
    expect(audio.currentTime).toBe(60)
    expect(await screen.findByRole('button', {name: /Stop/})).toBeInTheDocument()
    const pausesBefore = vi.mocked(HTMLMediaElement.prototype.pause).mock.calls.length
    setTime(70)
    runFrame()
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(pausesBefore)
    setTime(75.05)
    runFrame()
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(pausesBefore + 1)
    expect(screen.getByRole('button', {name: /Play preview/})).toBeInTheDocument()
  })

  it('plays the whole song and can start the preview at the playhead', async () => {
    const {setTime, onChange} = renderPicker()
    fireEvent.click(screen.getByRole('button', {name: /Play song/}))
    await screen.findByRole('button', {name: /Pause song/})
    setTime(141.6)
    runFrame()
    fireEvent.click(screen.getByRole('button', {name: /Start preview here/}))
    expect(onChange).toHaveBeenLastCalledWith(142_000)
  })

  it("uses the audio's own duration once it loads", () => {
    const {container} = render(<PreviewPicker audioUrl="/a.flac" durationMs={null} startMs={null} lengthMs={15_000} songTitle="MIA" onChange={vi.fn()} />)
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
    expect(screen.getByRole('button', {name: /Play preview/})).toBeDisabled()
    const audio = container.querySelector('audio')!
    Object.defineProperty(audio, 'duration', {configurable: true, get: () => 100})
    fireEvent.loadedMetadata(audio)
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuemax', '85')
  })

  it('still plays and selects without a waveform, and says when playback fails', async () => {
    vi.mocked(loadPeaks).mockResolvedValue(null)
    vi.mocked(HTMLMediaElement.prototype.play).mockRejectedValue(new Error('NotSupportedError'))
    renderPicker()
    expect(await screen.findByText(/Waveform unavailable for this file/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', {name: /Play preview/}))
    expect(await screen.findByRole('alert')).toHaveTextContent("This song couldn't be played here")
  })
})
