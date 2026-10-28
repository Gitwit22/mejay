import {useEffect, useState} from 'react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {ArrowLeft, Clock, Disc3, Download, Link2, ListPlus, LoaderCircle, RefreshCw} from 'lucide-react'
import {Link, useSearchParams} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Skeleton} from '@/components/ui/skeleton'
import {apiFetch} from '@/lib/api'
import {claimStorePurchases, fetchPurchaseFiles, getStoreOrderStatus, listStorePurchases, purchaseArtworkUrl, purchaseDownloadUrl, type Purchase} from '@/lib/marketplaceCommerceApi'
import {preorderLabel, SCHEDULER_NOTE} from '@/lib/releaseTime'
import {toast} from '@/hooks/use-toast'
import {useDJStore} from '@/stores/djStore'
import {usePlanStore} from '@/stores/planStore'
import {SPAM_FOLDER_HINT} from '@/lib/emailCopy'

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
    return <main className="grid min-h-screen place-items-center bg-[#0a0a0b] px-5 text-center text-zinc-100"><div><Disc3 className="mx-auto h-12 w-12 text-zinc-700" /><h1 className="mt-5 text-2xl font-black">Sign in to Purchased Music</h1><p className="mt-2 text-sm text-zinc-500">Sign in to see the purchases saved to your MEJay account.</p><Button asChild className="mt-6 bg-emerald-400 text-zinc-950 hover:bg-emerald-300"><Link to={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Sign in</Link></Button><p className="mt-6 text-xs text-zinc-500">Bought without an account? Use the download link in your purchase email, or <Link to="/download" className="underline hover:text-zinc-300">request a new link</Link>.</p></div></main>
  }

  return <div className="min-h-screen bg-[#0a0a0b] text-zinc-100">
    <header className="border-b border-white/10 px-4 py-5 sm:px-8"><div className="mx-auto flex max-w-6xl items-center gap-4"><Button asChild variant="ghost" size="icon"><Link to="/app?tab=music" aria-label="Back to Discover"><ArrowLeft className="h-4 w-4" /></Link></Button><div><h1 className="text-xl font-black">Purchased Music</h1><p className="text-xs text-zinc-500">Your owned releases and secure downloads</p></div><Button variant="ghost" size="icon" className="ml-auto" aria-label="Refresh purchases" disabled={purchases.isFetching} onClick={() => void purchases.refetch()}><RefreshCw className={`h-4 w-4 ${purchases.isFetching ? 'animate-spin' : ''}`} /></Button></div></header>
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      {sessionId && <CheckoutState complete={Boolean(status.data?.order_id)} failed={status.isError} />}
      <LinkGuestPurchases />
      {purchases.isLoading ? <PurchaseGridSkeleton /> : purchases.isError ? <ErrorState message={purchases.error.message} /> : !purchases.data?.length ? <EmptyState /> : <div className="space-y-5">{purchases.data.map((purchase) => <PurchaseCard key={purchase.entitlement_id} purchase={purchase} />)}</div>}
    </main>
  </div>
}

function CheckoutState({complete, failed}: {complete: boolean; failed: boolean}) {
  return <div className={`mb-7 flex items-center gap-3 rounded-md border p-4 text-sm ${failed ? 'border-red-400/30 bg-red-400/5 text-red-300' : complete ? 'border-emerald-400/30 bg-emerald-400/5 text-emerald-200' : 'border-white/10 bg-white/[0.03] text-zinc-300'}`}>
    {!complete && !failed && <LoaderCircle className="h-4 w-4 animate-spin" />}
    <div><p className="font-semibold">{failed ? 'Payment received, but fulfillment is delayed' : complete ? 'Purchase complete' : 'Confirming your purchase'}</p><p className="mt-0.5 text-xs opacity-70">{failed ? 'Refresh this page shortly. Stripe will retry fulfillment automatically.' : complete ? 'It is in your library below. Pre-orders unlock on release day.' : 'This usually takes only a few seconds.'}</p></div>
  </div>
}

