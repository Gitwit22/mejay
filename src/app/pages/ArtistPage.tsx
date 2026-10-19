import {useEffect, useState, type CSSProperties, type ReactNode} from 'react'
import {useQuery} from '@tanstack/react-query'
import {ArrowLeft, BadgeCheck, ExternalLink, Mail, MapPin, Pause, Play, ShoppingBag} from 'lucide-react'
import {Link, useParams} from 'react-router-dom'

import {Cover, ProductCard, PurchaseButton, StoreError, StoreLoading} from '@/app/pages/MusicStorePage'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogTitle} from '@/components/ui/dialog'
import {usePreview} from '@/hooks/useStorePreview'
import {getPublicArtist, storeAssetUrl, type PublicArtist, type StoreRelease} from '@/lib/musicStoreApi'
import {accentForeground, artistAccent} from '@/lib/artistTheme'
import {useResolvedAuthStatus} from '@/hooks/useResolvedAuthStatus'

const linkLabels: Record<string, string> = {
  website: 'Website', instagram: 'Instagram', tiktok: 'TikTok', youtube: 'YouTube', facebook: 'Facebook', x: 'X',
  spotify: 'Spotify', appleMusic: 'Apple Music', soundcloud: 'SoundCloud', bandcamp: 'Bandcamp', tidal: 'TIDAL',
  amazonMusic: 'Amazon Music', deezer: 'Deezer',
}

function formatPrice(amount: number, currency: string) {
  return new Intl.NumberFormat('en-US', {style: 'currency', currency: currency || 'USD'}).format(Number(amount) / 100)
}

