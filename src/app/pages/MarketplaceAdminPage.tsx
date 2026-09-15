import {useState} from 'react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {BarChart3, BadgeDollarSign, Copyright, Disc3, Fingerprint, Menu, Scale, Scissors, ShieldAlert, Users, UserRound, X} from 'lucide-react'

import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Skeleton} from '@/components/ui/skeleton'
import {toast} from '@/hooks/use-toast'
import {commandMarketplaceRelease, getMarketplaceAdminOverview, type AdminRecord, type ReleaseAdminAction} from '@/lib/marketplaceAdminApi'

type Section = 'pending' | 'catalog' | 'providers' | 'artists' | 'isrcs' | 'rights' | 'pricing' | 'splits' | 'takedowns' | 'reporting'

const navigation = [
  ['pending', 'Pending Releases', ShieldAlert], ['catalog', 'Live Catalog', Disc3], ['providers', 'Providers', Users],
  ['artists', 'Artists', UserRound], ['isrcs', 'ISRC Registry', Fingerprint], ['rights', 'Rights Review', Copyright],
  ['pricing', 'Pricing', BadgeDollarSign], ['splits', 'Splits', Scissors], ['takedowns', 'Takedowns', Scale],
  ['reporting', 'Reporting', BarChart3],
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
  if (section === 'reporting') return <Reporting counts={data.counts} />
  const rows = data[section]
  return <RecordTable title={navigation.find(([id]) => id === section)?.[1] || section} rows={rows} actionable={section === 'pending' || section === 'catalog'} role={data.role} />
}

function RecordTable({title, rows, actionable, role}: {title: string; rows: AdminRecord[]; actionable: boolean; role: 'reviewer' | 'admin'}) {
  const [search, setSearch] = useState('')
  const filtered = rows.filter((row) => JSON.stringify(row).toLowerCase().includes(search.toLowerCase()))
  return <div className="space-y-5"><div><h1 className="text-2xl font-bold">{title}</h1><p className="mt-1 text-sm text-zinc-400">{filtered.length} operational records</p></div><Input className="max-w-md" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${title.toLowerCase()}`} />
    {filtered.length === 0 ? <div className="border-y border-dashed border-white/10 py-16 text-center text-sm text-zinc-500">No records found.</div> : <div className="overflow-x-auto border-y border-white/10"><table className="w-full min-w-[720px] text-left text-sm"><thead className="text-xs uppercase text-zinc-500"><tr>{Object.keys(filtered[0]).slice(0, 6).map((key) => <th key={key} className="px-3 py-3 font-medium">{key.replace(/_/g, ' ')}</th>)}{actionable && <th className="px-3 py-3">Actions</th>}</tr></thead><tbody className="divide-y divide-white/10">{filtered.map((row, index) => <tr key={String(row.id ?? row.isrc ?? index)}>{Object.keys(filtered[0]).slice(0, 6).map((key) => <td key={key} className="max-w-64 truncate px-3 py-3 text-zinc-300">{formatValue(row[key])}</td>)}{actionable && <td className="px-3 py-3"><ReleaseActions row={row} role={role} /></td>}</tr>)}</tbody></table></div>}
  </div>
}

function ReleaseActions({row, role}: {row: AdminRecord; role: 'reviewer' | 'admin'}) {
  const queryClient = useQueryClient()
  const mutation = useMutation({mutationFn: (input: {action: ReleaseAdminAction; note?: string}) => commandMarketplaceRelease(String(row.id), {expectedVersion: Number(row.version), ...input}), onSuccess: async () => {await queryClient.invalidateQueries({queryKey: ['marketplace-admin']}); toast({title: 'Release updated'})}, onError: (error) => toast({title: 'Action failed', description: error.message, variant: 'destructive'})})
  const status = String(row.status)
  const actions: Array<{action: ReleaseAdminAction; label: string; admin?: boolean; note?: boolean}> = status === 'SUBMITTED' ? [{action: 'start_review', label: 'Start review'}]
    : status === 'UNDER_REVIEW' ? [{action: 'approve', label: 'Approve'}, {action: 'request_changes', label: 'Request changes', note: true}, {action: 'reject', label: 'Reject', note: true}]
      : status === 'APPROVED' ? [{action: 'publish_now', label: 'Publish now', admin: true}]
        : status === 'SCHEDULED' ? [{action: 'publish_due', label: 'Publish due', admin: true}, {action: 'takedown', label: 'Takedown', admin: true, note: true}]
          : status === 'LIVE' ? [{action: 'unpublish', label: 'Unpublish', admin: true}, {action: 'takedown', label: 'Takedown', admin: true, note: true}] : []
  return <div className="flex gap-2">{actions.filter((item) => !item.admin || role === 'admin').map((item) => <Button key={item.action} size="sm" variant="outline" disabled={mutation.isPending} onClick={() => {const note = item.note ? window.prompt(`${item.label} reason`)?.trim() : undefined; if (item.note && !note) return; mutation.mutate({action: item.action, note})}}>{item.label}</Button>)}</div>
}

function Reporting({counts}: {counts: AdminRecord}) { return <div className="space-y-5"><div><h1 className="text-2xl font-bold">Operational reporting</h1><p className="mt-1 text-sm text-zinc-400">Catalog activity only. Commerce and royalty reporting require a future ledger.</p></div><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{Object.entries(counts).map(([label, value]) => <div key={label} className="border border-white/10 bg-[#141417] p-5"><p className="text-xs uppercase text-zinc-500">{label.replace(/_/g, ' ')}</p><p className="mt-3 text-3xl font-bold">{formatValue(value)}</p></div>)}</div></div> }
function formatValue(value: unknown) { if (value === null || value === '') return '-'; if (typeof value === 'boolean') return value ? 'Yes' : 'No'; return String(value) }
function ErrorState({message}: {message: string}) { return <div role="alert" className="border border-red-400/30 bg-red-400/5 p-4 text-sm text-red-300">{message}</div> }