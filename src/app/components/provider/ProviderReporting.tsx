import {useQuery} from '@tanstack/react-query'
import {Bar, BarChart, CartesianGrid, Line, LineChart, XAxis, YAxis} from 'recharts'

import {ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig} from '@/components/ui/chart'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select'
import {Skeleton} from '@/components/ui/skeleton'
import {getProviderReporting, type ProviderSalesReport, type ReportingRange} from '@/lib/providerApi'

const rangeLabels: Record<ReportingRange, string> = {'7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', ytd: 'Year to date', all: 'All time'}
const salesChartConfig = {grossMinor: {label: 'Gross sales', color: '#34d399'}, earningsMinor: {label: 'Your earnings', color: '#f59e0b'}} satisfies ChartConfig

export function ReportingRangeSelect({value, onChange}: {value: ReportingRange; onChange: (range: ReportingRange) => void}) {
  return <Select value={value} onValueChange={(next) => onChange(next as ReportingRange)}><SelectTrigger className="w-44 border-white/10 bg-[#141417]" aria-label="Reporting period"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(rangeLabels).map(([range, label]) => <SelectItem key={range} value={range}>{label}</SelectItem>)}</SelectContent></Select>
}

function useProviderReport(range: ReportingRange) {
  return useQuery({queryKey: ['provider', 'reporting', range], queryFn: () => getProviderReporting(range)})
}

export function ProviderOverviewReporting({range, onRangeChange}: {range: ReportingRange; onRangeChange: (range: ReportingRange) => void}) {
  const report = useProviderReport(range)
  if (report.isLoading) return <ReportingSkeleton />
  if (report.isError || !report.data) return <ReportingError message={report.error?.message || 'Sales reporting is unavailable'} />
  const data = report.data
  return <section className="space-y-7" aria-labelledby="financial-overview"><div className="flex flex-wrap items-end justify-between gap-4"><div><h2 id="financial-overview" className="text-lg font-semibold">Sales overview</h2><p className="mt-1 text-sm text-zinc-500">Marketplace activity and Stripe transfers</p></div><ReportingRangeSelect value={range} onChange={onRangeChange} /></div><SummaryMetrics report={data} /><TopSongs rows={data.topSongs} /></section>
}

export function ProviderSalesReporting({range, onRangeChange}: {range: ReportingRange; onRangeChange: (range: ReportingRange) => void}) {
  const report = useProviderReport(range)
  if (report.isLoading) return <ReportingSkeleton />
  if (report.isError || !report.data) return <ReportingError message={report.error?.message || 'Sales reporting is unavailable'} />
  const data = report.data
  return <div className="space-y-9"><ReportingHeader title="Sales" detail="Understand what sold and where customers found it." range={range} onRangeChange={onRangeChange} /><SummaryMetrics report={data} /><TopSongs rows={data.topSongs} /><section><SectionTitle title="Sales by Day" detail="Gross sales and net provider earnings in UTC." /><ChartContainer config={salesChartConfig} className="mt-4 h-72 w-full aspect-auto"><LineChart data={data.salesByDay} margin={{left: 8, right: 8}}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="date" tickFormatter={shortDate} minTickGap={32} /><YAxis tickFormatter={compactMoney} width={64} /><ChartTooltip content={<ChartTooltipContent formatter={(value, name) => <div className="flex min-w-36 justify-between gap-4"><span>{salesChartConfig[name as keyof typeof salesChartConfig]?.label}</span><span className="font-mono">{money(Number(value))}</span></div>} />} /><Line type="monotone" dataKey="grossMinor" stroke="var(--color-grossMinor)" strokeWidth={2} dot={false} /><Line type="monotone" dataKey="earningsMinor" stroke="var(--color-earningsMinor)" strokeWidth={2} dot={false} /></LineChart></ChartContainer></section><ReportTable title="Sales by Release" headers={['Release', 'Units', 'Gross', 'Earnings', 'Refunds', 'Downloads']} rows={data.salesByRelease.map((row) => [<div key={row.releaseId}><p className="font-medium">{row.title}</p><p className="text-xs text-zinc-500">{row.artistName}</p></div>, number(row.units), money(row.grossMinor), money(row.earningsMinor), money(row.refundsMinor), number(row.downloads)])} empty="No release sales in this period." /><div className="grid gap-9 xl:grid-cols-2"><ReportTable title="Sales by Territory" headers={['Territory', 'Units', 'Gross', 'Earnings']} rows={data.salesByTerritory.map((row) => [territoryName(row.countryCode), number(row.units), money(row.grossMinor), money(row.earningsMinor)])} empty="No territory data in this period." /><ReportTable title="Downloads" headers={['Track', 'Release', 'Downloads']} rows={data.downloads.map((row) => [row.track_title, row.release_title, number(row.download_count)])} empty="No downloads in this period." /></div><ReportTable title="Refunds" headers={['Release', 'Sale date', 'Status', 'Amount']} rows={data.refunds.map((row) => [row.releaseTitle, formatDate(row.saleDate), row.status.replace(/_/g, ' '), money(row.amountMinor)])} empty="No refunds in this period." /></div>
}

