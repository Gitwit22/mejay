import {useEffect} from 'react'
import {useQuery} from '@tanstack/react-query'
import {BadgeCheck, ExternalLink, MapPin, Pause, Play} from 'lucide-react'
import {Link, useParams} from 'react-router-dom'

import {Cover, ProductCard, PurchaseButton, SectionTitle, StoreError, StoreLoading} from '@/app/pages/MusicStorePage'
import {Button} from '@/components/ui/button'
import {usePreview} from '@/hooks/useStorePreview'
import {getPublicArtist, storeAssetUrl, type PublicArtist, type StoreRelease} from '@/lib/musicStoreApi'
import {usePlanStore} from '@/stores/planStore'

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

/** Social and DSP links, including links derived from stored DSP artist IDs. */
function artistLinks(artist: PublicArtist): Array<[string, string]> {
  const links: Record<string, string> = {...artist.links}
  if (!links.spotify && artist.spotify_artist_id) links.spotify = `https://open.spotify.com/artist/${artist.spotify_artist_id}`
  if (!links.appleMusic && artist.apple_music_artist_id) links.appleMusic = `https://music.apple.com/artist/${artist.apple_music_artist_id}`
  return Object.entries(links).filter(([key, url]) => key in linkLabels && url.startsWith('https://'))
}

/** Public artist page at /artist/:slug. Only artists with LIVE music resolve; releases come from the marketplace catalog. */
export default function ArtistPage() {
  const {slug = ''} = useParams()
  const authStatus = usePlanStore((state) => state.authStatus)
  // This page lives outside the app shell; resolve the session so Buy goes straight to checkout.
  useEffect(() => {
    if (authStatus === 'unknown') void usePlanStore.getState().refreshFromServer({reason: 'appEntry'}).catch(() => undefined)
  }, [authStatus])
  const page = useQuery({queryKey: ['artist-page', slug], queryFn: () => getPublicArtist(slug), enabled: Boolean(slug), retry: false})
  const preview = usePreview()
  useEffect(() => {
    if (page.data) document.title = `${page.data.artist.name} | MeJay`
  }, [page.data])

  if (page.isLoading) return <StoreLoading />
  if (page.isError || !page.data) return <StoreError message="This artist page is not available." />
  const {artist, releases} = page.data
  const banner = storeAssetUrl(artist.banner_asset_id)
  const photo = storeAssetUrl(artist.profile_photo_asset_id)
  const [latest, ...more] = releases
  const links = artistLinks(artist)

  return <div className="min-h-screen bg-[#0a0a0b] text-zinc-100">
    <header className="relative">
      <div className="h-44 w-full overflow-hidden bg-gradient-to-br from-emerald-500/30 via-zinc-900 to-zinc-950 sm:h-72">
        {banner && <img src={banner} alt="" className="h-full w-full object-cover" />}
        <div className="absolute inset-0 bg-gradient-to-t from-[#0a0a0b] via-[#0a0a0b]/40 to-transparent" />
      </div>
      <div className="relative mx-auto -mt-20 flex max-w-6xl flex-col gap-5 px-4 sm:-mt-24 sm:flex-row sm:items-end sm:px-8">
        <div className="h-32 w-32 shrink-0 overflow-hidden rounded-full border-4 border-[#0a0a0b] bg-zinc-800 sm:h-44 sm:w-44">
          {photo ? <img src={photo} alt={artist.name} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-5xl font-black text-emerald-300">{artist.name.charAt(0).toUpperCase()}</div>}
        </div>
        <div className="min-w-0 pb-2">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-400">Artist</p>
          <h1 className="mt-1 flex flex-wrap items-center gap-3 text-4xl font-black sm:text-6xl">{artist.name}{artist.verified && <BadgeCheck className="h-7 w-7 text-emerald-400" aria-label="Verified MeJay artist" />}</h1>
          {artist.tagline && <p className="mt-2 text-lg text-zinc-300">{artist.tagline}</p>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-zinc-400">
            {artist.location && <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{artist.location}</span>}
            {artist.genres.length > 0 && <span>{artist.genres.join(' · ')}</span>}
          </div>
        </div>
      </div>
    </header>

    <main className="mx-auto max-w-6xl space-y-14 px-4 py-10 sm:px-8">
      {links.length > 0 && <nav aria-label="Artist links" className="flex flex-wrap gap-2">{links.map(([key, url]) => <Button key={key} asChild variant="outline" size="sm" className="gap-2"><a href={url} target="_blank" rel="noopener noreferrer nofollow">{linkLabels[key]}<ExternalLink className="h-3.5 w-3.5" /></a></Button>)}</nav>}

      {latest && <LatestRelease release={latest} preview={preview} />}

      {more.length > 0 && <section><SectionTitle title={`More from ${artist.name}`} /><div className="grid gap-x-4 gap-y-8 min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">{more.map((release) => <ProductCard key={release.id} release={release} preview={preview} featured={false} />)}</div></section>}

      {artist.bio && <section className="max-w-3xl"><SectionTitle title="Biography" /><p className="whitespace-pre-line leading-7 text-zinc-300">{artist.bio}</p></section>}
    </main>
  </div>
}

function LatestRelease({release, preview}: {release: StoreRelease; preview: ReturnType<typeof usePreview>}) {
  const playing = preview.playingId === release.id
  const date = formatDate(release.original_release_date || release.published_at)
  return <section><SectionTitle title="Latest release" />
    <div className="grid gap-6 sm:grid-cols-[minmax(180px,280px)_1fr] sm:items-center">
      <Link to={`/app/store/${release.id}`}><Cover release={release} className="aspect-square w-full" /></Link>
      <div className="min-w-0">
        <Link to={`/app/store/${release.id}`} className="text-3xl font-black hover:text-emerald-400">{release.title}</Link>
        <p className="mt-2 text-sm text-zinc-400">{release.release_type === 'ep' ? 'EP' : release.release_type.charAt(0).toUpperCase() + release.release_type.slice(1)}{release.genre ? ` · ${release.genre}` : ''}{date ? ` · ${date}` : ''}</p>
        <p className="mt-5 text-2xl font-bold">{formatPrice(release.amount_minor, release.currency)}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button variant="outline" className="gap-2" disabled={!release.preview_asset_id} onClick={() => preview.toggle(release.id, release.preview_asset_id)}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}{playing ? 'Pause' : 'Preview'}</Button>
          <PurchaseButton className="w-40" available={release.purchase_available} productId={release.product_id} />
        </div>
      </div>
    </div>
  </section>
}