function formatDate(value: string | null) {
  if (!value) return null
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value)
  return Number.isNaN(date.getTime()) ? null : new Intl.DateTimeFormat('en-US', {year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'}).format(date)
}

function releaseTypeLabel(type: StoreRelease['release_type']) {
  return type === 'ep' ? 'EP' : type.charAt(0).toUpperCase() + type.slice(1)
}

/** Social and DSP links, including links derived from stored DSP artist IDs. */
function artistLinks(artist: PublicArtist): Array<[string, string]> {
  const links: Record<string, string> = {...artist.links}
  if (!links.spotify && artist.spotify_artist_id) links.spotify = `https://open.spotify.com/artist/${artist.spotify_artist_id}`
  if (!links.appleMusic && artist.apple_music_artist_id) links.appleMusic = `https://music.apple.com/artist/${artist.apple_music_artist_id}`
  return Object.entries(links).filter(([key, url]) => key in linkLabels && url.startsWith('https://'))
}

function bookingLink(artist: PublicArtist): string | null {
  const value = artist.links?.booking
  return value && (value.startsWith('https://') || value.startsWith('mailto:')) ? value : null
}

/** Default backdrop: a stylised Detroit skyline (Renaissance Center and downtown towers) lit in the accent colour. */
function DetroitSkyline() {
  const towers: Array<[number, number, number]> = [
    [0, 90, 150], [80, 70, 210], [150, 110, 170], [255, 60, 260], [310, 90, 190], [395, 75, 300], [465, 120, 230],
    [870, 95, 250], [960, 70, 330], [1025, 110, 210], [1130, 80, 280], [1205, 100, 180], [1300, 70, 240], [1365, 90, 160],
  ]
  return <svg data-testid="default-skyline" aria-hidden="true" className="absolute inset-0 h-full w-full" viewBox="0 0 1440 520" preserveAspectRatio="xMidYMax slice">
    <defs>
      <linearGradient id="artist-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#05060a" />
        <stop offset="65%" stopColor="#11131c" />
        <stop offset="100%" style={{stopColor: 'var(--artist-accent)', stopOpacity: 0.35}} />
      </linearGradient>
      <pattern id="artist-windows" width="14" height="18" patternUnits="userSpaceOnUse">
        <rect x="4" y="5" width="4" height="6" style={{fill: 'var(--artist-accent)', opacity: 0.55}} />
      </pattern>
    </defs>
    <rect width="1440" height="520" fill="url(#artist-sky)" />
    <g fill="#0b0d14">
      {towers.map(([x, width, height]) => <rect key={x} x={x} y={520 - height} width={width} height={height} />)}
      {/* Renaissance Center: a tall central cylinder ringed by four shorter towers. */}
      <rect x="560" y="210" width="64" height="310" rx="30" />
      <rect x="806" y="210" width="64" height="310" rx="30" />
      <rect x="630" y="150" width="70" height="370" rx="32" />
      <rect x="730" y="150" width="70" height="370" rx="32" />
      <rect x="672" y="60" width="96" height="460" rx="46" />
    </g>
    <g fill="url(#artist-windows)">
      {towers.map(([x, width, height]) => <rect key={x} x={x + 8} y={530 - height} width={width - 16} height={height - 30} />)}
      <rect x="684" y="80" width="72" height="420" rx="34" />
    </g>
  </svg>
}

/** The bar above every artist page that leads back into MeJay. */
export function ArtistPageTopBar({to, label = 'Back to MeJay', children}: {to: string; label?: string; children?: ReactNode}) {
  return <div className="sticky top-0 z-40 border-b border-white/10 bg-[#0a0a0b]/85 backdrop-blur">
    <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-8">
      <Button asChild size="sm" variant="ghost" className="gap-2 text-zinc-200"><Link to={to}><ArrowLeft className="h-4 w-4" />{label}</Link></Button>
      {children}
    </div>
  </div>
}

/** Public artist page at /artist/:slug. Visibility is decided by the API; releases come from the marketplace catalog. */
export default function ArtistPage() {
  const {slug = ''} = useParams()
  const authStatus = useResolvedAuthStatus()
  const page = useQuery({queryKey: ['artist-page', slug], queryFn: () => getPublicArtist(slug), enabled: Boolean(slug), retry: false})
  useEffect(() => {
    if (page.data) document.title = `${page.data.artist.name} | MeJay`
  }, [page.data])

  if (page.isLoading) return <StoreLoading />
  if (page.isError || !page.data) return <StoreError message="This artist page is not available." />
  // Signed-out visitors usually arrive from an artist's link in bio: the page stands alone for them,
  // with no way off to MeJay. Signed-in MeJay users get a way back into the app.
  return <ArtistPageView artist={page.data.artist} releases={page.data.releases} imageUrl={storeAssetUrl}
    topBar={authStatus === 'authenticated' ? <ArtistPageTopBar to="/app" /> : undefined} />
}

/** The artist page itself, shared by the public page and the owner's preview. */
export function ArtistPageView({artist, releases, imageUrl, topBar}: {
  artist: PublicArtist
  releases: StoreRelease[]
  /** Builds the URL of one of the artist's profile images; the preview serves them to the owner only. */
  imageUrl: (assetId: string | null | undefined) => string | null
  topBar?: ReactNode
}) {
  const preview = usePreview()
  const [openImage, setOpenImage] = useState<{src: string; caption: string | null} | null>(null)
  const accent = artistAccent(artist.accent_color)
  const accentText = accentForeground(accent)
  const background = imageUrl(artist.banner_asset_id)
  const cutout = imageUrl(artist.cutout_asset_id)
  const photo = imageUrl(artist.profile_photo_asset_id)
  const storyPhoto = imageUrl(artist.story_photo_asset_id) ?? photo
  const featured = releases.find((release) => release.id === artist.featured_release_id) ?? releases[0]
  const catalog = releases.filter((release) => release.id !== featured?.id)
  const links = artistLinks(artist)
  const booking = bookingLink(artist)
  const gallery = artist.gallery ?? []
  const playing = featured ? preview.playingId === featured.id : false
  const style = {'--artist-accent': accent, '--artist-accent-foreground': accentText} as CSSProperties

  return <div className="min-h-screen bg-[#0a0a0b] text-zinc-100" style={style}>
    {topBar}
    <header className="relative isolate">
      <div className="absolute inset-0 -z-10 overflow-hidden">
        {background ? <img src={background} alt="" className="h-full w-full object-cover" /> : <DetroitSkyline />}
        {/* City lighting in the artist's colour, then a fade into the page. */}
        <div className="absolute inset-0" style={{background: `radial-gradient(ellipse 80% 60% at 65% 95%, ${accent}55, transparent 70%)`}} />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0b] via-[#0a0a0b]/55 to-[#0a0a0b]/20" />
        <div className="absolute inset-0 hidden bg-gradient-to-r from-[#0a0a0b]/85 via-[#0a0a0b]/30 to-transparent sm:block" />
      </div>

      <div className="mx-auto flex max-w-7xl flex-col px-4 pt-10 sm:grid sm:min-h-[680px] sm:grid-cols-[1.1fr_0.9fr] sm:items-end sm:gap-6 sm:px-8 sm:pt-16">
        {/* Mobile shows the artist first so their face stays visible above the headline. */}
        <div className="order-first flex justify-center sm:order-last sm:justify-end">
          {cutout
            ? <img src={cutout} alt={artist.name} className="relative z-10 -mb-10 h-[340px] w-auto max-w-full object-contain object-bottom sm:-mb-16 sm:h-[640px]" style={{filter: `drop-shadow(0 0 40px ${accent}66)`}} />
            : <div className="mb-6 h-40 w-40 overflow-hidden rounded-full border-4 sm:mb-16 sm:h-64 sm:w-64" style={{borderColor: accent}}>
              {photo ? <img src={photo} alt={artist.name} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center bg-zinc-900 text-6xl font-black" style={{color: accent}}>{artist.name.charAt(0).toUpperCase()}</div>}
            </div>}
        </div>
        <div className="relative z-20 pb-10 pt-14 sm:pb-16 sm:pt-0">
          <p className="text-xs font-semibold uppercase tracking-[0.3em]" style={{color: accent}}>MeJay Artist</p>
          <h1 className="mt-3 flex flex-wrap items-center gap-3 text-5xl font-black uppercase leading-[0.9] tracking-tight sm:text-7xl lg:text-8xl">
            {artist.name}{artist.verified && <BadgeCheck className="h-8 w-8 shrink-0" style={{color: accent}} aria-label="Verified MeJay artist" />}
          </h1>
          {artist.tagline && <p className="mt-4 max-w-xl text-lg text-zinc-200 sm:text-xl">{artist.tagline}</p>}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-zinc-300">
            {artist.location && <span className="mr-2 inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{artist.location}</span>}
            {artist.genres.map((genre) => <span key={genre} className="rounded-full border px-3 py-1 text-xs uppercase tracking-wider" style={{borderColor: `${accent}99`}}>{genre}</span>)}
          </div>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" className="gap-2 font-bold hover:opacity-90" style={{backgroundColor: accent, color: accentText}} disabled={!featured?.preview_asset_id} onClick={() => featured && preview.toggle(featured.id, featured.preview_asset_id)}>
              {playing ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}{playing ? 'Pause' : 'Play Latest'}
            </Button>
            {featured && <Button size="lg" variant="outline" className="gap-2 border-white/40 bg-black/30 font-bold" onClick={() => document.getElementById('featured-release')?.scrollIntoView({behavior: 'smooth'})}>
              <ShoppingBag className="h-5 w-5" />Buy Music
            </Button>}
          </div>
        </div>
      </div>
    </header>

    <main className="relative mx-auto max-w-7xl space-y-14 px-4 pb-16 pt-14 sm:space-y-20 sm:px-8 sm:pb-20 sm:pt-24">
      {featured && <section id="featured-release" aria-labelledby="featured-heading" className="scroll-mt-8">
        <SectionHeading id="featured-heading" accent={accent} eyebrow="Out now" title="Featured release" />
        <div className="grid gap-8 rounded-2xl border border-white/10 bg-white/[0.03] p-5 sm:grid-cols-[minmax(200px,340px)_1fr] sm:items-center sm:p-8">
          <Link to={`/app/store/${featured.id}`} className="mx-auto block w-full max-w-[240px] sm:max-w-none"><Cover release={featured} className="aspect-square w-full shadow-2xl" /></Link>
          <div className="min-w-0">
            <Link to={`/app/store/${featured.id}`} className="text-2xl font-black hover:underline sm:text-4xl">{featured.title}</Link>
            <p className="mt-2 text-sm text-zinc-400">
              {releaseTypeLabel(featured.release_type)}{featured.genre ? ` · ${featured.genre}` : ''}{formatDate(featured.original_release_date || featured.published_at) ? ` · ${formatDate(featured.original_release_date || featured.published_at)}` : ''}
              {` · ${featured.track_count} ${featured.track_count === 1 ? 'track' : 'tracks'}`}
            </p>
            <p className="mt-4 text-3xl font-bold sm:mt-6">{formatPrice(featured.amount_minor, featured.currency)}</p>
            <div className="mt-5 flex flex-wrap gap-3">
              <Button variant="outline" className="gap-2" disabled={!featured.preview_asset_id} onClick={() => preview.toggle(featured.id, featured.preview_asset_id)}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{playing ? 'Pause preview' : 'Preview'}</Button>
              <PurchaseButton className="flex-1 sm:w-44 sm:flex-none" available={featured.purchase_available} productId={featured.product_id} />
            </div>
          </div>
        </div>
      </section>}

      {catalog.length > 0 && <section aria-labelledby="catalog-heading">
        <SectionHeading id="catalog-heading" accent={accent} eyebrow="Music" title={`More from ${artist.name}`} />
        <div className="grid grid-cols-2 gap-x-3 gap-y-8 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4">{catalog.map((release) => <ProductCard key={release.id} release={release} preview={preview} featured={false} />)}</div>
      </section>}

      {artist.bio && <section aria-labelledby="story-heading" className="grid gap-10 lg:grid-cols-[minmax(260px,420px)_1fr] lg:items-center">
        {storyPhoto && <img src={storyPhoto} alt={artist.name} className="mx-auto aspect-[4/5] w-full max-w-[280px] rounded-2xl object-cover lg:max-w-none" />}
        <div>
          <SectionHeading id="story-heading" accent={accent} eyebrow="The story" title={`About ${artist.name}`} />
          {artist.highlight_quote && <blockquote className="mb-6 border-l-4 pl-5 text-2xl font-bold italic text-white" style={{borderColor: accent}}>“{artist.highlight_quote}”</blockquote>}
          <p className="whitespace-pre-line leading-7 text-zinc-300">{artist.bio}</p>
        </div>
      </section>}

      {gallery.length > 0 && <section aria-labelledby="gallery-heading">
        <SectionHeading id="gallery-heading" accent={accent} eyebrow="Gallery" title="Photos" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {gallery.map((image) => {
            const src = imageUrl(image.asset_id)
            if (!src) return null
            return <button key={image.asset_id} type="button" className="group overflow-hidden rounded-xl focus-visible:outline focus-visible:outline-2" onClick={() => setOpenImage({src, caption: image.caption})}>
              <img src={src} alt={image.caption ?? `${artist.name} photo`} loading="lazy" className="aspect-square w-full object-cover transition duration-300 group-hover:scale-105" />
            </button>
          })}
        </div>
      </section>}

      {(links.length > 0 || booking) && <section aria-labelledby="connect-heading" className="rounded-2xl border border-white/10 p-5 sm:p-10" style={{background: `linear-gradient(135deg, ${accent}22, transparent 60%)`}}>
        <SectionHeading id="connect-heading" accent={accent} eyebrow="Stay connected" title={`Follow ${artist.name}`} />
        <div className="flex flex-wrap gap-2">
          {links.map(([key, url]) => <Button key={key} asChild variant="outline" size="sm" className="gap-2"><a href={url} target="_blank" rel="noopener noreferrer nofollow">{linkLabels[key]}<ExternalLink className="h-3.5 w-3.5" /></a></Button>)}
          {booking && <Button asChild size="sm" className="gap-2 font-bold" style={{backgroundColor: accent, color: accentText}}>
            <a href={booking} {...(booking.startsWith('https://') ? {target: '_blank', rel: 'noopener noreferrer nofollow'} : {})}><Mail className="h-3.5 w-3.5" />Booking &amp; contact</a>
          </Button>}
        </div>
      </section>}
    </main>

    <Dialog open={openImage !== null} onOpenChange={(open) => !open && setOpenImage(null)}>
      <DialogContent className="max-w-4xl border-white/10 bg-[#0a0a0b] p-2">
        <DialogTitle className="sr-only">{openImage?.caption ?? `${artist.name} photo`}</DialogTitle>
        {openImage && <figure>
          <img src={openImage.src} alt={openImage.caption ?? `${artist.name} photo`} className="max-h-[80vh] w-full rounded-lg object-contain" />
          {openImage.caption && <figcaption className="p-3 text-sm text-zinc-300">{openImage.caption}</figcaption>}
        </figure>}
      </DialogContent>
    </Dialog>
  </div>
}

function SectionHeading({id, accent, eyebrow, title}: {id: string; accent: string; eyebrow: string; title: string}) {
  return <div className="mb-6">
    <p className="text-xs font-semibold uppercase tracking-[0.3em]" style={{color: accent}}>{eyebrow}</p>
    <h2 id={id} className="mt-2 text-3xl font-black sm:text-4xl">{title}</h2>
  </div>
}