export function ProviderEarningsReporting({range, onRangeChange}: {range: ReportingRange; onRangeChange: (range: ReportingRange) => void}) {
  const report = useProviderReport(range)
  if (report.isLoading) return <ReportingSkeleton />
  if (report.isError || !report.data) return <ReportingError message={report.error?.message || 'Earnings reporting is unavailable'} />
  const data = report.data
  const platformAndAdjustments = data.summary.grossSalesMinor - data.summary.earningsMinor
  return <div className="space-y-9"><ReportingHeader title="Earnings" detail="Reconcile marketplace sales, adjustments, transfers, and collaborator shares." range={range} onRangeChange={onRangeChange} /><SummaryMetrics report={data} /><section><SectionTitle title="Provider reconciliation" detail="Gross sales less MEJay fees, refunds, and lost disputes." /><dl className="mt-4 divide-y divide-white/10 border-y border-white/10"><ReconciliationRow label="Gross sales" value={data.summary.grossSalesMinor} /><ReconciliationRow label="Fees and adjustments" value={-platformAndAdjustments} /><ReconciliationRow label="Your earnings" value={data.summary.earningsMinor} emphasized /><ReconciliationRow label="Pending Stripe transfer" value={data.summary.pendingMinor} /><ReconciliationRow label="Paid to provider Stripe account" value={data.summary.paidOutMinor} /></dl></section><ReportTable title="Split recipient liabilities" headers={['Recipient', 'Role', 'Allocated', 'Refund adjustments', 'Owed']} rows={data.recipientLiabilities.map((row) => [<div key={row.email ?? `${row.name}-${row.role}`}><p className="font-medium">{row.name}</p><p className="text-xs text-zinc-500">{row.email || 'No account email'}</p></div>, row.role || '-', money(row.allocatedMinor), money(row.refundAdjustmentMinor), money(row.owedMinor)])} empty="No split allocations in this period." /><p className="text-xs leading-relaxed text-zinc-500">Paid Out tracks transfers to your provider Stripe account. Collaborator amounts remain owed by the provider until paid outside MEJay.</p></div>
}

function SummaryMetrics({report}: {report: ProviderSalesReport}) {
  const values = [['Gross Sales', money(report.summary.grossSalesMinor)], ['Units Sold', number(report.summary.unitsSold)], ['Your Earnings', money(report.summary.earningsMinor)], ['Pending', money(report.summary.pendingMinor)], ['Paid Out', money(report.summary.paidOutMinor)]]
  return <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{values.map(([label, value]) => <div key={label} className="rounded-md border border-white/10 bg-[#141417] p-5"><dt className="text-xs font-medium uppercase text-zinc-500">{label}</dt><dd className="mt-3 text-2xl font-bold tabular-nums">{value}</dd></div>)}</dl>
}

function TopSongs({rows}: {rows: ProviderSalesReport['topSongs']}) {
  return <section><SectionTitle title="Top Songs" detail="Units and net earnings allocated across release purchases." />{rows.length === 0 ? <EmptyLine text="No song sales in this period." /> : <div className="mt-4 divide-y divide-white/10 border-y border-white/10">{rows.slice(0, 5).map((row, index) => <div key={row.trackId ?? row.title} className="grid grid-cols-[2rem_1fr_auto_auto] items-center gap-4 py-3"><span className="text-xs text-zinc-600">{index + 1}</span><span className="truncate font-medium">{row.title}</span><span className="text-sm tabular-nums text-zinc-300">{number(row.units)}</span><span className="w-24 text-right text-sm tabular-nums text-zinc-500">{money(row.earningsMinor)}</span></div>)}</div>}</section>
}

function ReportTable({title, headers, rows, empty}: {title: string; headers: string[]; rows: React.ReactNode[][]; empty: string}) {
  return <section><h2 className="text-lg font-semibold">{title}</h2>{rows.length === 0 ? <EmptyLine text={empty} /> : <div className="mt-4 overflow-x-auto border-y border-white/10"><table className="w-full min-w-[640px] text-left text-sm"><thead><tr className="text-xs uppercase text-zinc-500">{headers.map((header) => <th key={header} className="px-3 py-3 font-medium">{header}</th>)}</tr></thead><tbody className="divide-y divide-white/10">{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex} className="px-3 py-3 text-zinc-300">{cell}</td>)}</tr>)}</tbody></table></div>}</section>
}

function ReportingHeader({title, detail, range, onRangeChange}: {title: string; detail: string; range: ReportingRange; onRangeChange: (range: ReportingRange) => void}) { return <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-bold">{title}</h1><p className="mt-1 text-sm text-zinc-400">{detail}</p></div><ReportingRangeSelect value={range} onChange={onRangeChange} /></div> }
function SectionTitle({title, detail}: {title: string; detail: string}) { return <div><h2 className="text-lg font-semibold">{title}</h2><p className="mt-1 text-sm text-zinc-500">{detail}</p></div> }
function ReconciliationRow({label, value, emphasized}: {label: string; value: number; emphasized?: boolean}) { return <div className={`flex items-center justify-between py-3 ${emphasized ? 'font-bold text-emerald-300' : 'text-zinc-300'}`}><dt>{label}</dt><dd className="tabular-nums">{money(value)}</dd></div> }
function EmptyLine({text}: {text: string}) { return <p className="mt-4 border-y border-dashed border-white/10 py-10 text-center text-sm text-zinc-500">{text}</p> }
function ReportingSkeleton() { return <div className="space-y-5"><Skeleton className="h-10 w-52 bg-white/5" /><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Array.from({length: 5}).map((_, index) => <Skeleton key={index} className="h-28 bg-white/5" />)}</div><Skeleton className="h-72 bg-white/5" /></div> }
function ReportingError({message}: {message: string}) { return <div role="alert" className="border border-red-400/30 bg-red-400/5 p-4 text-sm text-red-300">{message}</div> }
function money(amountMinor: number) { return new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(amountMinor / 100) }
function compactMoney(amountMinor: number) { return new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1}).format(amountMinor / 100) }
function number(value: number) { return new Intl.NumberFormat('en-US').format(value) }
function shortDate(value: string) { return new Intl.DateTimeFormat('en-US', {month: 'short', day: 'numeric', timeZone: 'UTC'}).format(new Date(`${value}T00:00:00Z`)) }
function formatDate(value: string) { return new Intl.DateTimeFormat('en-US', {year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC'}).format(new Date(value)) }
function territoryName(countryCode: string | null) { if (!countryCode) return 'Unknown'; try { return new Intl.DisplayNames(['en'], {type: 'region'}).of(countryCode) || countryCode } catch { return countryCode } }
