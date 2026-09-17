import {useQuery} from '@tanstack/react-query'
import {ArrowLeft, Banknote} from 'lucide-react'
import {Link, useLocation, useSearchParams} from 'react-router-dom'

import {ReportingRangeSelect} from '@/app/components/provider/ProviderReporting'
import {Button} from '@/components/ui/button'
import {Skeleton} from '@/components/ui/skeleton'
import {getRecipientEarnings, type ReportingRange} from '@/lib/providerApi'
import {usePlanStore} from '@/stores/planStore'

export default function RecipientEarningsPage() {
  const authStatus = usePlanStore((state) => state.authStatus)
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedRange = searchParams.get('range')
  const range: ReportingRange = ['7d', '30d', '90d', 'ytd', 'all'].includes(requestedRange ?? '') ? requestedRange as ReportingRange : '30d'
  const report = useQuery({queryKey: ['recipient', 'earnings', range], queryFn: () => getRecipientEarnings(range), enabled: authStatus === 'authenticated'})
  const setRange = (next: ReportingRange) => setSearchParams((current) => {
    const params = new URLSearchParams(current)
    if (next === '30d') params.delete('range')
    else params.set('range', next)
    return params
  })

  if (authStatus === 'unknown') return <div className="min-h-screen bg-[#0a0a0b] p-8"><Skeleton className="mx-auto h-72 max-w-6xl bg-white/5" /></div>
  if (authStatus !== 'authenticated') {
    const returnTo = `${location.pathname}${location.search}`
    return <main className="grid min-h-screen place-items-center bg-[#0a0a0b] px-5 text-center text-zinc-100"><div><Banknote className="mx-auto h-12 w-12 text-zinc-700" /><h1 className="mt-5 text-2xl font-black">Sign in to Earnings</h1><p className="mt-2 text-sm text-zinc-500">Split earnings are matched to your verified MEJay account email.</p><Button asChild className="mt-6 bg-emerald-400 text-zinc-950 hover:bg-emerald-300"><Link to={`/login?returnTo=${encodeURIComponent(returnTo)}`}>Sign in</Link></Button></div></main>
  }

  return <div className="min-h-screen bg-[#0a0a0b] text-zinc-100"><header className="border-b border-white/10 px-4 py-5 sm:px-8"><div className="mx-auto flex max-w-6xl items-center gap-4"><Button asChild variant="ghost" size="icon"><Link to="/app" aria-label="Back to MEJay"><ArrowLeft className="h-4 w-4" /></Link></Button><div><h1 className="text-xl font-black">Earnings</h1><p className="text-xs text-zinc-500">Your MEJay split allocations</p></div><div className="ml-auto"><ReportingRangeSelect value={range} onChange={setRange} /></div></div></header><main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">{report.isLoading ? <RecipientSkeleton /> : report.isError || !report.data ? <ErrorState message={report.error?.message || 'Earnings are unavailable'} /> : <RecipientStatement report={report.data} />}</main></div>
}

function RecipientStatement({report}: {report: Awaited<ReturnType<typeof getRecipientEarnings>>}) {
  const metrics = [['Owed to You', report.summary.owedMinor], ['Allocated Earnings', report.summary.allocatedMinor], ['Refund Adjustments', report.summary.refundAdjustmentMinor]] as const
  return <div className="space-y-9"><div><p className="text-sm text-zinc-500">Statement for</p><p className="font-medium">{report.recipientEmail}</p></div><dl className="grid gap-3 md:grid-cols-3">{metrics.map(([label, value]) => <div key={label} className="rounded-md border border-white/10 bg-[#141417] p-5"><dt className="text-xs font-medium uppercase text-zinc-500">{label}</dt><dd className={`mt-3 text-3xl font-bold tabular-nums ${label === 'Owed to You' ? 'text-emerald-300' : ''}`}>{money(value)}</dd></div>)}</dl><section><h2 className="text-lg font-semibold">Earnings statement</h2><p className="mt-1 text-sm text-zinc-500">Release and track allocations after marketplace refund adjustments.</p>{report.rows.length === 0 ? <div className="mt-5 border-y border-dashed border-white/10 py-14 text-center"><Banknote className="mx-auto h-9 w-9 text-zinc-700" /><p className="mt-4 font-medium">No split earnings found</p><p className="mt-1 text-sm text-zinc-500">No allocations in this period match {report.recipientEmail}.</p></div> : <div className="mt-5 overflow-x-auto border-y border-white/10"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="text-xs uppercase text-zinc-500"><th className="px-3 py-3 font-medium">Date</th><th className="px-3 py-3 font-medium">Release / Track</th><th className="px-3 py-3 font-medium">Role</th><th className="px-3 py-3 font-medium">Allocated</th><th className="px-3 py-3 font-medium">Adjustments</th><th className="px-3 py-3 font-medium">Owed</th></tr></thead><tbody className="divide-y divide-white/10">{report.rows.map((row) => <tr key={row.allocationId}><td className="px-3 py-3 text-zinc-400">{date(row.saleDate)}</td><td className="px-3 py-3"><p className="font-medium">{row.trackTitle}</p><p className="text-xs text-zinc-500">{row.releaseTitle}</p></td><td className="px-3 py-3 capitalize text-zinc-400">{row.role || '-'}</td><td className="px-3 py-3 tabular-nums">{money(row.allocatedMinor)}</td><td className="px-3 py-3 tabular-nums text-zinc-400">{money(row.refundAdjustmentMinor)}</td><td className="px-3 py-3 font-medium tabular-nums text-emerald-300">{money(row.owedMinor)}</td></tr>)}</tbody></table></div>}</section><p className="text-xs leading-relaxed text-zinc-500">These amounts are owed by the release provider. MEJay currently transfers marketplace proceeds to the provider's Stripe account and does not automatically pay individual split recipients.</p></div>
}

function RecipientSkeleton() { return <div className="space-y-5"><div className="grid gap-3 md:grid-cols-3">{Array.from({length: 3}).map((_, index) => <Skeleton key={index} className="h-28 bg-white/5" />)}</div><Skeleton className="h-72 bg-white/5" /></div> }
function ErrorState({message}: {message: string}) { return <div role="alert" className="border border-red-400/30 bg-red-400/5 p-4 text-sm text-red-300">{message}</div> }
function money(amountMinor: number) { return new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(amountMinor / 100) }
function date(value: string) { return new Intl.DateTimeFormat('en-US', {year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'}).format(new Date(value)) }
