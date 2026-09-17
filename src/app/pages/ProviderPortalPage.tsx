import {useState} from 'react'
import {useNavigate, useSearchParams} from 'react-router-dom'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {
  BadgeDollarSign,
  Banknote,
  BarChart3,
  ChevronRight,
  Disc3,
  ExternalLink,
  Fingerprint,
  LayoutDashboard,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Users,
  WalletCards,
  X,
} from 'lucide-react'

import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@/components/ui/select'
import {Skeleton} from '@/components/ui/skeleton'
import {toast} from '@/hooks/use-toast'
import {getProviderStatusLabel, parseProviderStatus} from '@/lib/marketplace'
import {getConnectStatus, openConnectDashboard, startConnectOnboarding} from '@/lib/marketplaceCommerceApi'
import {ProviderEarningsReporting, ProviderOverviewReporting, ProviderSalesReporting} from '@/app/components/provider/ProviderReporting'
import {
  createProviderArtist,
  createProviderRelease,
  getProviderDashboard,
  listProviderArtists,
  listProviderReleases,
  type ProviderArtist,
  type ReportingRange,
} from '@/lib/providerApi'

type Section = 'overview' | 'artists' | 'releases' | 'sales' | 'earnings' | 'isrcs' | 'payout' | 'settings'

const navigation: Array<{id: Section; label: string; icon: typeof LayoutDashboard}> = [
  {id: 'overview', label: 'Overview', icon: LayoutDashboard},
  {id: 'artists', label: 'My Artists', icon: Users},
  {id: 'releases', label: 'My Releases', icon: Disc3},
  {id: 'sales', label: 'Sales', icon: BarChart3},
  {id: 'earnings', label: 'Earnings', icon: Banknote},
  {id: 'isrcs', label: 'ISRCs', icon: Fingerprint},
  {id: 'payout', label: 'Payout Account', icon: WalletCards},
  {id: 'settings', label: 'Settings', icon: Settings},
]

export default function ProviderPortalPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedSection = searchParams.get('section')
  const section: Section = navigation.some((item) => item.id === requestedSection) ? requestedSection as Section : 'overview'
  const requestedRange = searchParams.get('range')
  const range: ReportingRange = ['7d', '30d', '90d', 'ytd', 'all'].includes(requestedRange ?? '') ? requestedRange as ReportingRange : '30d'
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const dashboard = useQuery({queryKey: ['provider', 'dashboard'], queryFn: getProviderDashboard})
  const setSection = (next: Section) => setSearchParams((current) => {
    const params = new URLSearchParams(current)
    if (next === 'overview') params.delete('section')
    else params.set('section', next)
    return params
  })
  const setRange = (next: ReportingRange) => setSearchParams((current) => {
    const params = new URLSearchParams(current)
    if (next === '30d') params.delete('range')
    else params.set('range', next)
    return params
  })

  return (
    <div className="min-h-screen bg-[#09090b] text-zinc-100">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 shrink-0 border-r border-white/10 bg-[#111114] p-5 lg:flex lg:flex-col">
          <PortalBrand />
          <PortalNavigation active={section} onSelect={setSection} />
          <div className="mt-auto border-t border-white/10 pt-4 text-xs text-zinc-500">
            {dashboard.data?.provider.display_name || 'Artist account'}
          </div>
        </aside>

        {mobileNavOpen && (
          <div className="fixed inset-0 z-50 bg-black/70 lg:hidden" onClick={() => setMobileNavOpen(false)}>
            <aside className="h-full w-[min(82vw,19rem)] bg-[#111114] p-5" onClick={(event) => event.stopPropagation()}>
              <div className="flex items-start justify-between">
                <PortalBrand />
                <Button variant="ghost" size="icon" aria-label="Close navigation" onClick={() => setMobileNavOpen(false)}><X /></Button>
              </div>
              <PortalNavigation active={section} onSelect={(next) => { setSection(next); setMobileNavOpen(false) }} />
            </aside>
          </div>
        )}

        <main className="min-w-0 flex-1">
          <header className="flex h-16 items-center gap-3 border-b border-white/10 px-4 sm:px-7">
            <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={() => setMobileNavOpen(true)}><Menu /></Button>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{navigation.find((item) => item.id === section)?.label}</p>
              <p className="text-xs text-zinc-500">Provider Portal</p>
            </div>
            <div className="ml-auto rounded-full border border-white/10 px-3 py-1 text-xs text-zinc-300">
              {dashboard.data ? getProviderStatusLabel(parseProviderStatus(dashboard.data.provider.status)) : 'Loading'}
            </div>
          </header>

          <div className="mx-auto max-w-7xl p-4 sm:p-7">
            {dashboard.isError ? <ErrorState message={dashboard.error.message} /> : (
              <PortalSection section={section} dashboard={dashboard.data} loading={dashboard.isLoading} onNavigate={setSection} range={range} onRangeChange={setRange} />
            )}
          </div>
        </main>
      </div>
    </div>
  )
}

