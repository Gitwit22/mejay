import {useEffect, useMemo, useRef, useState} from 'react'
import {useMutation, useQuery} from '@tanstack/react-query'
import {ArrowLeft, Disc3, Pause, Play, Search, ShoppingBag} from 'lucide-react'
import {Link, useParams, useSearchParams} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Skeleton} from '@/components/ui/skeleton'
import {toast} from '@/hooks/use-toast'
import {getStoreRelease, listStoreReleases, recordStorePreview, storeAssetUrl, type StoreRelease, type StoreTrack} from '@/lib/musicStoreApi'
import {startStoreCheckout} from '@/lib/marketplaceCommerceApi'
import {usePlanStore} from '@/stores/planStore'

type PreviewController = {
  playingId: string | null
  toggle: (trackId: string, assetId: string | null) => void
}

function usePreview(): PreviewController {
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

export default function MusicStorePage() {
  const catalog = useQuery({queryKey: ['music-store', 'catalog'], queryFn: listStoreReleases})
  const preview = usePreview()
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [genre, setGenre] = useState<string | null>(null)
  const releases = useMemo(() => catalog.data ?? [], [catalog.data])
  const artistId = searchParams.get('artist')
  const selectedArtist = artistId ? releases.find((release) => release.artist_id === artistId)?.artist_name : null
  const genres = useMemo(() => [...new Set(releases.map((release) => release.genre).filter((value): value is string => Boolean(value)))].sort(), [releases])
  const filtered = releases.filter((release) => {
    const terms = `${release.title} ${release.artist_name} ${release.genre || ''}`.toLowerCase()
    return terms.includes(search.trim().toLowerCase()) && (!genre || release.genre === genre) && (!artistId || release.artist_id === artistId)
  })

  if (catalog.isLoading) return <StoreLoading />
  if (catalog.isError) return <StoreError message={catalog.error.message} />

  return <div className="min-h-screen bg-[#0a0a0b] text-zinc-100">
    <header className="border-b border-white/10 bg-[#0a0a0b]/95 px-4 py-5 sm:px-8"><div className="mx-auto flex max-w-7xl items-center gap-3"><Button asChild variant="ghost" size="icon" className="shrink-0"><Link to="/app" aria-label="Back to MEJay"><ArrowLeft className="h-4 w-4" /></Link></Button><div className="min-w-0"><p className="text-base font-black tracking-[0.1em] sm:text-xl sm:tracking-[0.12em]">MUSIC MARKETPLACE</p><p className="mt-1 truncate text-xs text-zinc-500">Independent releases, direct from artists</p></div><Button asChild variant="outline" size="icon" className="ml-auto shrink-0 sm:h-10 sm:w-auto sm:gap-2 sm:px-4"><Link to="/app/purchased" aria-label="Purchases"><ShoppingBag className="h-4 w-4" /><span className="hidden sm:inline">Purchases</span></Link></Button></div></header>
    <main className="mx-auto max-w-7xl space-y-12 px-4 py-8 sm:px-8">
      <div className="relative max-w-2xl"><Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-12 border-white/10 bg-[#151517] pl-12 text-base" placeholder="Search releases, artists, and genres" /></div>
      {artistId && <div className="flex items-center gap-3 text-sm"><span className="text-zinc-500">Artist:</span><Button size="sm" variant="outline" onClick={() => {const next = new URLSearchParams(searchParams); next.delete('artist'); setSearchParams(next)}}>{selectedArtist || 'Selected artist'} x</Button></div>}
      {genre && <div className="flex items-center gap-3 text-sm"><span className="text-zinc-500">Genre:</span><Button size="sm" variant="outline" onClick={() => setGenre(null)}>{genre} x</Button></div>}
      {releases.length === 0 ? <EmptyCatalog /> : search || genre || artistId ? <ReleaseSection title="Search Results" releases={filtered} preview={preview} /> : <>
        <ReleaseSection title="New Releases" releases={releases.slice(0, 8)} preview={preview} />
        <ReleaseSection title="Singles" releases={releases.filter((release) => release.release_type === 'single').slice(0, 8)} preview={preview} />
        <ReleaseSection title="Projects" releases={releases.filter((release) => release.release_type !== 'single').slice(0, 8)} preview={preview} />
        <section><SectionTitle title="Genres" /><div className="flex flex-wrap gap-2">{genres.map((item) => <Button key={item} variant="outline" onClick={() => setGenre(item)} className="border-white/10 bg-[#131315] hover:border-emerald-400/50">{item}</Button>)}</div></section>
      </>}
    </main>
  </div>
}

export function StoreReleasePage() {
  const {releaseId = ''} = useParams()
  const detail = useQuery({queryKey: ['music-store', 'release', releaseId], queryFn: () => getStoreRelease(releaseId), enabled: Boolean(releaseId)})
  const preview = usePreview()
  if (detail.isLoading) return <StoreLoading />
  if (detail.isError || !detail.data) return <StoreError message={detail.error?.message || 'Release not found'} />
  const {release, tracks} = detail.data
  return <div className="min-h-screen bg-[#0a0a0b] text-zinc-100"><main className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10"><Button asChild variant="ghost" className="mb-7 gap-2"><Link to="/app/store"><ArrowLeft className="h-4 w-4" />Back to Marketplace</Link></Button>
    <div className="grid gap-8 md:grid-cols-[minmax(240px,380px)_1fr] md:gap-12"><Cover release={release} className="aspect-square w-full" /><div className="min-w-0 md:pt-4"><p className="text-sm font-semibold uppercase text-emerald-400">{release.artist_name}</p><h1 className="mt-2 text-4xl font-black sm:text-5xl">{release.title}</h1>{release.version_title && <p className="mt-2 text-lg text-zinc-400">{release.version_title}</p>}<div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-400"><span>{releaseTypeLabel(release.release_type)}</span><span>{release.genre || 'Uncategorized'}</span><span>{formatDate(release.original_release_date || release.published_at)}</span>{release.label_name && <span>{release.label_name}</span>}</div><p className="mt-8 text-3xl font-bold">{formatPrice(release.amount_minor, release.currency)}</p><PurchaseButton className="mt-5 h-12 w-full sm:w-56" available={release.purchase_available} productId={release.product_id} /></div></div>
    <section className="mt-12"><SectionTitle title="Track List" /><div className="divide-y divide-white/10 border-y border-white/10">{tracks.map((track) => <TrackRow key={track.id} track={track} preview={preview} />)}</div></section>
  </main></div>
}

function ReleaseSection({title, releases, preview, featured = false}: {title: string; releases: StoreRelease[]; preview: PreviewController; featured?: boolean}) {
  if (releases.length === 0) return null
  return <section><SectionTitle title={title} /><div className={`grid gap-x-4 gap-y-8 ${featured ? 'sm:grid-cols-2 lg:grid-cols-4' : 'min-[420px]:grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'}`}>{releases.map((release) => <ProductCard key={release.id} release={release} preview={preview} featured={featured} />)}</div></section>
}

function ProductCard({release, preview, featured}: {release: StoreRelease; preview: PreviewController; featured: boolean}) {
  const playing = preview.playingId === release.id
  return <article className="group min-w-0"><Link to={`/app/store/${release.id}`}><Cover release={release} className="aspect-square w-full transition duration-300 group-hover:brightness-110" /></Link><div className="pt-4"><Link to={`/app/store/${release.id}`} className={`block truncate font-bold hover:text-emerald-400 ${featured ? 'text-lg' : ''}`}>{release.title}</Link><p className="mt-1 truncate text-sm text-zinc-400">{release.artist_name}</p><p className="mt-1 text-xs text-zinc-600">{releaseTypeLabel(release.release_type)} · {release.genre || 'Uncategorized'}</p><div className="mt-4 flex items-center justify-between gap-2"><Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2 text-zinc-300" disabled={!release.preview_asset_id} onClick={() => preview.toggle(release.id, release.preview_asset_id)}>{playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}Preview</Button><span className="font-semibold">{formatPrice(release.amount_minor, release.currency)}</span></div><PurchaseButton className="mt-2 w-full" label="Buy" available={release.purchase_available} productId={release.product_id} /></div></article>
}

function Cover({release, className}: {release: Pick<StoreRelease, 'artwork_asset_id' | 'title'>; className?: string}) {
  const url = storeAssetUrl(release.artwork_asset_id)
  return <div className={`overflow-hidden rounded-md bg-[#19191c] ${className || ''}`}>{url ? <img src={url} alt={`${release.title} cover`} className="h-full w-full object-cover" loading="lazy" /> : <div className="grid h-full place-items-center"><Disc3 className="h-16 w-16 text-zinc-700" /></div>}</div>
}

function TrackRow({track, preview}: {track: StoreTrack; preview: PreviewController}) {
  const playing = preview.playingId === track.id
  return <div className="grid grid-cols-[2rem_1fr_auto_auto] items-center gap-3 py-4"><span className="text-sm text-zinc-600">{track.track_number}</span><div className="min-w-0"><p className="truncate font-medium">{track.title}{track.version_title ? ` (${track.version_title})` : ''}</p>{track.explicit && <span className="text-[10px] uppercase text-zinc-500">Explicit</span>}</div><span className="text-xs text-zinc-500">{formatDuration(track.duration_ms)}</span><Button size="icon" variant="ghost" aria-label={`${playing ? 'Pause' : 'Play'} ${track.title}`} disabled={!track.preview_asset_id} onClick={() => preview.toggle(track.id, track.preview_asset_id)}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button></div>
}

function PurchaseButton({className, label = 'Purchase', available, productId}: {className?: string; label?: string; available: boolean; productId: string}) {
  const authStatus = usePlanStore((state) => state.authStatus)
  const mutation = useMutation({
    mutationFn: () => startStoreCheckout(productId),
    onError: (error) => toast({title: 'Checkout unavailable', description: error.message, variant: 'destructive'}),
  })
  const purchase = () => {
    if (authStatus !== 'authenticated') {
      const returnTo = `${window.location.pathname}${window.location.search}`
      window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`)
      return
    }
    mutation.mutate()
  }
  return <Button disabled={!available || mutation.isPending} title={available ? undefined : 'This provider is completing payout setup'} className={`bg-emerald-400 font-bold text-zinc-950 hover:bg-emerald-300 ${className || ''}`} onClick={purchase}>{available ? mutation.isPending ? 'Opening Stripe...' : label : 'Payout setup pending'}</Button>
}

function SectionTitle({title}: {title: string}) { return <div className="mb-5 flex items-center gap-4"><h2 className="shrink-0 text-xl font-black">{title}</h2><div className="h-px flex-1 bg-white/10" /></div> }
function EmptyCatalog() { return <div className="grid min-h-80 place-items-center border-y border-dashed border-white/10 text-center"><div><Disc3 className="mx-auto h-10 w-10 text-zinc-700" /><h2 className="mt-4 text-lg font-bold">The catalog is quiet</h2><p className="mt-1 text-sm text-zinc-500">Published releases will appear here automatically.</p></div></div> }
function StoreLoading() { return <div className="min-h-screen bg-[#0a0a0b] p-8"><div className="mx-auto max-w-7xl space-y-8"><Skeleton className="h-12 w-80 bg-white/5" /><div className="grid grid-cols-2 gap-4 sm:grid-cols-4"><Skeleton className="aspect-square bg-white/5" /><Skeleton className="aspect-square bg-white/5" /><Skeleton className="aspect-square bg-white/5" /><Skeleton className="aspect-square bg-white/5" /></div></div></div> }
function StoreError({message}: {message: string}) { return <div className="grid min-h-screen place-items-center bg-[#0a0a0b] px-6 text-center text-red-300"><div><p className="font-semibold">Marketplace unavailable</p><p className="mt-2 text-sm text-red-300/70">{message}</p></div></div> }
function releaseTypeLabel(type: StoreRelease['release_type']) { return type === 'ep' ? 'EP' : type.charAt(0).toUpperCase() + type.slice(1) }
function formatPrice(amount: number, currency: string) { return new Intl.NumberFormat('en-US', {style: 'currency', currency: currency || 'USD'}).format(Number(amount) / 100) }
function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat('en-US', {year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'}).format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value)) : 'Release date pending' }
function formatDuration(duration: number | null) { if (!duration) return '--:--'; const seconds = Math.floor(duration / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }