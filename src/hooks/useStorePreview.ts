import {useEffect, useRef, useState} from 'react'

import {toast} from '@/hooks/use-toast'
import {recordStorePreview, storeAssetUrl} from '@/lib/musicStoreApi'

/** One shared audio element for public 30-second previews (store and artist pages). */
export type PreviewController = {
  playingId: string | null
  toggle: (trackId: string, assetId: string | null) => void
}

export function usePreview(): PreviewController {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)

  useEffect(() => () => audioRef.current?.pause(), [])

  const toggle = (trackId: string, assetId: string | null) => {
    const url = storeAssetUrl(assetId)
    if (!url) return
    if (playingId === trackId) {
      audioRef.current?.pause()
      setPlayingId(null)
      return
    }
    audioRef.current?.pause()
    const audio = new Audio(url)
    audio.preload = 'metadata'
    audio.addEventListener('ended', () => setPlayingId(null), {once: true})
    audio.addEventListener('error', () => {
      setPlayingId(null)
      toast({title: 'Preview unavailable', description: 'The audio preview could not be loaded.', variant: 'destructive'})
    }, {once: true})
    audioRef.current = audio
    void audio.play().then(() => {
      setPlayingId(trackId)
      void recordStorePreview(assetId!).catch(() => undefined)
    }).catch(() => setPlayingId(null))
  }

  return {playingId, toggle}
}
