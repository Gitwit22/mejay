import {useState} from 'react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {ArrowDown, ArrowUp, BarChart3, BadgeDollarSign, Landmark, CheckCircle2, Copy, Copyright, Disc3, Download, Fingerprint, Menu, Plus, RefreshCw, Scale, Scissors, Send, ShieldAlert, Sparkles, Trash2, Users, UserRound, X, XCircle} from 'lucide-react'

import {ReleaseReviewDialog} from '@/app/components/admin/ReleaseReviewDialog'
import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {Input} from '@/components/ui/input'
import {Skeleton} from '@/components/ui/skeleton'
import {toast} from '@/hooks/use-toast'
import {getMarketplaceFinance, type MarketplaceFinanceFilters, commandMarketplaceProvider, commandMarketplaceRelease, recordSplitDispute, retryMarketplacePayouts, type ProviderAdminAction, createIndustryReportingBatch, downloadIndustryReportingBatch, downloadIsrcRegistryExport, getIndustryReporting, getIsrcRegistry, getIsrcRegistryRecord, getIsrcSequence, getMarketplaceAdminOverview, replaceMarketplaceDiscoveryFeatures, resolveIndustryReportingBatch, submitIndustryReportingBatch, validateIndustryReporting, type AdminRecord, type IndustryReportingDashboard, type IsrcRegistryRecord, type MarketplaceAdminOverview, type ReleaseAdminAction} from '@/lib/marketplaceAdminApi'

type Section = 'pending' | 'catalog' | 'discovery' | 'providers' | 'artists' | 'isrcs' | 'rights' | 'pricing' | 'splits' | 'takedowns' | 'reporting' | 'finance'

const navigation = [
  ['pending', 'Pending Releases', ShieldAlert], ['catalog', 'Live Catalog', Disc3], ['discovery', 'Discovery', Sparkles], ['providers', 'Providers', Users],
  ['artists', 'Artists', UserRound], ['isrcs', 'ISRC Registry', Fingerprint], ['rights', 'Rights Review', Copyright],
  ['pricing', 'Pricing', BadgeDollarSign], ['splits', 'Splits', Scissors], ['takedowns', 'Takedowns', Scale],
  ['reporting', 'Reporting', BarChart3], ['finance', 'Finance', Landmark],
] as const

export default function MarketplaceAdminPage() {
  const [section, setSection] = useState<Section>('pending')
  const [mobileOpen, setMobileOpen] = useState(false)
  const overview = useQuery({queryKey: ['marketplace-admin', 'overview'], queryFn: getMarketplaceAdminOverview})
  const activeLabel = navigation.find(([id]) => id === section)?.[1]

  return <div className="min-h-screen bg-[#09090b] text-zinc-100"><div className="flex min-h-screen">
    <aside className="hidden w-64 shrink-0 border-r border-white/10 bg-[#111114] p-5 lg:block"><Brand /><Navigation active={section} onSelect={setSection} /></aside>
    {mobileOpen && <div className="fixed inset-0 z-50 bg-black/70 lg:hidden" onClick={() => setMobileOpen(false)}><aside className="h-full w-[min(84vw,19rem)] bg-[#111114] p-5" onClick={(event) => event.stopPropagation()}><div className="flex justify-between"><Brand /><Button variant="ghost" size="icon" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X /></Button></div><Navigation active={section} onSelect={(value) => {setSection(value); setMobileOpen(false)}} /></aside></div>}
    <main className="min-w-0 flex-1"><header className="flex h-16 items-center gap-3 border-b border-white/10 px-4 sm:px-7"><Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu /></Button><div><p className="text-sm font-semibold">{activeLabel}</p><p className="text-xs text-zinc-500">Marketplace Admin</p></div><span className="ml-auto border border-white/10 px-2.5 py-1 text-xs uppercase text-zinc-400">{overview.data?.role || 'staff'}</span></header>
      <div className="mx-auto max-w-[1500px] p-4 sm:p-7">{overview.isLoading ? <Skeleton className="h-72 bg-white/5" /> : overview.isError ? <ErrorState message={overview.error.message} /> : overview.data ? <SectionView section={section} data={overview.data} /> : null}</div>
    </main>
  </div></div>
}

function Brand() { return <div className="mb-8"><p className="text-xl font-bold">MEJay</p><p className="text-xs font-medium uppercase text-emerald-400">Publishing Desk</p></div> }
function Navigation({active, onSelect}: {active: Section; onSelect: (section: Section) => void}) { return <nav className="space-y-1">{navigation.map(([id, label, Icon]) => <button key={id} type="button" onClick={() => onSelect(id)} className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm ${active === id ? 'bg-emerald-400 text-zinc-950' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}><Icon className="h-4 w-4" />{label}</button>)}</nav> }

