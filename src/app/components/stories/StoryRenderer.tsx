import {createContext, Fragment, useContext, type ReactNode} from 'react'
import {ArrowRight, Disc3, Eye, Pause, Play, ShoppingBag} from 'lucide-react'
import {Link} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {usePreview} from '@/hooks/useStorePreview'
import {storeAssetUrl} from '@/lib/musicStoreApi'
import {parseInline} from '@/lib/storyInline'
import {storyMediaUrl, type StoryBlock, type StoryMedia, type StoryPalette, type StoryView} from '@/lib/storiesApi'

/**
 * The one renderer for stories: the public page and the admin preview both use it, so what an
 * editor previews is exactly what readers get. Colours come from a fixed palette that keeps text
 * readable; nothing an editor types is rendered as HTML.
 */

type Palette = {hex: string; page: string; text: string; muted: string; accent: string; button: string; rule: string; surface: string}

const PALETTES: Record<StoryPalette, Palette> = {
  ink: {hex: '#0a0a0b', page: 'bg-[#0a0a0b]', text: 'text-zinc-100', muted: 'text-zinc-400', accent: 'text-emerald-400', button: 'bg-emerald-400 text-zinc-950 hover:bg-emerald-300', rule: 'border-white/10', surface: 'bg-white/[0.04]'},
  midnight: {hex: '#0a0f1f', page: 'bg-[#0a0f1f]', text: 'text-slate-100', muted: 'text-slate-400', accent: 'text-sky-300', button: 'bg-sky-300 text-slate-950 hover:bg-sky-200', rule: 'border-white/10', surface: 'bg-white/[0.04]'},
  violet: {hex: '#110a1c', page: 'bg-[#110a1c]', text: 'text-zinc-100', muted: 'text-zinc-400', accent: 'text-fuchsia-400', button: 'bg-fuchsia-500 text-white hover:bg-fuchsia-400', rule: 'border-white/10', surface: 'bg-white/[0.05]'},
  teal: {hex: '#071618', page: 'bg-[#071618]', text: 'text-zinc-100', muted: 'text-zinc-400', accent: 'text-cyan-300', button: 'bg-cyan-300 text-zinc-950 hover:bg-cyan-200', rule: 'border-white/10', surface: 'bg-white/[0.04]'},
  paper: {hex: '#ffffff', page: 'bg-white', text: 'text-zinc-900', muted: 'text-zinc-600', accent: 'text-violet-700', button: 'bg-violet-700 text-white hover:bg-violet-600', rule: 'border-zinc-200', surface: 'bg-zinc-50'},
}

function paletteFor(name: StoryPalette | undefined): Palette {
  return PALETTES[name ?? 'ink'] ?? PALETTES.ink
}

/** Share controls for the public page (absent in the admin preview). */
const ShareSlot = createContext<ReactNode>(null)

export function StoryRenderer({story, share}: {story: StoryView; share?: ReactNode}) {
  const palette = paletteFor(story.appearance.palette)
  // A background image only sits behind light-on-dark palettes, under an enforced dark overlay.
  const background = story.appearance.palette !== 'paper' ? story.background : null
  return <ShareSlot.Provider value={share ?? null}><article className={`relative min-h-full overflow-hidden ${palette.page} ${palette.text}`}>
    {background && <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[34rem]">
      <img src={storyMediaUrl(background.url)} alt="" className="h-full w-full object-cover" />
      <div className="absolute inset-0" style={{backgroundColor: `rgba(0,0,0,${Math.max(story.appearance.overlay, 35) / 100})`}} />
      <div className="absolute inset-x-0 bottom-0 h-40" style={{backgroundImage: `linear-gradient(to bottom, transparent, ${palette.hex})`}} />
    </div>}
    <div className="relative">
      {story.template === 'artist_spotlight' ? <Spotlight story={story} palette={palette} />
        : story.template === 'release_drop' ? <ReleaseDrop story={story} palette={palette} />
          : <Headliner story={story} palette={palette} />}
    </div>
  </article></ShareSlot.Provider>
}

function Headliner({story, palette}: {story: StoryView; palette: Palette}) {
  return <div className="mx-auto max-w-3xl lg:max-w-5xl px-4 py-10 sm:px-8 sm:py-14">
    <Kicker story={story} palette={palette} />
    <h1 className="mt-4 font-serif text-4xl font-black leading-[1.05] sm:text-6xl">{story.title}</h1>
    {story.teaser && <p className={`mt-5 font-serif text-lg leading-relaxed sm:text-xl ${palette.muted}`}>{story.teaser}</p>}
    {story.cover && <Figure media={story.cover} focal={story.appearance.coverFocal} className="mt-8 aspect-[16/9]" palette={palette} priority />}
    <Byline story={story} palette={palette} />
    <Body story={story} palette={palette} dropCap />
    <Gallery story={story} palette={palette} />
    <Footer story={story} palette={palette} />
  </div>
}

