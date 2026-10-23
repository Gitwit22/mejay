import {toast} from '@/hooks/use-toast'

/** Shares a link: the phone share sheet where available, otherwise the clipboard. */
export async function shareLink(title: string, url: string): Promise<void> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({title, url})
      return
    } catch (error) {
      // Closing the share sheet is not a failure; anything else falls back to copying.
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    toast({title: 'Link copied', description: url})
  } catch {
    toast({title: 'Could not copy the link', description: url, variant: 'destructive'})
  }
}
