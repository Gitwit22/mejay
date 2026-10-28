import {useState, type FormEvent} from 'react'
import {useMutation, useQuery} from '@tanstack/react-query'
import {CheckCircle2, Clock, Disc3, Download, LoaderCircle, Mail} from 'lucide-react'
import {Link, useSearchParams} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {exchangeGuestAccess, getGuestOrderStatus, guestDownloadUrl, recoverGuestAccess, type GuestAccess} from '@/lib/marketplaceCommerceApi'
import {usePlanStore} from '@/stores/planStore'
import {ACCOUNT_INVITE, PREORDER_CHARGE_NOTICE, preorderLabel, SCHEDULER_NOTE} from '@/lib/releaseTime'
import {SPAM_FOLDER_HINT} from '@/lib/emailCopy'

function Shell({children}: {children: React.ReactNode}) {
  return <div className="min-h-screen bg-[#0a0a0b] px-4 py-10 text-zinc-100 sm:px-8">
    <main className="mx-auto max-w-xl space-y-6">
      <Link to="/app?tab=music" className="text-sm font-black tracking-[0.12em] text-zinc-300 hover:text-white">MEJAY MUSIC</Link>
      {children}
    </main>
  </div>
}

/** Optional: never required to buy or download. Shown only to signed-out buyers. */
export function AccountInvite() {
  const authStatus = usePlanStore((state) => state.authStatus)
  if (authStatus === 'authenticated') return null
  return <div className="rounded-md border border-white/10 bg-white/[0.03] p-4 text-sm">
    <p className="text-zinc-300">{ACCOUNT_INVITE}</p>
    <p className="mt-1 text-xs text-zinc-500">Use the email you checked out with. After you verify it, your purchases move into your library. No marketing emails unless you choose them.</p>
    <Button asChild size="sm" variant="outline" className="mt-3"><Link to={`/login?intent=signup&returnTo=${encodeURIComponent('/app/purchased')}`}>Create a free account</Link></Button>
  </div>
}

/** Stripe's success redirect for guest checkout. Shows status only; files arrive by email. */
export function PurchaseCompletePage() {
  const [searchParams] = useSearchParams()
  const sessionId = searchParams.get('session_id') ?? ''
  const status = useQuery({
    queryKey: ['music-store', 'guest-order', sessionId],
    queryFn: () => getGuestOrderStatus(sessionId),
    enabled: Boolean(sessionId),
    refetchInterval: (query) => query.state.data?.paid ? false : 2000,
    retry: 10,
  })
  const order = status.data
  const preorder = order?.purchaseType === 'preorder' && order.deliveryStatus !== 'available'
  return <Shell>
    {!sessionId || status.isError ? <div role="alert" className="rounded-md border border-red-400/30 bg-red-400/5 p-5 text-sm text-red-200">
      <p className="font-semibold">We couldn't find this checkout.</p>
      <p className="mt-1 opacity-80">If you were charged, your confirmation email has your order details. You can also request your download links below.</p>
    </div> : !order?.paid ? <div className="flex items-center gap-3 rounded-md border border-white/10 bg-white/[0.03] p-5 text-sm" role="status">
      <LoaderCircle className="h-5 w-5 animate-spin" /><div><p className="font-semibold">Confirming your purchase</p><p className="text-xs text-zinc-400">This usually takes only a few seconds.</p></div>
    </div> : <section className="space-y-4 rounded-md border border-emerald-400/30 bg-emerald-400/5 p-5">
      <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" /><div>
        <h1 className="text-xl font-black">{preorder ? 'Pre-order confirmed' : 'Purchase complete'}</h1>
        <p className="mt-1 text-sm text-zinc-300">{order.itemTitle} · {order.artistName}</p>
      </div></div>
      {preorder ? <div className="space-y-1 text-sm text-zinc-300">
        <p className="font-semibold text-amber-300">{preorderLabel(order.releaseAt, order.releaseTimezone)}</p>
        <p>{PREORDER_CHARGE_NOTICE}</p>
        <p>We'll email your download link{order.maskedEmail ? ` to ${order.maskedEmail}` : ''} on release day. {SCHEDULER_NOTE}</p>
        <p className="text-xs text-zinc-400">When it arrives, it may be in your spam or junk folder. First emails from us often land there.</p>
      </div> : <div className="space-y-1">
        <p className="flex items-center gap-2 text-sm text-zinc-300"><Mail className="h-4 w-4" />Your download link is on its way{order.maskedEmail ? ` to ${order.maskedEmail}` : ''}. It works for 7 days without signing in.</p>
        <p className="text-xs text-zinc-400">{SPAM_FOLDER_HINT}</p>
      </div>}
    </section>}
    <AccountInvite />
    <RecoveryForm />
  </Shell>
}

