import {useQuery} from '@tanstack/react-query'
import {Copy, ExternalLink} from 'lucide-react'

import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {Skeleton} from '@/components/ui/skeleton'
import {toast} from '@/hooks/use-toast'
import {getMarketplaceFinanceOrder, type FinanceOrderDetail} from '@/lib/marketplaceAdminApi'

const money = (minor: number | null | undefined, currency = 'USD') => minor === null || minor === undefined
  ? '-' : new Intl.NumberFormat('en-US', {style: 'currency', currency}).format(minor / 100)
const when = (value: string | null | undefined) => value ? new Date(value).toLocaleString() : '-'
const label = (value: string | null | undefined) => value ? value.replace(/_/g, ' ') : '-'

/** What a delivery status means for the buyer, in plain words. */
const DELIVERY_LABELS: Record<string, string> = {
  held: 'Held until release day (pre-order)',
  available: 'Available to download',
}

/** Read-only view of one order: who bought what, the money split, Stripe references, delivery and emails. */
export function FinanceOrderDialog({orderId, onClose}: {orderId: string | null; onClose: () => void}) {
  return <Dialog open={orderId !== null} onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto border-white/10 bg-[#0f0f11] text-zinc-100">
      <DialogHeader>
        <DialogTitle>Order</DialogTitle>
        <DialogDescription className="font-mono text-xs">{orderId}</DialogDescription>
      </DialogHeader>
      {orderId && <OrderBody orderId={orderId} />}
    </DialogContent>
  </Dialog>
}

function OrderBody({orderId}: {orderId: string}) {
  const detail = useQuery({queryKey: ['marketplace-admin', 'finance', 'order', orderId], queryFn: () => getMarketplaceFinanceOrder(orderId)})
  if (detail.isLoading) return <Skeleton className="h-64 bg-white/5" />
  if (detail.isError || !detail.data) return <p role="alert" className="text-sm text-red-300">{detail.error?.message || 'This order could not be loaded.'}</p>
  return <OrderView data={detail.data} />
}

function OrderView({data}: {data: FinanceOrderDetail}) {
  const {order} = data
  const currency = order.currency || 'USD'
  const stripeBase = `https://dashboard.stripe.com/${order.livemode === false ? 'test/' : ''}`
  const buyerEmail = order.buyer_email || order.buyer_account_email
  return <div className="space-y-6 text-sm">
    <Section title="Summary">
      <Facts rows={[
        ['Paid', when(order.paid_at)],
        ['Type', order.purchase_type === 'preorder' ? 'Pre-order' : 'Purchase'],
        ['Buyer', <span key="buyer">{buyerEmail || '-'}<span className="text-zinc-500"> · {order.guest_checkout ? 'guest checkout' : 'MeJay account'}{order.buyer_country_code ? ` · ${order.buyer_country_code}` : ''}</span></span>],
        ['Artist account', order.provider_name || '-'],
        ['Status', <span key="status" className="capitalize">{label(order.payment_status)} · transfer {label(order.transfer_status)}{order.dispute_status !== 'none' ? ` · dispute ${label(order.dispute_status)}` : ''}{order.livemode === false ? ' · test mode' : ''}</span>],
      ]} />
    </Section>

    <Section title="What was bought">
      <ul className="divide-y divide-white/10 border-y border-white/10">{data.items.map((item) => <li key={item.id} className="flex justify-between gap-3 py-2">
        <span><span className="font-medium">{item.song_title ?? item.release_title}</span><span className="text-zinc-500"> · {item.song_title ? `song from ${item.release_title} · ` : ''}{item.artist_name}</span></span>
        <span className="tabular-nums">{money(item.unit_amount_minor, item.currency)}</span>
      </li>)}</ul>
    </Section>

    <Section title="Money">
      <Facts rows={[
        ['Gross', money(order.gross_amount_minor, currency)],
        [`MeJay commission${order.platform_fee_bps !== null ? ` (${order.platform_fee_bps / 100}%)` : ''}`, money(order.platform_commission_minor, currency)],
        ['Stripe fees recovered from artist', money(order.processing_fees_recovered_minor, currency)],
        ['Artist allocation', money(order.provider_proceeds_minor, currency)],
        ['Artist earnings after refunds and disputes', money(order.artist_earnings_minor, currency)],
        ['Stripe fee', order.stripe_fee_minor === null ? 'Not yet reported by Stripe' : money(order.stripe_fee_minor, currency)],
        ['Refunded', order.refunded_amount_minor ? money(order.refunded_amount_minor, currency) : '-'],
        ['Transfer reversed', order.transfer_reversed_minor ? money(order.transfer_reversed_minor, currency) : '-'],
      ]} />
      {data.splits.length > 0 && <div className="mt-3"><p className="text-xs uppercase text-zinc-500">Artist share split</p>
        <ul className="mt-1 divide-y divide-white/10 border-y border-white/10">{data.splits.map((split, index) => <li key={index} className="flex justify-between gap-3 py-2">
          <span>{split.payee_name}<span className="text-zinc-500"> · {split.track_title}{split.payee_role ? ` · ${label(split.payee_role)}` : ''} · {split.share_bps / 100}%</span></span>
          <span className="tabular-nums">{money(split.amount_minor, currency)}</span>
        </li>)}</ul></div>}
    </Section>

    <Section title="Delivery">
      {data.entitlements.length === 0 ? <p className="text-zinc-500">No downloads were granted for this order.</p>
        : <ul className="divide-y divide-white/10 border-y border-white/10">{data.entitlements.map((entitlement) => <li key={entitlement.id} className="py-2">
          <p>{DELIVERY_LABELS[entitlement.delivery_status ?? ''] ?? label(entitlement.delivery_status)}{entitlement.status !== 'active' ? ` · access ${entitlement.status}` : ''}</p>
          <p className="text-xs text-zinc-500">{entitlement.file_count} file{Number(entitlement.file_count) === 1 ? '' : 's'} · downloaded {entitlement.download_count} time{Number(entitlement.download_count) === 1 ? '' : 's'}{entitlement.last_downloaded_at ? `, last ${when(entitlement.last_downloaded_at)}` : ''}{entitlement.delivery_status === 'held' && entitlement.delivery_available_at ? ` · unlocks ${when(entitlement.delivery_available_at)}` : ''}</p>
        </li>)}</ul>}
    </Section>

    <Section title="Buyer emails">
      {data.emails.length === 0 ? <p className="text-zinc-500">No emails recorded.</p>
        : <ul className="space-y-1">{data.emails.map((email, index) => <li key={index} className="flex justify-between gap-3">
          <span className="capitalize">{label(email.kind)}</span>
          <span className={email.status === 'sent' ? 'text-emerald-300' : email.status === 'failed' ? 'text-red-300' : 'text-zinc-400'}>{label(email.status)}{email.sent_at ? ` · ${when(email.sent_at)}` : ''}</span>
        </li>)}</ul>}
    </Section>

    <Section title="Stripe">
      <ul className="space-y-1.5">
        <Reference name="Payment" id={order.stripe_payment_intent_id} href={order.stripe_payment_intent_id ? `${stripeBase}payments/${order.stripe_payment_intent_id}` : null} />
        <Reference name="Charge" id={order.stripe_charge_id} />
        <Reference name="Checkout session" id={order.stripe_checkout_session_id} />
        <Reference name="Transfer to artist" id={order.stripe_transfer_id} missing={order.transfer_status === 'pending' ? 'Not sent yet' : undefined} />
        <Reference name="Transfer reversal" id={order.stripe_transfer_reversal_id} />
        <Reference name="Artist Stripe account" id={order.stripe_destination_account_id} href={order.stripe_destination_account_id ? `${stripeBase}connect/accounts/${order.stripe_destination_account_id}` : null} />
      </ul>
    </Section>

    <Section title="Ledger">
      {data.ledger.length === 0 ? <p className="text-zinc-500">No ledger entries.</p>
        : <div className="space-y-3">{data.ledger.map((transaction) => <div key={transaction.id} className="border border-white/10 p-3">
          <p className="flex justify-between gap-3"><span className="font-medium capitalize">{label(transaction.transaction_type)}</span><span className="text-xs text-zinc-500">{when(transaction.occurred_at)}</span></p>
          <table className="mt-2 w-full text-xs"><thead className="text-zinc-500"><tr><th className="text-left font-normal">Account</th><th className="text-right font-normal">Debit</th><th className="text-right font-normal">Credit</th></tr></thead>
            <tbody>{transaction.entries.map((entry, index) => <tr key={index}><td className="py-0.5">{label(entry.account)}</td><td className="text-right tabular-nums">{entry.debitMinor ? money(entry.debitMinor, currency) : ''}</td><td className="text-right tabular-nums">{entry.creditMinor ? money(entry.creditMinor, currency) : ''}</td></tr>)}</tbody>
          </table>
        </div>)}</div>}
    </Section>
  </div>
}

function Section({title, children}: {title: string; children: React.ReactNode}) {
  return <section><h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>{children}</section>
}

function Facts({rows}: {rows: Array<[string, React.ReactNode]>}) {
  return <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[14rem_1fr]">{rows.map(([name, value]) => <div key={name} className="contents"><dt className="text-zinc-500">{name}</dt><dd className="tabular-nums">{value}</dd></div>)}</dl>
}

function Reference({name, id, href, missing}: {name: string; id: string | null; href?: string | null; missing?: string}) {
  return <li className="flex flex-wrap items-center gap-2">
    <span className="w-40 text-zinc-500">{name}</span>
    {id ? <>
      <span className="font-mono text-xs">{id}</span>
      <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={`Copy ${name} ID`} onClick={() => void navigator.clipboard?.writeText(id).then(() => toast({title: `${name} ID copied`}))}><Copy className="h-3.5 w-3.5" /></Button>
      {href && <a href={href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-emerald-300 hover:underline">Open in Stripe<ExternalLink className="h-3 w-3" /></a>}
    </> : <span className="text-zinc-500">{missing ?? '-'}</span>}
  </li>
}
