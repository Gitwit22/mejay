import {useMutation, useQuery} from '@tanstack/react-query'
import {ArrowLeft, Disc3, Pause, Play} from 'lucide-react'
import {Link, useParams} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Skeleton} from '@/components/ui/skeleton'
import {toast} from '@/hooks/use-toast'
import {getStoreRelease, storeAssetUrl, type StoreRelease, type StoreTrack} from '@/lib/musicStoreApi'
import {startStoreCheckout} from '@/lib/marketplaceCommerceApi'
import {usePlanStore} from '@/stores/planStore'
import {usePreview, type PreviewController} from '@/hooks/useStorePreview'


export function StoreReleasePage() {
  const {releaseId = ''} = useParams()
  const detail = useQuery({queryKey: ['music-store', 'release', releaseId], queryFn: () => getStoreRelease(releaseId), enabled: Boolean(releaseId)})
  const preview = usePreview()
  if (detail.isLoading) return <StoreLoading />
  if (detail.isError || !detail.data) return <StoreError message={detail.error?.message || 'Release not found'} />
  const {release, tracks} = detail.data
  return <div className="min-h-screen bg-[#0a0a0b] text-zinc-100"><main className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-10"><Button asChild variant="ghost" className="mb-7 gap-2"><Link to="/app?tab=music"><ArrowLeft className="h-4 w-4" />Back to Discover</Link></Button>
    <div className="grid gap-8 md:grid-cols-[minmax(240px,380px)_1fr] md:gap-12"><Cover release={release} className="aspect-square w-full" /><div className="min-w-0 md:pt-4"><p className="text-sm font-semibold uppercase text-emerald-400">{release.artist_slug ? <Link to={`/artist/${release.artist_slug}`} className="hover:underline">{release.artist_name}</Link> : release.artist_name}</p><h1 className="mt-2 text-4xl font-black sm:text-5xl">{release.title}</h1>{release.version_title && <p className="mt-2 text-lg text-zinc-400">{release.version_title}</p>}<div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm text-zinc-400"><span>{releaseTypeLabel(release.release_type)}</span><span>{release.genre || 'Uncategorized'}</span><span>{formatDate(release.original_release_date || release.published_at)}</span>{release.label_name && <span>{release.label_name}</span>}</div><p className="mt-8 text-3xl font-bold">{formatPrice(release.amount_minor, release.currency)}</p><PurchaseButton className="mt-5 h-12 w-full sm:w-56" available={release.purchase_available} productId={release.product_id} /></div></div>
    <section className="mt-12"><SectionTitle title="Track List" /><div className="divide-y divide-white/10 border-y border-white/10">{tracks.map((track) => <TrackRow key={track.id} track={track} purchaseAvailable={release.purchase_available} preview={preview} />)}</div></section>
  </main></div>
}

export function ProductCard({release, preview, featured}: {release: StoreRelease; preview: PreviewController; featured: boolean}) {
  const playing = preview.playingId === release.id
  return <article className="group min-w-0"><Link to={`/app/store/${release.id}`}><Cover release={release} className="aspect-square w-full transition duration-300 group-hover:brightness-110" /></Link><div className="pt-4"><Link to={`/app/store/${release.id}`} className={`block truncate font-bold hover:text-emerald-400 ${featured ? 'text-lg' : ''}`}>{release.title}</Link><p className="mt-1 truncate text-sm text-zinc-400">{release.artist_slug ? <Link to={`/artist/${release.artist_slug}`} className="hover:text-emerald-400 hover:underline">{release.artist_name}</Link> : release.artist_name}</p><p className="mt-1 text-xs text-zinc-600">{releaseTypeLabel(release.release_type)} · {release.genre || 'Uncategorized'}</p><div className="mt-4 flex items-center justify-between gap-2"><Button size="sm" variant="ghost" className="h-8 gap-1.5 px-2 text-zinc-300" disabled={!release.preview_asset_id} onClick={() => preview.toggle(release.id, release.preview_asset_id)}>{playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}Preview</Button><span className="font-semibold">{formatPrice(release.amount_minor, release.currency)}</span></div><PurchaseButton className="mt-2 w-full" label="Buy" available={release.purchase_available} productId={release.product_id} /></div></article>
}

