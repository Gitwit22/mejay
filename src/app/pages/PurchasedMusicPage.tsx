import {useEffect} from 'react'
import {useQuery, useQueryClient} from '@tanstack/react-query'
import {ArrowLeft, Disc3, Download, LoaderCircle, RefreshCw} from 'lucide-react'
import {Link, useSearchParams} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Skeleton} from '@/components/ui/skeleton'
import {getStoreOrderStatus, listStorePurchases, purchaseDownloadUrl, type Purchase} from '@/lib/marketplaceCommerceApi'
import {storeAssetUrl} from '@/lib/musicStoreApi'
import {usePlanStore} from '@/stores/planStore'

export default function PurchasedMusicPage() {
  const authStatus = usePlanStore((state) => state.authStatus)
  const [searchParams, setSearchParams] = useSearchParams()
  const queryClient = useQueryClient()
  const sessionId = searchParams.get('checkout') === 'success' ? searchParams.get('session_id') : null
  const status = useQuery({
    queryKey: ['music-store', 'checkout-status', sessionId],
    queryFn: () => getStoreOrderStatus(sessionId!),
    enabled: authStatus === 'authenticated' && Boolean(sessionId),
    refetchInterval: (query) => query.state.data?.order_id ? false : 1500,
    retry: 12,
  })
  const purchases = useQuery({
    queryKey: ['music-store', 'purchases'],
    queryFn: listStorePurchases,
    enabled: authStatus === 'authenticated',
  })

  useEffect(() => {
    if (!status.data?.order_id) return
    void queryClient.invalidateQueries({queryKey: ['music-store', 'purchases']})
    const timeout = window.setTimeout(() => setSearchParams({}, {replace: true}), 2000)
    return () => window.clearTimeout(timeout)
  }, [queryClient, setSearchParams, status.data?.order_id])

  if (authStatus === 'unknown') return <LibraryLoading />
  if (authStatus !== 'authenticated') {
    const returnTo = `/app/purchased${window.location.search}`
    return <main className="grid min-h-screen place-items-center bg-[#0a0a0b] px-5 text-center text-zinc-100"><div><Disc3 className="mx-auto h-12 w-12 text-zinc-700" /><h1 className="mt-5 text-2xl font-black">Sign in to Purchased Music</h1><p className="mt-2 text-sm text-zinc-500">Your downloads are tied to your MEJay account.</p><Button asChild className="mt-6 bg-emerald-400 text-zinc-950 hover:bg-emerald-300"><Link to={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Sign in</Link></Button></div></main>
  }

  return <div className="min-h-screen bg-[#0a0a0b] text-zinc-100">
    <header className="border-b border-white/10 px-4 py-5 sm:px-8"><div className="mx-auto flex max-w-6xl items-center gap-4"><Button asChild variant="ghost" size="icon"><Link to="/app/store" aria-label="Back to Marketplace"><ArrowLeft className="h-4 w-4" /></Link></Button><div><h1 className="text-xl font-black">Purchased Music</h1><p className="text-xs text-zinc-500">Your owned releases and secure downloads</p></div><Button variant="ghost" size="icon" className="ml-auto" aria-label="Refresh purchases" disabled={purchases.isFetching} onClick={() => void purchases.refetch()}><RefreshCw className={`h-4 w-4 ${purchases.isFetching ? 'animate-spin' : ''}`} /></Button></div></header>
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      {sessionId && <CheckoutState complete={Boolean(status.data?.order_id)} failed={status.isError} />}
      {purchases.isLoading ? <PurchaseGridSkeleton /> : purchases.isError ? <ErrorState message={purchases.error.message} /> : !purchases.data?.length ? <EmptyState /> : <div className="space-y-5">{purchases.data.map((purchase) => <PurchaseCard key={purchase.entitlement_id} purchase={purchase} />)}</div>}
    </main>
  </div>
}

function CheckoutState({complete, failed}: {complete: boolean; failed: boolean}) {
  return <div className={`mb-7 flex items-center gap-3 rounded-md border p-4 text-sm ${failed ? 'border-red-400/30 bg-red-400/5 text-red-300' : complete ? 'border-emerald-400/30 bg-emerald-400/5 text-emerald-200' : 'border-white/10 bg-white/[0.03] text-zinc-300'}`}>
    {!complete && !failed && <LoaderCircle className="h-4 w-4 animate-spin" />}
    <div><p className="font-semibold">{failed ? 'Payment received, but fulfillment is delayed' : complete ? 'Purchase complete' : 'Confirming your purchase'}</p><p className="mt-0.5 text-xs opacity-70">{failed ? 'Refresh this page shortly. Stripe will retry fulfillment automatically.' : complete ? 'Your downloads are ready.' : 'This usually takes only a few seconds.'}</p></div>
  </div>
}

function PurchaseCard({purchase}: {purchase: Purchase}) {
  const artwork = storeAssetUrl(purchase.artwork_asset_id)
  const active = purchase.entitlement_status === 'active'
  return <article className="grid gap-5 border-b border-white/10 pb-6 sm:grid-cols-[8rem_1fr]">
    <div className="aspect-square overflow-hidden rounded-md bg-[#19191c]">{artwork ? <img src={artwork} alt={`${purchase.release_title} cover`} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center"><Disc3 className="h-10 w-10 text-zinc-700" /></div>}</div>
    <div className="min-w-0"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{purchase.release_title}</h2><p className="mt-1 text-sm text-zinc-400">{purchase.artist_name}</p><p className="mt-2 text-xs text-zinc-600">Purchased {formatDate(purchase.paid_at)} · {formatPrice(purchase.unit_amount_minor, purchase.currency)}</p></div><span className={`rounded-full border px-2.5 py-1 text-xs ${active ? 'border-emerald-400/30 text-emerald-300' : 'border-amber-400/30 text-amber-300'}`}>{active ? 'Owned' : purchase.entitlement_status}</span></div>
      <div className="mt-5 divide-y divide-white/10 border-y border-white/10">{purchase.files.map((file) => <div key={file.id} className="flex items-center gap-3 py-3"><span className="w-6 text-xs text-zinc-600">{file.trackNumber}</span><p className="min-w-0 flex-1 truncate text-sm">{file.title}</p><span className="hidden text-xs text-zinc-600 sm:inline">{formatBytes(file.byteSize)}</span>{active ? <Button asChild size="sm" variant="outline" className="gap-2"><a href={purchaseDownloadUrl(purchase.entitlement_id, file.id)}><Download className="h-4 w-4" />Download</a></Button> : <Button size="sm" variant="outline" disabled>Unavailable</Button>}</div>)}</div>
    </div>
  </article>
}

function LibraryLoading() { return <div className="min-h-screen bg-[#0a0a0b] p-8"><div className="mx-auto max-w-6xl"><Skeleton className="h-10 w-64 bg-white/5" /><PurchaseGridSkeleton /></div></div> }
function PurchaseGridSkeleton() { return <div className="mt-8 space-y-5">{[0, 1].map((item) => <Skeleton key={item} className="h-48 bg-white/5" />)}</div> }
function ErrorState({message}: {message: string}) { return <div role="alert" className="border-y border-red-400/20 py-10 text-center text-sm text-red-300">{message}</div> }
function EmptyState() { return <div className="grid min-h-80 place-items-center border-y border-dashed border-white/10 text-center"><div><Disc3 className="mx-auto h-10 w-10 text-zinc-700" /><h2 className="mt-4 text-lg font-bold">No purchases yet</h2><p className="mt-1 text-sm text-zinc-500">Music you buy in the Marketplace will appear here.</p><Button asChild variant="outline" className="mt-5"><Link to="/app/store">Browse Marketplace</Link></Button></div></div> }
function formatDate(value: string) { return new Intl.DateTimeFormat('en-US', {year: 'numeric', month: 'short', day: 'numeric'}).format(new Date(value)) }
function formatPrice(amount: number, currency: string) { return new Intl.NumberFormat('en-US', {style: 'currency', currency}).format(amount / 100) }
function formatBytes(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB` }