function readToken(): string {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return params.get('token')?.trim() ?? ''
}

/**
 * The emailed link lands here. Opening the page does nothing: the token is exchanged only when the
 * buyer presses "Download your music", so link scanners never use it up.
 */
export function GuestDownloadPage() {
  const [token] = useState(readToken)
  const exchange = useMutation({mutationFn: () => exchangeGuestAccess(token)})
  const access: GuestAccess | undefined = exchange.data
  return <Shell>
    <section className="space-y-4 rounded-md border border-white/10 bg-white/[0.03] p-5">
      <div className="flex items-center gap-3"><Disc3 className="h-6 w-6 text-emerald-300" /><h1 className="text-xl font-black">Your MeJay music</h1></div>
      {!token ? <p className="text-sm text-zinc-400">This page needs the link from your purchase email. Request a new link below if you can't find it.</p>
        : !access ? <>
          <p className="text-sm text-zinc-400">Your download link works for 7 days. You can download again if a download is interrupted.</p>
          <Button className="gap-2 bg-emerald-400 font-bold text-zinc-950 hover:bg-emerald-300" disabled={exchange.isPending} onClick={() => exchange.mutate()}>
            {exchange.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}Download your music
          </Button>
          {exchange.isError && <p role="alert" className="text-sm text-red-300">{exchange.error.message}</p>}
        </>
        : access.state === 'held' ? <div className="space-y-1 text-sm">
          <p className="flex items-center gap-2 font-semibold text-amber-300"><Clock className="h-4 w-4" />{preorderLabel(access.purchase.releaseAt, access.purchase.releaseTimezone)}</p>
          <p className="text-zinc-300">{access.purchase.itemTitle} · {access.purchase.artistName}</p>
          <p className="text-zinc-400">Your pre-order is paid. Downloads open on release day, and we'll email you a fresh link then. {SCHEDULER_NOTE}</p>
        </div>
        : <div className="space-y-3">
          <p className="text-sm text-zinc-300">{access.purchase.itemTitle} · {access.purchase.artistName}</p>
          <ul className="divide-y divide-white/10 border-y border-white/10">{access.files.map((file) => <li key={file.id} className="flex items-center gap-3 py-3">
            <span className="w-6 text-xs text-zinc-600">{file.trackNumber}</span>
            <span className="min-w-0 flex-1 truncate text-sm">{file.title}</span>
            <span className="hidden text-xs text-zinc-600 sm:inline">{formatBytes(file.byteSize)}</span>
            <Button asChild size="sm" variant="outline" className="gap-2"><a href={guestDownloadUrl(file.id, access.accessToken)} rel="noreferrer" download={file.fileName}><Download className="h-4 w-4" />Download</a></Button>
          </li>)}</ul>
          <p className="text-xs text-zinc-500">These download buttons work for the next 2 hours. Interrupted? Press Download again, or reopen your email link any time in the next 7 days.</p>
        </div>}
    </section>
    <AccountInvite />
    <RecoveryForm />
  </Shell>
}

/** Lost or expired link: new links go only to the purchase email, and the reply never reveals whether it exists. */
function RecoveryForm() {
  const [email, setEmail] = useState('')
  const recover = useMutation({mutationFn: () => recoverGuestAccess(email.trim())})
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (email.trim()) recover.mutate()
  }
  return <form onSubmit={submit} className="space-y-2 rounded-md border border-white/10 p-4" noValidate>
    <Label htmlFor="recover-email">Lost your link, or did it expire?</Label>
    <p className="text-xs text-zinc-500">Enter the email you used at checkout and we'll send new download links to that address.</p>
    <div className="flex flex-col gap-2 sm:flex-row">
      <Input id="recover-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
      <Button type="submit" variant="outline" disabled={!email.trim() || recover.isPending}>{recover.isPending ? 'Sending…' : 'Email me new links'}</Button>
    </div>
    {recover.isSuccess && <div role="status" className="space-y-1"><p className="text-sm text-emerald-300">{recover.data.message}</p><p className="text-xs text-zinc-500">{SPAM_FOLDER_HINT}</p></div>}
    {recover.isError && <p role="alert" className="text-sm text-red-300">{recover.error.message}</p>}
  </form>
}

function formatBytes(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB` }
