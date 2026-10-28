import {useState} from 'react'
import {Check, Copy, Mail, MessageSquare, Share2} from 'lucide-react'

import {Button} from '@/components/ui/button'
import {Popover, PopoverContent, PopoverTrigger} from '@/components/ui/popover'
import {toast} from '@/hooks/use-toast'
import type {StoryView} from '@/lib/storiesApi'
import {shareDetails} from '@/lib/storyShare'

/**
 * Share a story: the phone's own share sheet where available, otherwise a small menu with copy
 * link and the usual places. Only the readable /stories/<title> link is ever shared.
 */
export function ShareStory({story}: {story: Pick<StoryView, 'slug' | 'title' | 'teaser'>}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const {url, text, title, summary} = shareDetails(story)

  const nativeShare = async () => {
    try {
      await navigator.share({title, text: summary, url})
    } catch (error) {
      // Closing the share sheet is not an error worth showing.
      if ((error as {name?: string})?.name !== 'AbortError') setOpen(true)
    }
  }
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast({title: 'Link copied', description: 'Paste it anywhere to share the story.'})
    } catch {
      toast({title: 'Copy the link below', description: url})
    }
  }
  const links = [
    {label: 'Post on X', href: `https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, icon: <span aria-hidden="true" className="w-4 text-center font-black">𝕏</span>},
    {label: 'Share on Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`, icon: <span aria-hidden="true" className="w-4 text-center font-black">f</span>},
    {label: 'Send as a text', href: `sms:?&body=${encodeURIComponent(`${text} ${url}`)}`, icon: <MessageSquare className="h-4 w-4" />},
    {label: 'Send by email', href: `mailto:?subject=${encodeURIComponent(title)}&body=${encodeURIComponent(`${summary}\n\n${url}`)}`, icon: <Mail className="h-4 w-4" />},
  ]
  const canNativeShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  return <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setCopied(false) }}>
    <PopoverTrigger asChild>
      <Button type="button" size="sm" variant="outline" className="gap-2 rounded-full border-current/20 bg-transparent font-semibold"
        onClick={(event) => { if (canNativeShare) { event.preventDefault(); void nativeShare() } }}>
        <Share2 className="h-4 w-4" />Share
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" className="w-72 border-white/10 bg-[#151518] p-3 text-zinc-100">
      <p className="text-sm font-semibold">Share this story</p>
      <p className="mt-1 truncate text-xs text-zinc-400" title={url}>{url.replace(/^https?:\/\//, '')}</p>
      <Button type="button" className="mt-3 w-full gap-2 bg-emerald-400 font-semibold text-zinc-950 hover:bg-emerald-300" onClick={() => void copy()}>
        {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? 'Link copied' : 'Copy link'}
      </Button>
      <ul className="mt-2 space-y-1">{links.map((link) => <li key={link.label}>
        <a href={link.href} target={link.href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer" onClick={() => setOpen(false)}
          className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none">{link.icon}{link.label}</a>
      </li>)}</ul>
    </PopoverContent>
  </Popover>
}
