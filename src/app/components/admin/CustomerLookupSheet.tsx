import {useEffect, useState} from 'react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {ChevronRight, Search, UserRound} from 'lucide-react'

import {FinanceOrderDialog} from '@/app/components/admin/FinanceOrderDialog'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle} from '@/components/ui/sheet'
import {Skeleton} from '@/components/ui/skeleton'
import {toast} from '@/hooks/use-toast'
import {lookupCustomer, setCustomerFullAccess, type CustomerAccount, type CustomerPurchase} from '@/lib/marketplaceAdminApi'

const money = (minor: number, currency = 'USD') => new Intl.NumberFormat('en-US', {style: 'currency', currency}).format(minor / 100)
const day = (value: string | null | undefined) => value ? new Date(value).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'}) : '-'
const words = (value: string | null | undefined) => value ? value.replace(/_/g, ' ') : '-'

/** Waits until typing pauses so every keystroke doesn't hit the API. */
function useDebounced(value: string, ms = 300): string {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, ms])
  return settled
}

/**
 * "Find a customer": type an email (or part of one) to see their MeJay account and everything
 * they bought. Tapping a purchase opens the order, where Buyer access (download link, email fix) lives.
 */
export function CustomerLookupSheet({open, onOpenChange}: {open: boolean; onOpenChange: (open: boolean) => void}) {
  const [query, setQuery] = useState('')
  const [openOrderId, setOpenOrderId] = useState<string | null>(null)
  const term = useDebounced(query.trim().toLowerCase())
  const result = useQuery({
    queryKey: ['marketplace-admin', 'customers', term],
    queryFn: () => lookupCustomer(term),
    enabled: open && term.length >= 3,
    staleTime: 30_000,
  })

  return <>
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto border-white/10 bg-[#0f0f11] text-zinc-100 sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="text-zinc-100">Find a customer</SheetTitle>
          <SheetDescription>Type an email, or part of one, to see their account and everything they bought.</SheetDescription>
        </SheetHeader>
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          <Input autoFocus type="search" inputMode="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={query} onChange={(event) => setQuery(event.target.value)}
            placeholder="name@example.com" aria-label="Customer email" className="pl-9" />
        </div>
        <div className="mt-5 space-y-6 text-sm">
          {term.length < 3 ? <p className="text-zinc-500">Type at least 3 characters.</p>
            : result.isLoading ? <Skeleton className="h-40 bg-white/5" />
            : result.isError ? <p role="alert" className="text-red-300">{result.error.message}</p>
            : result.data ? <>
              {result.data.customer
                ? <Customer email={result.data.customer.email} account={result.data.customer.account} purchases={result.data.customer.purchases} onOpenOrder={setOpenOrderId} />
                : null}
              <Matches matches={result.data.matches.filter((email) => email !== result.data.customer?.email)} hasCustomer={Boolean(result.data.customer)} onPick={setQuery} />
            </> : null}
        </div>
      </SheetContent>
    </Sheet>
    <FinanceOrderDialog orderId={openOrderId} onClose={() => setOpenOrderId(null)} />
  </>
}

function Matches({matches, hasCustomer, onPick}: {matches: string[]; hasCustomer: boolean; onPick: (email: string) => void}) {
  if (matches.length === 0) return hasCustomer ? null : <p className="text-zinc-500">No accounts or purchases match that email.</p>
  return <section>
    <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{hasCustomer ? 'Similar emails' : 'Matching emails'}</h3>
    <ul className="divide-y divide-white/10 border-y border-white/10">{matches.map((email) => <li key={email}>
      <button type="button" onClick={() => onPick(email)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:text-emerald-300">
        <span className="truncate">{email}</span><ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
      </button>
    </li>)}</ul>
  </section>
}

function Customer({email, account, purchases, onOpenOrder}: {email: string; account: CustomerAccount | null; purchases: CustomerPurchase[]; onOpenOrder: (orderId: string) => void}) {
  const paid = purchases.filter((purchase) => ['paid', 'partially_refunded'].includes(purchase.payment_status))
  const spent = paid.reduce((sum, purchase) => sum + purchase.gross_amount_minor, 0)
  return <>
    <section className="flex items-start gap-3">
      <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-emerald-300"><UserRound className="h-5 w-5" /></div>
      <div className="min-w-0">
        <p className="truncate font-medium">{account?.display_name || email}</p>
        <p className="truncate text-xs text-zinc-500">{email}</p>
        <p className="mt-1 text-xs text-zinc-400">{purchases.length} purchase{purchases.length === 1 ? '' : 's'}{paid.length ? ` · ${money(spent, paid[0].currency)} spent` : ''}</p>
      </div>
    </section>

    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">MeJay account</h3>
      {account ? <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1.5">
        <dt className="text-zinc-500">Joined</dt><dd>{day(account.created_at)}</dd>
        <dt className="text-zinc-500">Last signed in</dt><dd>{day(account.last_session_at)}</dd>
        <dt className="text-zinc-500">Account type</dt><dd className="capitalize">{words(account.account_intent)}</dd>
        <dt className="text-zinc-500">Sign-in</dt><dd>{account.has_password ? 'Password' : 'Email code'}</dd>
        <dt className="text-zinc-500">MeJay plan</dt><dd className="capitalize">{account.plan ? `${words(account.plan.access_type)}${account.plan.subscription_status ? ` · ${words(account.plan.subscription_status)}` : ''}${account.plan.billing_cadence ? ` · ${account.plan.billing_cadence}` : ''}` : 'Free'}</dd>
        {account.plan?.current_period_end && <><dt className="text-zinc-500">Renews / ends</dt><dd>{day(account.plan.current_period_end)}</dd></>}
        <dt className="text-zinc-500">Free access</dt><dd><FreeAccess account={account} /></dd>
        {account.provider && <><dt className="text-zinc-500">Artist account</dt><dd>{account.provider.display_name || 'Unnamed'}<span className="text-zinc-500"> · {words(account.provider.status)} · {account.provider.member_role}</span></dd></>}
        {account.marketplace_role && <><dt className="text-zinc-500">MeJay staff</dt><dd className="capitalize">{account.marketplace_role}</dd></>}
      </dl> : <p className="text-zinc-400">No MeJay account. Purchases below were made as a guest with this email.</p>}
    </section>

    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Music purchased</h3>
      {purchases.length === 0 ? <p className="text-zinc-500">Nothing purchased yet.</p>
        : <ul className="divide-y divide-white/10 border-y border-white/10">{purchases.map((purchase) => <li key={purchase.order_id}>
          <button type="button" onClick={() => onOpenOrder(purchase.order_id)} aria-label={`Open order for ${purchase.song_title ?? purchase.release_title}`}
            className="flex w-full items-center gap-3 py-3 text-left hover:bg-white/[0.03]">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{purchase.song_title ?? purchase.release_title}<span className="font-normal text-zinc-500"> · {purchase.artist_name}</span></p>
              <p className="text-xs text-zinc-500">
                {day(purchase.paid_at)} · {money(purchase.gross_amount_minor, purchase.currency)} · {purchase.purchase_type === 'preorder' ? 'Pre-order' : 'Purchase'}{purchase.guest_checkout ? ' · guest' : ''}
                {purchase.payment_status !== 'paid' ? ` · ${words(purchase.payment_status)}` : ''}
              </p>
              <p className="text-xs text-zinc-400">
                {purchase.delivery_status === 'held' ? 'Waiting for release day' : purchase.access_status && purchase.access_status !== 'active' ? `Access ${purchase.access_status}` : `Downloaded ${purchase.download_count}×`}
                {purchase.last_email ? <span className={purchase.last_email.status === 'failed' ? 'text-red-300' : ''}> · last email {words(purchase.last_email.kind)} {words(purchase.last_email.status)}</span> : ''}
              </p>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-zinc-500" />
          </button>
        </li>)}</ul>}
      {purchases.length > 0 && <p className="mt-2 text-xs text-zinc-500">Tap a purchase to open it. Buyer access (download link, email fix) is inside.</p>}
    </section>
  </>
}

/**
 * Free full access given by MeJay staff. It sits beside any paid plan: giving it never touches billing,
 * and taking it away leaves a paid subscription or Full Program purchase as it was.
 */
function FreeAccess({account}: {account: CustomerAccount}) {
  const queryClient = useQueryClient()
  const granted = Boolean(account.free_access)
  const change = useMutation({
    mutationFn: (grant: boolean) => setCustomerFullAccess(account.id, grant),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({queryKey: ['marketplace-admin', 'customers']})
      toast(result.full_site_access
        ? {title: 'Free access given', description: `${account.email} now has full MeJay access at no charge.`}
        : {title: 'Free access removed', description: `${account.email} keeps any plan they pay for.`})
    },
    onError: (error: Error) => toast({title: 'Access not changed', description: error.message, variant: 'destructive'}),
  })
  const toggle = () => {
    const question = granted
      ? `Remove free access for ${account.email}? Anything they pay for stays.`
      : `Give ${account.email} full MeJay access for free? They are not charged and can use everything until you remove it.`
    if (window.confirm(question)) change.mutate(!granted)
  }
  return <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
    <span>{granted
      ? <>Yes<span className="text-zinc-500"> · {account.free_access?.granted_by_email ? `by ${account.free_access.granted_by_email} · ` : ''}{day(account.free_access?.updated_at)}</span></>
      : 'No'}</span>
    <Button type="button" size="sm" variant="outline" className="h-7" disabled={change.isPending} onClick={toggle}>
      {granted ? 'Remove free access' : 'Give free access'}
    </Button>
  </div>
}