export function Cover({release, className}: {release: Pick<StoreRelease, 'artwork_asset_id' | 'title'>; className?: string}) {
  const url = storeAssetUrl(release.artwork_asset_id)
  return <div className={`overflow-hidden rounded-md bg-[#19191c] ${className || ''}`}>{url ? <img src={url} alt={`${release.title} cover`} className="h-full w-full object-cover" loading="lazy" /> : <div className="grid h-full place-items-center"><Disc3 className="h-16 w-16 text-zinc-700" /></div>}</div>
}

function TrackRow({track, preview, purchaseAvailable}: {track: StoreTrack; preview: PreviewController; purchaseAvailable: boolean}) {
  const playing = preview.playingId === track.id
  return <div className="grid grid-cols-[2rem_1fr_auto_auto] items-center gap-3 py-4 sm:grid-cols-[2rem_1fr_auto_auto_auto]"><span className="text-sm text-zinc-600">{track.track_number}</span><div className="min-w-0"><p className="truncate font-medium">{track.title}{track.version_title ? ` (${track.version_title})` : ''}</p>{track.explicit && <span className="text-[10px] uppercase text-zinc-500">Explicit</span>}</div><span className="text-xs text-zinc-500">{formatDuration(track.duration_ms)}</span><Button size="icon" variant="ghost" aria-label={`${playing ? 'Pause' : 'Play'} ${track.title}`} disabled={!track.preview_asset_id} onClick={() => preview.toggle(track.id, track.preview_asset_id)}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button>{track.product_id && track.amount_minor != null ? <div className="col-span-4 flex items-center justify-end gap-3 sm:col-span-1"><span className="text-sm font-semibold tabular-nums">{formatPrice(track.amount_minor, track.currency ?? 'USD')}</span><PurchaseButton className="h-8" label="Buy song" available={purchaseAvailable} productId={track.product_id} /></div> : <span className="hidden sm:block" />}</div>
}

export function PurchaseButton({className, label = 'Purchase', available, productId}: {className?: string; label?: string; available: boolean; productId: string}) {
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

export function SectionTitle({title}: {title: string}) { return <div className="mb-5 flex items-center gap-4"><h2 className="shrink-0 text-xl font-black">{title}</h2><div className="h-px flex-1 bg-white/10" /></div> }
export function StoreLoading() { return <div className="min-h-screen bg-[#0a0a0b] p-8"><div className="mx-auto max-w-7xl space-y-8"><Skeleton className="h-12 w-80 bg-white/5" /><div className="grid grid-cols-2 gap-4 sm:grid-cols-4"><Skeleton className="aspect-square bg-white/5" /><Skeleton className="aspect-square bg-white/5" /><Skeleton className="aspect-square bg-white/5" /><Skeleton className="aspect-square bg-white/5" /></div></div></div> }
export function StoreError({message}: {message: string}) { return <div className="grid min-h-screen place-items-center bg-[#0a0a0b] px-6 text-center text-red-300"><div><p className="font-semibold">Music unavailable</p><p className="mt-2 text-sm text-red-300/70">{message}</p></div></div> }
function releaseTypeLabel(type: StoreRelease['release_type']) { return type === 'ep' ? 'EP' : type.charAt(0).toUpperCase() + type.slice(1) }
function formatPrice(amount: number, currency: string) { return new Intl.NumberFormat('en-US', {style: 'currency', currency: currency || 'USD'}).format(Number(amount) / 100) }
function formatDate(value: string | null) { return value ? new Intl.DateTimeFormat('en-US', {year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'}).format(new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00Z` : value)) : 'Release date pending' }
function formatDuration(duration: number | null) { if (!duration) return '--:--'; const seconds = Math.floor(duration / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` }