function SectionView({section, data}: {section: Section; data: Awaited<ReturnType<typeof getMarketplaceAdminOverview>>}) {
  if (section === 'reporting') return <Reporting />
  if (section === 'finance') return <FinanceSection data={data} />
  if (section === 'discovery') return <DiscoveryCuration data={data} />
  if (section === 'isrcs') return <IsrcRegistrySection />
  if (section === 'providers') return <ProvidersSection rows={data.providers} role={data.role} />
  if (section === 'takedowns') return <RecordTable title="Takedowns" rows={data.takedowns} actionable role={data.role} renderActions={(row) => <TakedownActions row={row} role={data.role} />} />
  if (section === 'splits') return <RecordTable title="Splits" rows={data.splits} actionable={data.role === 'admin'} role={data.role} renderActions={(row) => <SplitDisputeAction row={row} />} />
  const rows = data[section]
  return <RecordTable title={navigation.find(([id]) => id === section)?.[1] || section} rows={rows} actionable={section === 'pending' || section === 'catalog'} role={data.role} />
}

const reviewableProviderStatuses = new Set(['pending_review', 'needs_changes', 'rejected'])

function ProvidersSection({rows, role}: {rows: AdminRecord[]; role: MarketplaceAdminOverview['role']}) {
  const queryClient = useQueryClient()
  const admin = role === 'admin'
  const command = useMutation({
    mutationFn: ({providerId, action, reason}: {providerId: string; action: ProviderAdminAction; reason?: string}) => commandMarketplaceProvider(providerId, {action, reason}),
    onSuccess: async (_data, variables) => {
      await queryClient.invalidateQueries({queryKey: ['marketplace-admin']})
      toast({title: `Provider ${variables.action === 'approve' ? 'approved' : variables.action === 'reject' ? 'rejected' : variables.action === 'suspend' ? 'suspended' : 'reinstated'}`})
    },
    onError: (error) => toast({title: 'Provider action failed', description: error.message, variant: 'destructive'}),
  })
  const payouts = useMutation({
    mutationFn: retryMarketplacePayouts,
    onSuccess: (result) => toast({title: 'Payout retry finished', description: `${result.transferred} paid, ${result.failed} failed of ${result.attempted} pending`}),
    onError: (error) => toast({title: 'Payout retry failed', description: error.message, variant: 'destructive'}),
  })
  const run = (providerId: string, action: ProviderAdminAction, needsReason: boolean) => {
    const reason = needsReason ? window.prompt(`Reason to ${action} this provider`)?.trim() : undefined
    if (needsReason && !reason) return
    command.mutate({providerId, action, reason})
  }
  const pendingCount = rows.filter((row) => row.status === 'pending_review').length
  return <div className="space-y-5">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-bold">Providers</h1><p className="mt-1 text-sm text-zinc-400">{pendingCount > 0 ? `${pendingCount} application${pendingCount === 1 ? '' : 's'} awaiting review.` : 'No applications awaiting review.'}</p></div>{admin && <Button variant="outline" disabled={payouts.isPending} onClick={() => payouts.mutate()}><RefreshCw className="h-4 w-4" />Retry pending payouts</Button>}</div>
    {rows.length === 0 ? <div className="border-y border-dashed border-white/10 py-16 text-center text-sm text-zinc-500">No providers yet.</div> : <div className="overflow-x-auto border-y border-white/10"><table className="w-full min-w-[860px] text-left text-sm"><thead className="text-xs uppercase text-zinc-500"><tr><th className="px-3 py-3 font-medium">Provider</th><th className="px-3 py-3 font-medium">Contact</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 font-medium">Payouts</th><th className="px-3 py-3 font-medium">Releases</th><th className="px-3 py-3 font-medium">Actions</th></tr></thead><tbody className="divide-y divide-white/10">{rows.map((row) => {
      const id = String(row.id)
      const status = String(row.status ?? '')
      const suspended = Boolean(row.suspended_at)
      return <tr key={id}><td className="px-3 py-3"><p className="text-zinc-200">{formatValue(row.display_name)}</p><p className="text-xs text-zinc-500">{formatValue(row.country_code)}</p></td><td className="px-3 py-3 text-zinc-300">{formatValue(row.contact_email)}</td><td className="px-3 py-3"><span className={status === 'approved' && !suspended ? 'text-emerald-300' : status === 'pending_review' ? 'text-amber-300' : 'text-zinc-300'}>{suspended ? 'Suspended' : status.replace(/_/g, ' ')}</span></td><td className="px-3 py-3 text-zinc-300">{row.stripe_payouts_enabled ? 'Enabled' : 'Not set up'}</td><td className="px-3 py-3 tabular-nums text-zinc-300">{formatValue(row.release_count)}</td><td className="px-3 py-3">{admin ? <div className="flex flex-wrap gap-2">
        {reviewableProviderStatuses.has(status) && <Button size="sm" className="bg-emerald-400 text-zinc-950 hover:bg-emerald-300" disabled={command.isPending} onClick={() => run(id, 'approve', false)}><CheckCircle2 className="h-4 w-4" />Approve</Button>}
        {reviewableProviderStatuses.has(status) && status !== 'rejected' && <Button size="sm" variant="outline" disabled={command.isPending} onClick={() => run(id, 'reject', true)}><XCircle className="h-4 w-4" />Reject</Button>}
        {status === 'approved' && <Button size="sm" variant="outline" disabled={command.isPending} onClick={() => run(id, suspended ? 'reinstate' : 'suspend', true)}>{suspended ? 'Reinstate' : 'Suspend'}</Button>}
      </div> : <span className="text-xs text-zinc-500">Admin only</span>}</td></tr>
    })}</tbody></table></div>}
  </div>
}