function Spotlight({story, palette}: {story: StoryView; palette: Palette}) {
  const artist = story.artist
  return <>
    <section className="relative isolate overflow-hidden">
      {story.cover && <img src={storyMediaUrl(story.cover.url)} alt={story.cover.altText} className="absolute inset-0 -z-10 h-full w-full object-cover" style={{objectPosition: `${story.appearance.coverFocal.x}% ${story.appearance.coverFocal.y}%`}} />}
      <div className="absolute inset-0 -z-10 bg-gradient-to-t from-black via-black/70 to-black/10 sm:bg-gradient-to-r sm:from-black/95 sm:via-black/60 sm:to-transparent" />
      <div className="mx-auto flex min-h-[32rem] max-w-6xl flex-col justify-end gap-8 px-4 pb-10 pt-40 text-white sm:min-h-[38rem] sm:px-8 lg:flex-row lg:items-end lg:justify-between">
        <div className="max-w-xl">
          <Kicker story={story} palette={palette} fallback="Artist Spotlight" />
          <h1 className="mt-3 text-4xl font-black uppercase leading-[0.95] tracking-tight sm:text-6xl">{story.title}</h1>
          {story.teaser && <p className="mt-5 font-serif text-lg leading-relaxed text-zinc-200">{story.teaser}</p>}
          {story.quote && <blockquote className="mt-6 border-l-4 border-current pl-4"><p className={`font-serif text-xl italic ${palette.accent}`}>“{story.quote.text}”</p>{story.quote.attribution && <footer className="mt-2 text-xs font-semibold uppercase tracking-[0.18em] text-zinc-300">— {story.quote.attribution}</footer>}</blockquote>}
          {artist && <Button asChild className={`mt-7 gap-2 font-bold ${palette.button}`}><Link to={`/artist/${artist.slug}`}>Explore the music<ArrowRight className="h-4 w-4" /></Link></Button>}
        </div>
        {artist && <dl className="w-full max-w-[14rem] shrink-0 space-y-3 rounded-md border border-white/15 bg-black/60 p-4 text-sm backdrop-blur">
          <div><dt className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Artist</dt><dd className="font-semibold">{artist.name}</dd></div>
          {story.category && <div><dt className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-400">Feature</dt><dd>{story.category}</dd></div>}
        </dl>}
      </div>
    </section>
    <div className="mx-auto max-w-3xl lg:max-w-5xl px-4 py-10 sm:px-8">
      <Byline story={story} palette={palette} />
      <Body story={story} palette={palette} />
    </div>
    <div className="mx-auto max-w-6xl px-4 pb-12 sm:px-8"><Gallery story={story} palette={palette} wide /><Footer story={story} palette={palette} /></div>
  </>
}

function ReleaseDrop({story, palette}: {story: StoryView; palette: Palette}) {
  const preview = usePreview()
  const detail = story.release
  const release = detail?.release
  const artwork = story.cover ? storyMediaUrl(story.cover.url) : storeAssetUrl(release?.artwork_asset_id)
  const artworkAlt = story.cover?.altText || (release ? `${release.title} cover` : story.title)
  return <div className="mx-auto max-w-6xl px-4 py-10 sm:px-8 sm:py-14">
    <div className="grid gap-8 md:grid-cols-[minmax(0,26rem)_1fr] md:items-end">
      <div className="aspect-square overflow-hidden rounded-md bg-black/40">
        {artwork ? <img src={artwork} alt={artworkAlt} className="h-full w-full object-cover" style={story.cover ? {objectPosition: `${story.appearance.coverFocal.x}% ${story.appearance.coverFocal.y}%`} : undefined} /> : <div className="grid h-full place-items-center"><Disc3 className="h-16 w-16 text-zinc-700" /></div>}
      </div>
      <div>
        <Kicker story={story} palette={palette} fallback="New Release" />
        <h1 className="mt-3 text-4xl font-black leading-[1] tracking-tight sm:text-6xl">{story.title}</h1>
        {release && <p className={`mt-3 text-xl ${palette.muted}`}>{release.title}{release.artist_credit || release.artist_name ? ` · ${release.artist_credit || release.artist_name}` : ''}</p>}
        {release && <p className={`mt-4 text-sm ${palette.muted}`}>{[release.genre, `${detail!.tracks.length} ${detail!.tracks.length === 1 ? 'track' : 'tracks'}`, release.availability === 'preorder' ? 'Pre-order' : null].filter(Boolean).join(' · ')}</p>}
        {story.teaser && <p className="mt-5 font-serif text-lg leading-relaxed">{story.teaser}</p>}
        {release && detail && <div className={`mt-6 rounded-md border ${palette.rule} ${palette.surface} p-3`}>
          <ul className="divide-y divide-white/5">{detail.tracks.slice(0, 5).map((track) => {
            const playing = preview.playingId === track.id
            return <li key={track.id} className="flex items-center gap-3 py-2">
              <Button type="button" size="icon" variant="ghost" className="h-9 w-9 shrink-0 rounded-full border border-current/20" disabled={!track.preview_asset_id} aria-label={`${playing ? 'Pause' : 'Preview'} ${track.title}`} onClick={() => preview.toggle(track.id, track.preview_asset_id)}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button>
              <span className="min-w-0 flex-1 truncate text-sm">{track.title}</span>
            </li>
          })}</ul>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Button asChild className={`gap-2 font-bold ${palette.button}`}><Link to={`/app/store/${release.id}`}><ShoppingBag className="h-4 w-4" />{release.availability === 'preorder' ? 'View release / Pre-order' : 'View release / Buy'} · {formatPrice(release.amount_minor, release.currency)}</Link></Button>
          </div>
        </div>}
      </div>
    </div>
    <div className="mx-auto mt-12 max-w-3xl lg:max-w-5xl">
      <SectionRule label="The story behind the music" palette={palette} />
      <Byline story={story} palette={palette} />
      <Body story={story} palette={palette} />
      {story.quote && <PullQuote quote={story.quote} palette={palette} />}
      <Gallery story={story} palette={palette} />
      <Footer story={story} palette={palette} />
    </div>
  </div>
}

function Kicker({story, palette, fallback}: {story: StoryView; palette: Palette; fallback?: string}) {
  const label = story.category || fallback
  return label ? <p className={`text-xs font-bold uppercase tracking-[0.2em] ${palette.accent}`}>{label}</p> : null
}

function Byline({story, palette}: {story: StoryView; palette: Palette}) {
  const words = story.content.reduce((count, block) => count + (block.type === 'paragraph' || block.type === 'heading' || block.type === 'quote' ? block.text : block.type === 'list' ? block.items.join(' ') : '').split(/\s+/).filter(Boolean).length, 0)
  const minutes = Math.max(1, Math.round(words / 220))
  const date = story.publishedAt ? new Date(story.publishedAt).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'}) : 'Not published yet'
  const share = useContext(ShareSlot)
  return <div className={`mt-6 flex flex-wrap items-center gap-x-3 gap-y-2 border-b pb-4 text-xs ${palette.rule} ${palette.muted}`}>
    {story.authorName && <span className="font-semibold">By {story.authorName}</span>}<span>{date}</span><span>{minutes} min read</span>
    {typeof story.viewCount === 'number' && <span className="inline-flex items-center gap-1"><Eye aria-hidden="true" className="h-3.5 w-3.5" />{story.viewCount.toLocaleString('en-US')} {story.viewCount === 1 ? 'view' : 'views'}</span>}
    {share && <span className="ml-auto">{share}</span>}
  </div>
}

function Body({story, palette, dropCap = false}: {story: StoryView; palette: Palette; dropCap?: boolean}) {
  let firstParagraph = dropCap
  return <div className="mt-6 space-y-5 font-serif text-[1.075rem] leading-[1.8] lg:text-[1.2rem]">
    {story.content.map((block, index) => {
      const capped = block.type === 'paragraph' && firstParagraph
      if (capped) firstParagraph = false
      return <BlockView key={index} block={block} story={story} palette={palette} dropCap={capped} />
    })}
    {story.template === 'headliner' && story.quote && <PullQuote quote={story.quote} palette={palette} />}
  </div>
}

function BlockView({block, story, palette, dropCap}: {block: StoryBlock; story: StoryView; palette: Palette; dropCap: boolean}) {
  switch (block.type) {
    case 'paragraph': {
      // A pasted article keeps its line breaks: each line is its own paragraph, and a short
      // all-caps line on its own reads as a subheading.
      const lines = splitLines(block.text)
      if (lines.length === 0) return null
      return <>{lines.map((line, index) => isSubheading(line)
        ? <h2 key={index} className="pt-3 font-sans text-xl font-black tracking-wide">{line}</h2>
        : <p key={index} className={dropCap && index === 0 ? 'first-letter:float-left first-letter:mr-2 first-letter:text-6xl first-letter:font-black first-letter:leading-[0.85]' : undefined}><InlineText text={line} palette={palette} /></p>)}</>
    }
    case 'heading': return block.text.trim() ? <h2 className="pt-3 font-sans text-2xl font-black">{block.text}</h2> : null
    case 'list': return <ul className="list-disc space-y-1 pl-6">{block.items.filter((item) => item.trim()).map((item, index) => <li key={index}><InlineText text={item} palette={palette} /></li>)}</ul>
    case 'quote': return block.text.trim() ? <PullQuote quote={{text: block.text, attribution: block.attribution ?? null}} palette={palette} /> : null
    case 'image': {
      const media = story.inlineMedia[block.mediaId]
      return media ? <Figure media={media} className="aspect-[3/2]" palette={palette} /> : null
    }
  }
}

export function InlineText({text, palette}: {text: string; palette: Palette}) {
  return <>{parseInline(text).map((token, index) => <Fragment key={index}>{
    token.type === 'bold' ? <strong>{token.text}</strong>
      : token.type === 'italic' ? <em>{token.text}</em>
        : token.type === 'link' ? <a href={token.href} target="_blank" rel="noopener noreferrer nofollow" className={`underline underline-offset-2 ${palette.accent}`}>{token.text}</a>
          : token.text
  }</Fragment>)}</>
}

function PullQuote({quote, palette}: {quote: {text: string; attribution: string | null}; palette: Palette}) {
  return <blockquote className={`my-8 border-l-4 pl-5 ${palette.rule}`} style={{borderLeftColor: 'currentColor'}}>
    <p className={`font-serif text-2xl italic leading-snug ${palette.accent}`}>“{quote.text}”</p>
    {quote.attribution && <footer className={`mt-3 font-sans text-xs font-semibold uppercase tracking-[0.18em] ${palette.muted}`}>— {quote.attribution}</footer>}
  </blockquote>
}

function Figure({media, focal, className, palette, priority = false}: {media: StoryMedia; focal?: {x: number; y: number}; className?: string; palette: Palette; priority?: boolean}) {
  return <figure className="my-2">
    <div className={`overflow-hidden rounded-md bg-black/20 ${className ?? ''}`}>
      <img src={storyMediaUrl(media.url)} alt={media.altText} className="h-full w-full object-cover" loading={priority ? 'eager' : 'lazy'} style={focal ? {objectPosition: `${focal.x}% ${focal.y}%`} : undefined} />
    </div>
    {(media.caption || media.credit) && <figcaption className={`mt-2 font-sans text-xs ${palette.muted}`}>{media.caption}{media.caption && media.credit ? ' · ' : ''}{media.credit && <span>Photo: {media.credit}</span>}</figcaption>}
  </figure>
}

function Gallery({story, palette, wide = false}: {story: StoryView; palette: Palette; wide?: boolean}) {
  if (story.gallery.length === 0) return null
  return <section aria-label="Photo gallery" className={`mt-10 grid gap-3 ${wide ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
    {story.gallery.map((media) => <Figure key={media.id} media={media} className="aspect-[4/3]" palette={palette} />)}
  </section>
}

function Footer({story, palette}: {story: StoryView; palette: Palette}) {
  const share = useContext(ShareSlot)
  const hasTags = story.tags.length > 0
  if (!story.source && !hasTags && !share) return null
  return <footer className={`mt-10 space-y-3 border-t pt-5 text-sm ${palette.rule} ${palette.muted}`}>
    {share && <div className="flex flex-wrap items-center gap-3"><span className={`font-semibold ${palette.text}`}>Enjoyed this story? Pass it on.</span>{share}</div>}
    {story.source && <p>Source: {story.source.url ? <a href={story.source.url} target="_blank" rel="noopener noreferrer nofollow" className={`underline ${palette.accent}`}>{story.source.name || story.source.url}</a> : story.source.name}</p>}
    {hasTags && <ul className="flex flex-wrap gap-2" aria-label="Tags">{story.tags.map((tag) => <li key={tag} className={`rounded-full border px-3 py-1 text-xs ${palette.rule}`}>#{tag}</li>)}</ul>}
  </footer>
}

function SectionRule({label, palette}: {label: string; palette: Palette}) {
  return <div className="flex items-center gap-4"><h2 className="shrink-0 text-xs font-bold uppercase tracking-[0.2em]">{label}</h2><div className={`h-px flex-1 border-t ${palette.rule}`} /></div>
}

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
}

/** A short standalone line with letters and no lowercase, like "SNAP DOGG: THE PROBLEM GOES DEEPER". */
function isSubheading(line: string): boolean {
  return line.length <= 120 && /[A-Z]/.test(line) && !/[a-z]/.test(line) && !/[.!?,]$/.test(line)
}

function formatPrice(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {style: 'currency', currency: currency || 'USD'}).format(Number(amount) / 100)
}