function PurchaseCard({purchase}: {purchase: Purchase}) {
  const artwork = purchaseArtworkUrl(purchase)
  const held = purchase.delivery_status === 'held'
  const active = purchase.entitlement_status === 'active' && !held
  const importTracks = useDJStore((state) => state.importTracks)
  const [adding, setAdding] = useState(false)
  const addToLibrary = async () => {
    setAdding(true)
    try {
      const files = await fetchPurchaseFiles(purchase)
      // This page can be opened directly; make sure the local library and settings are loaded so
      // duplicates are detected and the user's import settings apply.
      const dj = useDJStore.getState()
      if (dj.tracks.length === 0) await Promise.all([dj.loadTracks(), dj.loadSettings()])
      // Purchased music never counts toward the Free import limit.
      await importTracks(files, {skipQuota: true})
    } catch (error) {
      toast({title: "Couldn't add to My Music", description: error instanceof Error ? error.message : 'Please try again.', variant: 'destructive'})
    } finally {
      setAdding(false)
    }
  }
  return <article className="grid gap-5 border-b border-white/10 pb-6 sm:grid-cols-[8rem_1fr]">
    <div className="aspect-square overflow-hidden rounded-md bg-[#19191c]">{artwork ? <img src={artwork} alt={`${purchase.release_title} cover`} className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center"><Disc3 className="h-10 w-10 text-zinc-700" /></div>}</div>
    <div className="min-w-0"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{purchase.track_id ? purchase.product_name ?? purchase.release_title : purchase.release_title}</h2><p className="mt-1 text-sm text-zinc-400">{purchase.artist_name}{purchase.track_id ? ` · Song from ${purchase.release_title}` : ''}</p><p className="mt-2 text-xs text-zinc-600">{held ? 'Pre-ordered' : 'Purchased'} {formatDate(purchase.paid_at)} · {formatPrice(purchase.unit_amount_minor, purchase.currency)}</p>{held && <p className="mt-2 flex items-center gap-1.5 text-xs font-semibold text-amber-300"><Clock className="h-3.5 w-3.5" />{preorderLabel(purchase.release_at, purchase.release_timezone)}</p>}</div><div className="flex items-center gap-2">{active && <Button size="sm" className="gap-2" disabled={adding} onClick={() => void addToLibrary()}>{adding ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ListPlus className="h-4 w-4" />}{adding ? 'Adding…' : 'Add to My Music'}</Button>}<span className={`rounded-full border px-2.5 py-1 text-xs ${active ? 'border-emerald-400/30 text-emerald-300' : 'border-amber-400/30 text-amber-300'}`}>{active ? 'Owned' : held && purchase.entitlement_status === 'active' ? 'Pre-order' : purchase.entitlement_status}</span></div></div>
      <div className="mt-5 divide-y divide-white/10 border-y border-white/10">{purchase.files.map((file) => <div key={file.id} className="flex items-center gap-3 py-3"><span className="w-6 text-xs text-zinc-600">{file.trackNumber}</span><p className="min-w-0 flex-1 truncate text-sm">{file.title}</p><span className="hidden text-xs text-zinc-600 sm:inline">{formatBytes(file.byteSize)}</span>{active ? <Button asChild size="sm" variant="outline" className="gap-2"><a href={purchaseDownloadUrl(purchase.entitlement_id, file.id)}><Download className="h-4 w-4" />Download</a></Button> : <Button size="sm" variant="outline" disabled>{held ? 'On release day' : 'Unavailable'}</Button>}</div>)}</div>
      {held && <p className="mt-3 text-xs text-zinc-500">Paid. Downloads open on release day. {SCHEDULER_NOTE}</p>}
    </div>
  </article>
}

/**
 * Moves purchases made as a guest with this account's email into the library. The buyer proves they
 * control the address with an emailed code first; the API refuses any other email.
 */
function LinkGuestPurchases() {
  const email = usePlanStore((state) => state.user?.email ?? '')
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const call = async (path: string, body: Record<string, unknown>) => {
    const response = await apiFetch(path, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body)})
    const data = await response.json().catch(() => null) as {ok?: boolean; error?: string; verifiedToken?: string} | null
    if (!response.ok || !data?.ok) throw new Error(data?.error === 'bad_code' ? 'That code is not right. Check your email and try again.' : 'Something went wrong. Try again in a moment.')
    return data
  }
  const send = useMutation({mutationFn: () => call('/api/auth/start', {email, purpose: 'signup_verify'}), onSuccess: () => setCodeSent(true)})
  const link = useMutation({
    mutationFn: async () => {
      const verified = await call('/api/auth/verify-code', {email, code: code.trim(), purpose: 'signup_verify'})
      return claimStorePurchases(String(verified.verifiedToken))
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({queryKey: ['music-store', 'purchases']})
      toast({title: result.claimed ? `Linked ${result.claimed} purchase${result.claimed === 1 ? '' : 's'}` : 'No other purchases found', description: result.claimed ? undefined : `Nothing else was bought with ${email}.`})
      setOpen(false); setCode(''); setCodeSent(false)
    },
  })
  if (!email) return null
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="mb-6 flex items-center gap-2 text-xs text-zinc-400 hover:text-zinc-200"><Link2 className="h-3.5 w-3.5" />Bought something without signing in? Link those purchases</button>
  return <div className="mb-7 space-y-3 rounded-md border border-white/10 bg-white/[0.03] p-4 text-sm">
    <p className="text-zinc-300">We'll email a code to <strong>{email}</strong>. Purchases made with that address move into your library once you confirm it.</p>
    {!codeSent ? <Button size="sm" disabled={send.isPending} onClick={() => send.mutate()}>{send.isPending ? 'Sending…' : 'Email me a code'}</Button>
      : <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => { event.preventDefault(); if (code.trim()) link.mutate() }}>
        <Input inputMode="numeric" autoComplete="one-time-code" aria-label="Verification code" placeholder="6-digit code" value={code} onChange={(event) => setCode(event.target.value)} className="sm:w-40" />
        <Button size="sm" type="submit" disabled={!code.trim() || link.isPending}>{link.isPending ? 'Linking…' : 'Verify and link'}</Button>
      </form>}
    {codeSent && <p className="text-xs text-zinc-500">{SPAM_FOLDER_HINT}</p>}
    {(send.isError || link.isError) && <p role="alert" className="text-red-300">{(send.error ?? link.error)?.message}</p>}
    <button type="button" className="text-xs text-zinc-500 hover:text-zinc-300" onClick={() => setOpen(false)}>Cancel</button>
  </div>
}