function DiscoveryCuration({data}: {data: MarketplaceAdminOverview}) {
  const queryClient = useQueryClient()
  const [releaseIds, setReleaseIds] = useState(() => data.discovery.featuredReleases.map((row) => String(row.id)))
  const [artistIds, setArtistIds] = useState(() => data.discovery.featuredArtists.map((row) => String(row.id)))
  const save = useMutation({
    mutationFn: () => replaceMarketplaceDiscoveryFeatures({releaseIds, artistIds}),
    onSuccess: async () => {await queryClient.invalidateQueries({queryKey: ['marketplace-admin']}); toast({title: 'Discovery picks saved'})},
    onError: (error) => toast({title: 'Discovery picks not saved', description: error.message, variant: 'destructive'}),
  })
  const readOnly = data.role !== 'admin'
  return <div className="space-y-7"><div><h1 className="text-2xl font-bold">Discovery</h1><p className="mt-1 text-sm text-zinc-400">Curate ordered releases and artists for MEJay Music.</p></div>
    <div className="grid gap-8 xl:grid-cols-2">
      <FeaturePicker title="Featured Releases" ids={releaseIds} onChange={setReleaseIds} candidates={data.discovery.eligibleReleases} labelKey="title" readOnly={readOnly} />
      <FeaturePicker title="Featured Artists" ids={artistIds} onChange={setArtistIds} candidates={data.discovery.eligibleArtists} labelKey="name" readOnly={readOnly} />
    </div>
    {readOnly ? <p className="text-sm text-zinc-500">Reviewer access is read-only.</p> : <Button className="bg-emerald-400 text-zinc-950 hover:bg-emerald-300" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving...' : 'Save discovery picks'}</Button>}
  </div>
}

function FeaturePicker({title, ids, onChange, candidates, labelKey, readOnly}: {title: string; ids: string[]; onChange: (ids: string[]) => void; candidates: AdminRecord[]; labelKey: 'title' | 'name'; readOnly: boolean}) {
  const [selected, setSelected] = useState('')
  const byId = new Map(candidates.map((row) => [String(row.id), row]))
  const available = candidates.filter((row) => !ids.includes(String(row.id)))
  const move = (index: number, direction: -1 | 1) => {const next = [...ids]; const target = index + direction; if (target < 0 || target >= next.length) return; [next[index], next[target]] = [next[target], next[index]]; onChange(next)}
  return <section className="border-y border-white/10 py-5"><h2 className="font-bold">{title}</h2><div className="mt-4 space-y-2">{ids.length === 0 ? <p className="py-4 text-sm text-zinc-500">No picks selected.</p> : ids.map((id, index) => <div key={id} className="flex items-center gap-2 bg-white/[0.03] px-3 py-2"><span className="w-6 text-xs text-zinc-600">{index + 1}</span><span className="min-w-0 flex-1 truncate text-sm">{String(byId.get(id)?.[labelKey] || id)}</span>{!readOnly && <><Button size="icon" variant="ghost" className="h-8 w-8" disabled={index === 0} onClick={() => move(index, -1)} aria-label={`Move ${id} up`}><ArrowUp className="h-4 w-4" /></Button><Button size="icon" variant="ghost" className="h-8 w-8" disabled={index === ids.length - 1} onClick={() => move(index, 1)} aria-label={`Move ${id} down`}><ArrowDown className="h-4 w-4" /></Button><Button size="icon" variant="ghost" className="h-8 w-8 text-red-300" onClick={() => onChange(ids.filter((item) => item !== id))} aria-label={`Remove ${id}`}><Trash2 className="h-4 w-4" /></Button></>}</div>)}</div>
    {!readOnly && <div className="mt-4 flex gap-2"><select value={selected} onChange={(event) => setSelected(event.target.value)} className="min-w-0 flex-1 rounded-md border border-white/10 bg-[#141417] px-3 text-sm"><option value="">Select...</option>{available.map((row) => <option key={String(row.id)} value={String(row.id)}>{String(row[labelKey])}</option>)}</select><Button variant="outline" size="icon" disabled={!selected} onClick={() => {onChange([...ids, selected]); setSelected('')}} aria-label={`Add to ${title}`}><Plus className="h-4 w-4" /></Button></div>}
  </section>
}

function RecordTable({title, rows, actionable, role, renderActions}: {title: string; rows: AdminRecord[]; actionable: boolean; role: 'reviewer' | 'admin'; renderActions?: (row: AdminRecord) => React.ReactNode}) {
  const [search, setSearch] = useState('')
  const filtered = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(search.toLowerCase()))
  return <div className="space-y-5"><div><h1 className="text-2xl font-bold">{title}</h1><p className="mt-1 text-sm text-zinc-400">{filtered.length} operational records</p></div><Input className="max-w-md" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${title.toLowerCase()}`} />
    {filtered.length === 0 ? <div className="border-y border-dashed border-white/10 py-16 text-center text-sm text-zinc-500">No records found.</div> : <div className="overflow-x-auto border-y border-white/10"><table className="w-full min-w-[720px] text-left text-sm"><thead className="text-xs uppercase text-zinc-500"><tr>{Object.keys(filtered[0]).slice(0, 6).map((key) => <th key={key} className="px-3 py-3 font-medium">{key.replace(/_/g, ' ')}</th>)}{actionable && <th className="px-3 py-3">Actions</th>}</tr></thead><tbody className="divide-y divide-white/10">{filtered.map((row, index) => <tr key={String(row.id ?? row.isrc ?? index)}>{Object.keys(filtered[0]).slice(0, 6).map((key) => <td key={key} className="max-w-64 truncate px-3 py-3 text-zinc-300">{formatValue(row[key])}</td>)}{actionable && <td className="px-3 py-3">{renderActions ? renderActions(row) : <ReleaseActions row={row} role={role} />}</td>}</tr>)}</tbody></table></div>}
  </div>
}

function ReleaseActions({row, role}: {row: AdminRecord; role: 'reviewer' | 'admin'}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({mutationFn: (input: {action: ReleaseAdminAction; note?: string; scheduledReleaseAt?: string}) => commandMarketplaceRelease(String(row.id), {expectedVersion: Number(row.version), ...input}), onSuccess: async () => {await queryClient.invalidateQueries({queryKey: ['marketplace-admin']}); toast({title: 'Release updated'})}, onError: (error) => toast({title: 'Action failed', description: error.message, variant: 'destructive'})})
  const status = String(row.status)
  const actions: Array<{action: ReleaseAdminAction; label: string; admin?: boolean; note?: boolean}> = status === 'SUBMITTED' ? []
    // Approve/reject live in the review dialog, next to the rights certification and documents.
    : status === 'UNDER_REVIEW' ? []
      : status === 'APPROVED' ? [{action: 'publish_now', label: 'Publish now', admin: true}, {action: 'schedule', label: 'Schedule', admin: true}]
        : status === 'SCHEDULED' ? [{action: 'publish_due', label: 'Publish due', admin: true}, {action: 'takedown', label: 'Takedown', admin: true, note: true}]
          : status === 'LIVE' ? [{action: 'unpublish', label: 'Unpublish', admin: true}, {action: 'takedown', label: 'Takedown', admin: true, note: true}] : []
  return <div className="flex gap-2">{['SUBMITTED', 'UNDER_REVIEW'].includes(status) && <ReleaseReviewDialog releaseId={String(row.id)} title={String(row.title ?? 'Release')} />}{actions.filter((item) => !item.admin || role === 'admin').map((item) => <Button key={item.action} size="sm" variant="outline" disabled={mutation.isPending} onClick={() => {
      if (item.action === 'schedule') {
        const raw = window.prompt('Release date and time (local), e.g. 2026-12-01 09:00')?.trim()
        if (!raw) return
        const when = new Date(raw.replace(' ', 'T'))
        if (Number.isNaN(when.getTime()) || when.getTime() <= Date.now()) {toast({title: 'Enter a future date and time', variant: 'destructive'}); return}
        mutation.mutate({action: 'schedule', scheduledReleaseAt: when.toISOString()})
        return
      }
      const note = item.note ? window.prompt(`${item.label} reason`)?.trim() : undefined; if (item.note && !note) return; mutation.mutate({action: item.action, note})
    }}>{item.label}</Button>)}</div>
}

function TakedownActions({row, role}: {row: AdminRecord; role: 'reviewer' | 'admin'}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationFn: (note: string) => commandMarketplaceRelease(String(row.release_id), {action: 'restore', expectedVersion: Number(row.release_version), note}),
    onSuccess: async () => {await queryClient.invalidateQueries({queryKey: ['marketplace-admin']}); toast({title: 'Release restored', description: 'It is back in Approved; publish or schedule it from Live Catalog.'})},
    onError: (error) => toast({title: 'Restore failed', description: error.message, variant: 'destructive'}),
  })
  if (role !== 'admin' || row.restored_at || row.release_status !== 'TAKEN_DOWN') return <span className="text-xs text-zinc-500">{row.restored_at ? 'Restored' : '-'}</span>
  return <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => {const note = window.prompt('Restore reason')?.trim(); if (note) mutation.mutate(note)}}>Restore</Button>
}

function SplitDisputeAction({row}: {row: AdminRecord}) {
  const mutation = useMutation({
    mutationFn: (input: {reason: string; orderId?: string}) => recordSplitDispute({providerId: String(row.provider_id), splitSetId: String(row.id), ...input}),
    onSuccess: () => toast({title: 'Split dispute recorded'}),
    onError: (error) => toast({title: 'Could not record dispute', description: error.message, variant: 'destructive'}),
  })
  return <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => {
    const reason = window.prompt('Dispute details')?.trim()
    if (!reason) return
    const orderId = window.prompt('Related order ID (optional)')?.trim() || undefined
    mutation.mutate({reason, orderId})
  }}>Record dispute</Button>
}

function IsrcRegistrySection() {
  const [filters, setFilters] = useState({isrc: '', track: '', artist: '', provider: '', year: ''})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const registry = useQuery({
    queryKey: ['marketplace-admin', 'isrc-registry', filters],
    queryFn: () => getIsrcRegistry(filters),
  })
  const sequence = useQuery({queryKey: ['marketplace-admin', 'isrc-sequence'], queryFn: getIsrcSequence})
  const detail = useQuery({
    queryKey: ['marketplace-admin', 'isrc-registry', selectedId],
    queryFn: () => getIsrcRegistryRecord(selectedId || ''),
    enabled: Boolean(selectedId),
  })
  const exportCsv = useMutation({
    mutationFn: () => downloadIsrcRegistryExport(filters),
    onError: (error) => toast({title: 'Export failed', description: error.message, variant: 'destructive'}),
  })
  const rows = registry.data ?? []
  const copyIsrc = async (value: string) => {
    await navigator.clipboard.writeText(value)
    toast({title: 'ISRC copied'})
  }
  return <div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold">ISRC Registry</h1>
        <p className="mt-1 text-sm text-zinc-400">Permanent ISRC assignments for every recording MEJay registers.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={exportCsv.isPending} onClick={() => exportCsv.mutate()}><Download className="h-4 w-4" />Export CSV</Button>
      </div>
    </div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <div className="border border-white/10 bg-[#141417] p-5">
        <p className="text-xs uppercase text-zinc-500">Next MEJay code</p>
        <p className="mt-3 font-mono text-lg">{sequence.data?.previewIsrc || 'QT-A3L-26-00001'}</p>
      </div>
      <div className="border border-white/10 bg-[#141417] p-5">
        <p className="text-xs uppercase text-zinc-500">Assignments shown</p>
        <p className="mt-3 text-3xl font-bold">{rows.length}</p>
      </div>
      <div className="border border-white/10 bg-[#141417] p-5">
        <p className="text-xs uppercase text-zinc-500">Sequence state</p>
        <p className="mt-3 text-sm text-zinc-300">{sequence.data ? `${sequence.data.prefix} / ${String(sequence.data.assignmentYear).slice(-2).padStart(2, '0')} → ${String(sequence.data.nextNumber).padStart(5, '0')}` : 'Loading...'}</p>
      </div>
    </div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
      <Input value={filters.isrc} onChange={(event) => setFilters({...filters, isrc: event.target.value})} placeholder="Search ISRC" />
      <Input value={filters.track} onChange={(event) => setFilters({...filters, track: event.target.value})} placeholder="Search track" />
      <Input value={filters.artist} onChange={(event) => setFilters({...filters, artist: event.target.value})} placeholder="Search artist" />
      <Input value={filters.provider} onChange={(event) => setFilters({...filters, provider: event.target.value})} placeholder="Search provider" />
      <Input value={filters.year} onChange={(event) => setFilters({...filters, year: event.target.value.replace(/[^0-9]/g, '').slice(0, 2)})} placeholder="Year" />
    </div>
    {registry.isLoading ? <Skeleton className="h-72 bg-white/5" /> : registry.isError ? <ErrorState message={registry.error.message} /> : rows.length === 0 ? <div className="border-y border-dashed border-white/10 py-16 text-center text-sm text-zinc-500">No registry records found.</div> : <div className="overflow-x-auto border-y border-white/10"><table className="w-full min-w-[920px] text-left text-sm"><thead className="text-xs uppercase text-zinc-500"><tr><th className="px-3 py-3 font-medium">ISRC</th><th className="px-3 py-3 font-medium">Track</th><th className="px-3 py-3 font-medium">Artist</th><th className="px-3 py-3 font-medium">Provider</th><th className="px-3 py-3 font-medium">Type</th><th className="px-3 py-3 font-medium">Assigned</th><th className="px-3 py-3 font-medium">Status</th><th className="px-3 py-3 font-medium">Actions</th></tr></thead><tbody className="divide-y divide-white/10">{rows.map((row) => <tr key={row.id}><td className="px-3 py-3 font-mono text-xs text-zinc-200">{formatRegistryIsrc(row.isrc)}</td><td className="px-3 py-3 text-zinc-300">{row.track || '-'}</td><td className="px-3 py-3 text-zinc-300">{row.artist || '-'}</td><td className="px-3 py-3 text-zinc-300">{row.provider || '-'}</td><td className="px-3 py-3 text-zinc-300">{row.type === 'MEJAY_ASSIGNED' ? 'MEJay' : 'External'}</td><td className="px-3 py-3 text-zinc-300">{formatDate(row.assigned)}</td><td className="px-3 py-3 text-zinc-300">{formatRegistryStatus(row.status)}</td><td className="px-3 py-3"><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setSelectedId(row.id)}>View Record</Button><Button size="sm" variant="outline" onClick={() => void copyIsrc(row.isrc)}><Copy className="h-4 w-4" />Copy ISRC</Button></div></td></tr>)}</tbody></table></div>}
    <Dialog open={Boolean(selectedId)} onOpenChange={(open) => !open && setSelectedId(null)}>
      <DialogContent className="border-white/10 bg-[#151518] text-zinc-100">
        <DialogHeader><DialogTitle>ISRC Record</DialogTitle></DialogHeader>
        {detail.isLoading ? <Skeleton className="h-48 bg-white/5" /> : detail.isError ? <ErrorState message={detail.error.message} /> : detail.data ? <dl className="grid gap-4 sm:grid-cols-2">{[
          ['ISRC', formatRegistryIsrc(detail.data.isrc)],
          ['Track', detail.data.track || '-'],
          ['Artist', detail.data.artist || '-'],
          ['Provider', detail.data.provider || '-'],
          ['Type', detail.data.assignmentType === 'MEJAY_ASSIGNED' ? 'MEJay' : 'External'],
          ['Status', formatRegistryStatus(detail.data.status)],
          ['Prefix', detail.data.prefix],
          ['Country', detail.data.countryCode || '-'],
          ['Registrant', detail.data.registrantCode || '-'],
          ['Year', String(detail.data.assignmentYear).padStart(2, '0')],
          ['Designation', detail.data.designationCode],
          ['Rights certification', detail.data.rightsCertificationId || '-'],
        ].map(([label, value]) => <div key={label}><dt className="text-xs uppercase text-zinc-500">{label}</dt><dd className="mt-1 text-sm text-zinc-200">{value}</dd></div>)}</dl> : null}
      </DialogContent>
    </Dialog>
  </div>
}

function Reporting() {
  const queryClient = useQueryClient()
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().slice(0, 10))
  const reporting = useQuery({queryKey: ['marketplace-admin', 'reporting', reportDate], queryFn: () => getIndustryReporting(reportDate)})
  const refresh = async () => queryClient.invalidateQueries({queryKey: ['marketplace-admin', 'reporting']})
  const mutation = useMutation({
    mutationFn: async (action: () => Promise<unknown>) => action(),
    onSuccess: refresh,
    onError: (error) => toast({title: 'Reporting action failed', description: error.message, variant: 'destructive'}),
  })
  if (reporting.isLoading) return <Skeleton className="h-72 bg-white/5" />
  if (reporting.isError || !reporting.data) return <ErrorState message={reporting.error?.message || 'Reporting is unavailable'} />
  const data = reporting.data
  const metrics: Array<[string, number]> = [
    ["Today's Sales", data.counts.todaySales],
    ['Ready', data.counts.ready],
    ['Metadata Errors', data.counts.metadataErrors],
    ['Submitted', data.counts.submitted],
    ['Rejected', data.counts.rejected],
  ]
  const admin = data.role === 'admin'
  return <div className="space-y-8">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-bold">Reporting</h1><p className="mt-1 text-sm text-zinc-400">Validate, export, and trace daily industry reporting events.</p></div><Input type="date" aria-label="Reporting date" className="w-44" value={reportDate} onChange={(event) => setReportDate(event.target.value)} /></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{metrics.map(([label, value]) => <div key={label} className="border border-white/10 bg-[#141417] p-5"><p className="text-xs uppercase text-zinc-500">{label}</p><p className="mt-3 text-3xl font-bold tabular-nums">{value}</p></div>)}</div>
    <div className="flex flex-wrap gap-2">{admin && <><Button variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate(() => validateIndustryReporting(reportDate))}><RefreshCw className="h-4 w-4" />Validate</Button><Button className="bg-emerald-400 text-zinc-950 hover:bg-emerald-300" disabled={mutation.isPending || data.counts.ready === 0} onClick={() => mutation.mutate(() => createIndustryReportingBatch(reportDate))}><Download className="h-4 w-4" />Create daily export</Button></>}</div>
    <ReportingEvents events={data.events} />
    <ReportingBatches data={data} pending={mutation.isPending} run={(action) => mutation.mutate(action)} />
  </div>
}

function ReportingEvents({events}: {events: IndustryReportingDashboard['events']}) {
  return <section><h2 className="text-lg font-semibold">Sales ledger trace</h2><p className="mt-1 text-sm text-zinc-500">Stripe transaction to MEJay ledger, track identifier, and reporting event.</p>{events.length === 0 ? <div className="mt-4 border-y border-dashed border-white/10 py-12 text-center text-sm text-zinc-500">No reporting events for this date.</div> : <div className="mt-4 overflow-x-auto border-y border-white/10"><table className="w-full min-w-[1050px] text-left text-sm"><thead><tr className="text-xs uppercase text-zinc-500"><th className="px-3 py-3">Status</th><th className="px-3 py-3">Sale / Refund</th><th className="px-3 py-3">Artist / Release / Track</th><th className="px-3 py-3">ISRC / UPC</th><th className="px-3 py-3">Price</th><th className="px-3 py-3">Territory</th><th className="px-3 py-3">Transaction trace</th></tr></thead><tbody className="divide-y divide-white/10">{events.map((event) => <tr key={event.id}><td className="px-3 py-3"><span className={event.validationStatus === 'ready' ? 'text-emerald-300' : 'text-amber-300'}>{event.validationStatus === 'metadata_error' ? 'Metadata error' : event.validationStatus}</span>{event.validationErrors.length > 0 && <p className="mt-1 max-w-48 text-xs text-zinc-500">{event.validationErrors.join(', ').replace(/_/g, ' ')}</p>}</td><td className="px-3 py-3 capitalize">{event.eventType}</td><td className="px-3 py-3"><p>{event.trackTitle}</p><p className="text-xs text-zinc-500">{event.artistName} · {event.releaseTitle}</p></td><td className="px-3 py-3 font-mono text-xs"><p>{event.isrc || '-'}</p><p className="text-zinc-500">{event.upc || '-'}</p></td><td className="px-3 py-3 tabular-nums">{money(event.priceMinor)}</td><td className="px-3 py-3">{event.territory || 'Unknown'}</td><td className="px-3 py-3 font-mono text-xs"><p title={event.transactionId}>{shortId(event.transactionId)}</p><p className="text-zinc-500" title={event.ledgerTransactionId}>{shortId(event.ledgerTransactionId)}</p></td></tr>)}</tbody></table></div>}</section>
}

function ReportingBatches({data, pending, run}: {data: IndustryReportingDashboard; pending: boolean; run: (action: () => Promise<unknown>) => void}) {
  return <section><h2 className="text-lg font-semibold">Daily reporting batches</h2>{data.batches.length === 0 ? <p className="mt-4 border-y border-dashed border-white/10 py-10 text-center text-sm text-zinc-500">No exports created yet.</p> : <div className="mt-4 overflow-x-auto border-y border-white/10"><table className="w-full min-w-[760px] text-left text-sm"><thead><tr className="text-xs uppercase text-zinc-500"><th className="px-3 py-3">Report date</th><th className="px-3 py-3">Events</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Reason</th><th className="px-3 py-3">Actions</th></tr></thead><tbody className="divide-y divide-white/10">{data.batches.map((batch) => <tr key={batch.id}><td className="px-3 py-3">{batch.report_date}</td><td className="px-3 py-3 tabular-nums">{batch.event_count}</td><td className="px-3 py-3 capitalize">{batch.status}</td><td className="px-3 py-3 text-zinc-500">{batch.rejection_reason || '-'}</td><td className="px-3 py-3"><div className="flex gap-2"><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => downloadIndustryReportingBatch(batch.id))}><Download className="h-4 w-4" />Export</Button>{data.role === 'admin' && (batch.status === 'exported' || batch.status === 'rejected') && <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => submitIndustryReportingBatch(batch.id))}><Send className="h-4 w-4" />Submit</Button>}{data.role === 'admin' && batch.status === 'submitted' && <><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => resolveIndustryReportingBatch(batch.id, 'accepted'))}><CheckCircle2 className="h-4 w-4" />Accept</Button><Button size="sm" variant="outline" disabled={pending} onClick={() => {const reason = window.prompt('Rejection reason')?.trim(); if (reason) run(() => resolveIndustryReportingBatch(batch.id, 'rejected', reason))}}><XCircle className="h-4 w-4" />Reject</Button></>}</div></td></tr>)}</tbody></table></div>}</section>
}

const financeStatuses = [['', 'All statuses'], ['paid', 'Paid'], ['partially_refunded', 'Partially refunded'], ['refunded', 'Refunded'], ['disputed', 'Disputed']] as const

/** Read-only finance view. Amounts come from immutable order and ledger records; nothing here edits them. */
function FinanceSection({data}: {data: MarketplaceAdminOverview}) {
  const [filters, setFilters] = useState<MarketplaceFinanceFilters>({})
  const finance = useQuery({queryKey: ['marketplace-admin', 'finance', filters], queryFn: () => getMarketplaceFinance(filters)})
  const update = (key: keyof MarketplaceFinanceFilters, value: string) => setFilters((current) => ({...current, [key]: value || undefined}))
  const selectClass = 'h-10 rounded-md border border-white/10 bg-[#141417] px-3 text-sm text-zinc-200'
  const releases = [...new Map([...data.catalog, ...data.takedowns.filter((row) => row.release_id)]
    .map((row) => [String(row.release_id ?? row.id), String(row.title ?? row.release_title ?? row.id)] as const)).entries()]
    .map(([id, title]) => ({id, title}))
  return <div className="space-y-7">
    <div><h1 className="text-2xl font-bold">Finance</h1><p className="mt-1 text-sm text-zinc-400">Marketplace sales, Stripe fees, artist allocations, and MEJay revenue. Dates are UTC sale dates.</p></div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="text-xs text-zinc-500">From<Input type="date" className="mt-1 w-40" value={filters.from ?? ''} onChange={(event) => update('from', event.target.value)} /></label>
      <label className="text-xs text-zinc-500">To<Input type="date" className="mt-1 w-40" value={filters.to ?? ''} onChange={(event) => update('to', event.target.value)} /></label>
      <label className="text-xs text-zinc-500">Artist account<select className={`mt-1 block ${selectClass}`} value={filters.providerId ?? ''} onChange={(event) => update('providerId', event.target.value)}><option value="">All artist accounts</option>{data.providers.map((row) => <option key={String(row.id)} value={String(row.id)}>{formatValue(row.display_name)}</option>)}</select></label>
      <label className="text-xs text-zinc-500">Release<select className={`mt-1 block ${selectClass}`} value={filters.releaseId ?? ''} onChange={(event) => update('releaseId', event.target.value)}><option value="">All releases</option>{releases.map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}</select></label>
      <label className="text-xs text-zinc-500">Status<select className={`mt-1 block ${selectClass}`} value={filters.status ?? ''} onChange={(event) => update('status', event.target.value)}>{financeStatuses.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div>
    {finance.isLoading ? <Skeleton className="h-72 bg-white/5" /> : finance.isError || !finance.data ? <ErrorState message={finance.error?.message || 'Finance reporting is unavailable'} /> : <FinanceReport summary={finance.data} />}
  </div>
}

function FinanceReport({summary}: {summary: Awaited<ReturnType<typeof getMarketplaceFinance>>}) {
  const totals = summary.totals
  const metrics: Array<[string, string, string?]> = [
    ['Gross Marketplace Sales', money(totals.grossSalesMinor), `${totals.orders} orders`],
    ['Stripe Fees', money(totals.stripeFeesMinor), totals.ordersWithUnknownStripeFee ? `${totals.ordersWithUnknownStripeFee} not yet reported by Stripe` : undefined],
    ['Artist Allocations', money(totals.artistAllocationMinor), `${money(totals.artistEarningsAfterAdjustmentsMinor)} after refunds and disputes`],
    ['MEJay Commission', money(totals.platformCommissionMinor), `+${money(totals.processingFeesRecoveredMinor)} Stripe fees recovered from artists`],
    ['MEJay Net Revenue', money(totals.netPlatformRevenueMinor), 'After refunds, lost disputes, and Stripe fees'],
    ['Refunds', money(totals.refundsMinor), `${totals.refundedOrders} orders`],
    ['Disputes', `${totals.disputes.open} open · ${totals.disputes.lost} lost`, `${money(totals.disputes.openAmountMinor)} open, ${money(totals.disputes.lostAmountMinor)} lost, ${totals.disputes.won} won`],
    ['Failed Payments', String(totals.failedPayments), 'Checkout payments that did not complete'],
    ['Pending Transfers', money(totals.pendingTransfers.amountMinor), `${totals.pendingTransfers.count} pending · ${totals.failedTransfers.count} failed (${money(totals.failedTransfers.amountMinor)})`],
  ]
  return <div className="space-y-7">
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{metrics.map(([label, value, detail]) => <div key={label} className="border border-white/10 bg-[#141417] p-5"><dt className="text-xs uppercase text-zinc-500">{label}</dt><dd className="mt-3 text-2xl font-bold tabular-nums">{value}</dd>{detail && <dd className="mt-1 text-xs text-zinc-500">{detail}</dd>}</div>)}</dl>
    <section><h2 className="text-lg font-semibold">Transactions</h2><p className="mt-1 text-sm text-zinc-500">Latest {summary.transactions.length} orders. Sale amounts are fixed at the time of purchase; refunds and disputes are recorded separately.</p>
      {summary.transactions.length === 0 ? <div className="mt-4 border-y border-dashed border-white/10 py-12 text-center text-sm text-zinc-500">No orders match these filters.</div> : <div className="mt-4 overflow-x-auto border-y border-white/10"><table className="w-full min-w-[1100px] text-left text-sm"><thead className="text-xs uppercase text-zinc-500"><tr><th className="px-3 py-3">Date</th><th className="px-3 py-3">Release</th><th className="px-3 py-3">Artist account</th><th className="px-3 py-3">Gross</th><th className="px-3 py-3">Commission</th><th className="px-3 py-3">Stripe fee</th><th className="px-3 py-3">Artist</th><th className="px-3 py-3">Refunded</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Order</th></tr></thead><tbody className="divide-y divide-white/10">{summary.transactions.map((row) => <tr key={row.orderId}><td className="px-3 py-3">{formatDate(row.paidAt)}</td><td className="px-3 py-3"><p>{row.songTitle ?? row.releaseTitle}</p><p className="text-xs text-zinc-500">{row.songTitle ? `Song · ${row.releaseTitle} · ` : ''}{row.artistName}</p></td><td className="px-3 py-3 text-zinc-300">{row.providerName ?? '-'}</td><td className="px-3 py-3 tabular-nums">{money(row.grossMinor)}</td><td className="px-3 py-3 tabular-nums">{money(row.platformCommissionMinor)}</td><td className="px-3 py-3 tabular-nums">{row.stripeFeeMinor === null ? 'Pending' : money(row.stripeFeeMinor)}</td><td className="px-3 py-3 tabular-nums">{money(row.artistAllocationMinor)}</td><td className="px-3 py-3 tabular-nums">{row.refundedMinor ? money(row.refundedMinor) : '-'}</td><td className="px-3 py-3 capitalize"><p>{row.paymentStatus.replace(/_/g, ' ')}</p><p className="text-xs text-zinc-500">Transfer {row.transferStatus}{row.disputeStatus !== 'none' ? ` · dispute ${row.disputeStatus}` : ''}{row.livemode === false ? ' · test' : ''}</p></td><td className="px-3 py-3 font-mono text-xs" title={row.orderId}>{shortId(row.orderId)}</td></tr>)}</tbody></table></div>}
    </section>
  </div>
}

function money(amountMinor: number) { return new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(amountMinor / 100) }
function shortId(value: string) { return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value }
function formatValue(value: unknown) { if (value === null || value === '') return '-'; if (typeof value === 'boolean') return value ? 'Yes' : 'No'; return String(value) }
function formatRegistryIsrc(value: string) { return value.length === 12 ? `${value.slice(0, 2)}-${value.slice(2, 5)}-${value.slice(5, 7)}-${value.slice(7)}` : value }
function formatRegistryStatus(value: IsrcRegistryRecord['status']) { return value.charAt(0) + value.slice(1).toLowerCase() }
function formatDate(value: string) { return new Date(value).toLocaleDateString('en-US', {month: 'short', day: 'numeric'}) }
function ErrorState({message}: {message: string}) { return <div role="alert" className="border border-red-400/30 bg-red-400/5 p-4 text-sm text-red-300">{message}</div> }