function PortalBrand() {
  return <div className="mb-8"><p className="text-xl font-bold">MEJay</p><p className="text-xs font-medium uppercase text-emerald-400">Provider Portal</p></div>
}

function PortalNavigation({active, onSelect}: {active: Section; onSelect: (section: Section) => void}) {
  return <nav className="space-y-1" aria-label="Provider portal">
    {navigation.map((item) => {
      const Icon = item.icon
      return <button key={item.id} type="button" onClick={() => onSelect(item.id)} className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm transition ${active === item.id ? 'bg-emerald-400 text-zinc-950' : 'text-zinc-400 hover:bg-white/5 hover:text-white'}`}>
        <Icon className="h-4 w-4" />{item.label}
      </button>
    })}
  </nav>
}

function PortalSection({section, dashboard, loading, onNavigate, range, onRangeChange}: {section: Section; dashboard?: Awaited<ReturnType<typeof getProviderDashboard>>; loading: boolean; onNavigate: (section: Section) => void; range: ReportingRange; onRangeChange: (range: ReportingRange) => void}) {
  if (section === 'overview') return <Overview dashboard={dashboard} loading={loading} onNavigate={onNavigate} range={range} onRangeChange={onRangeChange} />
  if (section === 'artists') return <Artists />
  if (section === 'releases') return <Releases />
  if (section === 'sales') return <ProviderSalesReporting range={range} onRangeChange={onRangeChange} />
  if (section === 'earnings') return <ProviderEarningsReporting range={range} onRangeChange={onRangeChange} />
  if (section === 'payout') return <PayoutAccount />
  const labels: Record<Exclude<Section, 'overview' | 'artists' | 'releases' | 'sales' | 'earnings' | 'payout'>, {title: string; detail: string}> = {
    isrcs: {title: 'ISRC registry is next', detail: 'Assigned and imported ISRC history will appear here as release creation comes online.'},
    settings: {title: 'Provider settings are next', detail: 'Business identity, contact, and team settings will be managed here.'},
  }
  const state = labels[section]
  return <EmptyState title={state.title} detail={state.detail} />
}

function PayoutAccount() {
  const queryClient = useQueryClient()
  const connect = useQuery({queryKey: ['provider', 'connect'], queryFn: getConnectStatus, retry: false})
  const onboarding = useMutation({
    mutationFn: startConnectOnboarding,
    onError: (error) => toast({title: 'Could not open Stripe', description: error.message, variant: 'destructive'}),
  })
  const dashboard = useMutation({
    mutationFn: openConnectDashboard,
    onError: (error) => toast({title: 'Could not open Stripe', description: error.message, variant: 'destructive'}),
  })
  if (connect.isLoading) return <Skeleton className="h-72 bg-white/5" />
  if (connect.isError || !connect.data) return <ErrorState message={connect.error?.message || 'Payout status is unavailable'} />
  const state = connect.data
  const due = state.requirements.currently_due ?? []
  return <div className="space-y-7">
    <div><h1 className="text-2xl font-bold">Payout Account</h1><p className="mt-1 text-sm text-zinc-400">Stripe verifies your identity and sends marketplace proceeds to your bank.</p></div>
    <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
      <div className="rounded-md border border-white/10 bg-[#141417] p-5">
        <div className="flex flex-wrap items-center gap-3"><p className="font-semibold">Stripe Connect</p><span className={`rounded-full border px-2.5 py-1 text-xs ${state.purchaseReady ? 'border-emerald-400/40 text-emerald-300' : 'border-amber-400/40 text-amber-300'}`}>{state.purchaseReady ? 'Ready for sales' : state.connected ? 'Action required' : 'Not connected'}</span></div>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-3"><StatusDatum label="Identity" ready={state.detailsSubmitted} /><StatusDatum label="Payouts" ready={state.payoutsEnabled} /><StatusDatum label="Transfers" ready={state.transfersStatus === 'active'} /></dl>
        {!state.purchaseReady && <p className="mt-5 text-sm text-zinc-400">Stripe must enable payouts and transfers before you can submit or publish a release for sale.</p>}
        {due.length > 0 && <div className="mt-5 border-t border-white/10 pt-4"><p className="text-xs font-semibold uppercase text-zinc-500">Required by Stripe</p><ul className="mt-2 space-y-1 text-sm text-zinc-300">{due.map((requirement) => <li key={requirement}>{requirement.replace(/\./g, ' / ').replace(/_/g, ' ')}</li>)}</ul></div>}
      </div>
      <div className="flex gap-2 md:flex-col">
        <Button className="gap-2 bg-emerald-400 text-zinc-950 hover:bg-emerald-300" disabled={onboarding.isPending} onClick={() => onboarding.mutate()}><ExternalLink className="h-4 w-4" />{state.connected ? 'Continue setup' : 'Connect Stripe'}</Button>
        {state.connected && <Button variant="outline" className="gap-2" disabled={dashboard.isPending} onClick={() => dashboard.mutate()}><ExternalLink className="h-4 w-4" />Stripe dashboard</Button>}
        <Button variant="ghost" className="gap-2" disabled={connect.isFetching} onClick={() => void queryClient.invalidateQueries({queryKey: ['provider', 'connect']})}><RefreshCw className={`h-4 w-4 ${connect.isFetching ? 'animate-spin' : ''}`} />Refresh</Button>
      </div>
    </div>
  </div>
}

function StatusDatum({label, ready}: {label: string; ready: boolean}) {
  return <div><dt className="text-xs uppercase text-zinc-500">{label}</dt><dd className={`mt-1 font-medium ${ready ? 'text-emerald-300' : 'text-zinc-300'}`}>{ready ? 'Complete' : 'Pending'}</dd></div>
}

function Overview({dashboard, loading, onNavigate, range, onRangeChange}: {dashboard?: Awaited<ReturnType<typeof getProviderDashboard>>; loading: boolean; onNavigate: (section: Section) => void; range: ReportingRange; onRangeChange: (range: ReportingRange) => void}) {
  if (loading) return <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Array.from({length: 5}).map((_, index) => <Skeleton key={index} className="h-28 bg-white/5" />)}</div>
  const counts = dashboard?.counts
  const stats = [
    ['Artists', counts?.artists ?? 0], ['Releases', counts?.releases ?? 0], ['Drafts', counts?.drafts ?? 0], ['Live', counts?.live_releases ?? 0], ['ISRCs', counts?.active_isrcs ?? 0],
  ]
  return <div className="space-y-8">
    <div><h1 className="text-2xl font-bold">Overview</h1><p className="mt-1 text-sm text-zinc-400">Your marketplace performance and catalog at a glance.</p></div>
    <ProviderOverviewReporting range={range} onRangeChange={onRangeChange} />
    <div className="border-t border-white/10 pt-7"><h2 className="text-lg font-semibold">Catalog</h2></div>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{stats.map(([label, value]) => <div key={label} className="rounded-md border border-white/10 bg-[#141417] p-5"><p className="text-xs uppercase text-zinc-500">{label}</p><p className="mt-3 text-3xl font-bold">{value}</p></div>)}</div>
    <div className="border-t border-white/10 pt-7"><h2 className="text-lg font-semibold">Get moving</h2><div className="mt-4 grid gap-3 md:grid-cols-2">
      <ActionRow title="Manage artist profiles" detail="Create the artist identities used across your releases." onClick={() => onNavigate('artists')} />
      <ActionRow title="Prepare a release" detail="Create a draft and begin assembling release metadata." onClick={() => onNavigate('releases')} />
    </div></div>
  </div>
}

function Artists() {
  const [search, setSearch] = useState('')
  const artists = useQuery({queryKey: ['provider', 'artists'], queryFn: listProviderArtists})
  const filtered = artists.data?.filter((artist) => artist.name.toLowerCase().includes(search.toLowerCase())) ?? []
  return <div className="space-y-6"><SectionHeader title="My Artists" detail="Artist identities available for release credits." action={<CreateArtistDialog />} />
    <SearchInput value={search} onChange={setSearch} placeholder="Search artists" />
    {artists.isLoading ? <Skeleton className="h-48 bg-white/5" /> : artists.isError ? <ErrorState message={artists.error.message} /> : filtered.length === 0 ? <EmptyState title="No artists found" detail="Create an artist profile to begin preparing a release." /> :
      <div className="divide-y divide-white/10 border-y border-white/10">{filtered.map((artist) => <div key={artist.id} className="flex items-center gap-4 py-4"><div className="grid h-10 w-10 place-items-center rounded-full bg-emerald-400/10 font-semibold text-emerald-300">{artist.name.charAt(0).toUpperCase()}</div><div className="min-w-0 flex-1"><p className="truncate font-medium">{artist.name}</p><p className="text-xs text-zinc-500">{artist.country_code || 'Country not set'}</p></div><p className="text-xs text-zinc-400">{artist.release_count} releases</p></div>)}</div>}
  </div>
}

function Releases() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const releases = useQuery({queryKey: ['provider', 'releases'], queryFn: listProviderReleases})
  const artists = useQuery({queryKey: ['provider', 'artists'], queryFn: listProviderArtists})
  const filtered = releases.data?.filter((release) => release.title.toLowerCase().includes(search.toLowerCase())) ?? []
  return <div className="space-y-6"><SectionHeader title="My Releases" detail="Draft, submit, and monitor your catalog." action={<CreateReleaseDialog artists={artists.data ?? []} />} />
    <SearchInput value={search} onChange={setSearch} placeholder="Search releases" />
    {releases.isLoading ? <Skeleton className="h-48 bg-white/5" /> : releases.isError ? <ErrorState message={releases.error.message} /> : filtered.length === 0 ? <EmptyState title="No releases found" detail="Create your first release draft when an artist profile is ready." /> :
      <div className="divide-y divide-white/10 border-y border-white/10">{filtered.map((release) => <button type="button" onClick={() => navigate(`/app/artist/releases/${release.id}/edit/${release.draft_step || 'release-information'}`)} key={release.id} className="grid w-full grid-cols-[1fr_auto] items-center gap-4 py-4 text-left hover:bg-white/[0.02] sm:grid-cols-[1fr_9rem_6rem_auto_auto]"><div className="min-w-0"><p className="truncate font-medium">{release.title}</p><p className="truncate text-xs text-zinc-500">{release.primary_artist_name}</p></div><p className="hidden text-sm capitalize text-zinc-400 sm:block">{release.release_type}</p><p className="hidden text-sm text-zinc-400 sm:block">{release.track_count} tracks</p><span className="rounded-full border border-white/10 px-2.5 py-1 text-xs">{release.status.replace(/_/g, ' ')}</span><ChevronRight className="h-4 w-4 text-zinc-500" /></button>)}</div>}
  </div>
}

function CreateArtistDialog() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const mutation = useMutation({mutationFn: createProviderArtist, onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({queryKey: ['provider', 'artists']}), queryClient.invalidateQueries({queryKey: ['provider', 'dashboard']})]); setName(''); setOpen(false); toast({title: 'Artist created'}) }})
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button className="gap-2 bg-emerald-400 text-zinc-950 hover:bg-emerald-300"><Plus className="h-4 w-4" />Add artist</Button></DialogTrigger><DialogContent className="border-white/10 bg-[#151518]"><DialogHeader><DialogTitle>Create artist</DialogTitle><DialogDescription>Add an artist identity for release credits.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={(event) => {event.preventDefault(); mutation.mutate({name: name.trim()})}}><div className="space-y-2"><Label htmlFor="artist-name">Artist name</Label><Input id="artist-name" value={name} onChange={(event) => setName(event.target.value)} maxLength={300} required /></div>{mutation.isError && <p className="text-sm text-red-400">{mutation.error.message}</p>}<Button className="w-full" disabled={!name.trim() || mutation.isPending}>{mutation.isPending ? 'Creating...' : 'Create artist'}</Button></form></DialogContent></Dialog>
}

function CreateReleaseDialog({artists}: {artists: ProviderArtist[]}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [artistId, setArtistId] = useState('')
  const [releaseType, setReleaseType] = useState<'single' | 'ep' | 'album'>('single')
  const mutation = useMutation({mutationFn: createProviderRelease, onSuccess: async (release) => { await Promise.all([queryClient.invalidateQueries({queryKey: ['provider', 'releases']}), queryClient.invalidateQueries({queryKey: ['provider', 'dashboard']})]); setTitle(''); setOpen(false); toast({title: 'Release draft created'}); navigate(`/app/artist/releases/${release.id}/edit/release-information`) }})
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button disabled={artists.length === 0} className="gap-2 bg-emerald-400 text-zinc-950 hover:bg-emerald-300"><Plus className="h-4 w-4" />Create release</Button></DialogTrigger><DialogContent className="border-white/10 bg-[#151518]"><DialogHeader><DialogTitle>Create release</DialogTitle><DialogDescription>Start a draft. Detailed metadata and uploads come next.</DialogDescription></DialogHeader><form className="space-y-4" onSubmit={(event) => {event.preventDefault(); mutation.mutate({title: title.trim(), releaseType, primaryArtistId: artistId})}}><div className="space-y-2"><Label htmlFor="release-title">Title</Label><Input id="release-title" value={title} onChange={(event) => setTitle(event.target.value)} required /></div><div className="space-y-2"><Label>Primary artist</Label><Select value={artistId} onValueChange={setArtistId}><SelectTrigger><SelectValue placeholder="Select artist" /></SelectTrigger><SelectContent>{artists.map((artist) => <SelectItem key={artist.id} value={artist.id}>{artist.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label>Release type</Label><Select value={releaseType} onValueChange={(value: 'single' | 'ep' | 'album') => setReleaseType(value)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="single">Single</SelectItem><SelectItem value="ep">EP</SelectItem><SelectItem value="album">Album</SelectItem></SelectContent></Select></div>{mutation.isError && <p className="text-sm text-red-400">{mutation.error.message}</p>}<Button className="w-full" disabled={!title.trim() || !artistId || mutation.isPending}>{mutation.isPending ? 'Creating...' : 'Create release draft'}</Button></form></DialogContent></Dialog>
}

function SectionHeader({title, detail, action}: {title: string; detail: string; action: React.ReactNode}) { return <div className="flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-2xl font-bold">{title}</h1><p className="mt-1 text-sm text-zinc-400">{detail}</p></div>{action}</div> }
function SearchInput({value, onChange, placeholder}: {value: string; onChange: (value: string) => void; placeholder: string}) { return <div className="relative max-w-md"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" /><Input className="pl-9" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></div> }
function ActionRow({title, detail, onClick}: {title: string; detail: string; onClick: () => void}) { return <button type="button" onClick={onClick} className="flex items-center gap-4 rounded-md border border-white/10 bg-[#141417] p-5 text-left hover:border-emerald-400/40"><div className="min-w-0 flex-1"><p className="font-medium">{title}</p><p className="mt-1 text-sm text-zinc-500">{detail}</p></div><ChevronRight className="h-5 w-5 text-zinc-500" /></button> }
function EmptyState({title, detail}: {title: string; detail: string}) { return <div className="grid min-h-72 place-items-center border-y border-dashed border-white/10 py-12 text-center"><div><BadgeDollarSign className="mx-auto h-8 w-8 text-zinc-600" /><h2 className="mt-4 font-semibold">{title}</h2><p className="mx-auto mt-2 max-w-md text-sm text-zinc-500">{detail}</p></div></div> }
function ErrorState({message}: {message: string}) { return <div role="alert" className="rounded-md border border-red-400/30 bg-red-400/5 p-4 text-sm text-red-300">{message}</div> }