function LibraryLoading() { return <div className="min-h-screen bg-[#0a0a0b] p-8"><div className="mx-auto max-w-6xl"><Skeleton className="h-10 w-64 bg-white/5" /><PurchaseGridSkeleton /></div></div> }
function PurchaseGridSkeleton() { return <div className="mt-8 space-y-5">{[0, 1].map((item) => <Skeleton key={item} className="h-48 bg-white/5" />)}</div> }
function ErrorState({message}: {message: string}) { return <div role="alert" className="border-y border-red-400/20 py-10 text-center text-sm text-red-300">{message}</div> }
function EmptyState() { return <div className="grid min-h-80 place-items-center border-y border-dashed border-white/10 text-center"><div><Disc3 className="mx-auto h-10 w-10 text-zinc-700" /><h2 className="mt-4 text-lg font-bold">No purchases yet</h2><p className="mt-1 text-sm text-zinc-500">Music you buy on Discover will appear here.</p><Button asChild variant="outline" className="mt-5"><Link to="/app?tab=music">Discover Music</Link></Button></div></div> }
function formatDate(value: string) { return new Intl.DateTimeFormat('en-US', {year: 'numeric', month: 'short', day: 'numeric'}).format(new Date(value)) }
function formatPrice(amount: number, currency: string) { return new Intl.NumberFormat('en-US', {style: 'currency', currency}).format(amount / 100) }
function formatBytes(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB` }
