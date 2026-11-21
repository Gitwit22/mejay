import {useState} from 'react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {Copy, Plus, Search, X} from 'lucide-react'

import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Skeleton} from '@/components/ui/skeleton'
import {toast} from '@/hooks/use-toast'
import {createDiscountCode, listDiscountCodes, updateDiscountCode, type DiscountCode} from '@/lib/marketplaceCommerceApi'
import {lookupStoryLinks, type StoryLinkOption} from '@/lib/storiesAdminApi'

const QUERY_KEY = ['marketplace-admin', 'discount-codes']

/**
 * Store discount codes. Admins create and switch codes on or off; reviewers can see them.
 * A code is a percent off what the buyer pays; the platform fee and the artist's proceeds are
 * worked out from the discounted price, like any other sale.
 */
export function DiscountCodesSection() {
  const codes = useQuery({queryKey: QUERY_KEY, queryFn: listDiscountCodes})
  if (codes.isLoading) return <Skeleton className="h-72 bg-white/5" />
  if (codes.isError || !codes.data) return <p role="alert" className="border border-red-400/30 bg-red-400/5 p-4 text-sm text-red-200">{codes.error?.message || 'Discount codes could not be loaded.'}</p>
  const isAdmin = codes.data.role === 'admin'
  return <div className="space-y-8">
    <header>
      <h1 className="text-2xl font-black">Discount Codes</h1>
      <p className="mt-1 max-w-3xl text-sm text-zinc-400">Buyers enter a code on a release page for a percent off. The discount comes out of the sale: the platform fee and the artist's proceeds are worked out from what the buyer pays. A sale is never charged less than $1.00.</p>
    </header>
    {isAdmin ? <CreateCodeForm /> : <p className="text-sm text-zinc-500">Only marketplace admins can create or change codes.</p>}
    <CodeTable codes={codes.data.codes} isAdmin={isAdmin} />
  </div>
}

function CreateCodeForm() {
  const queryClient = useQueryClient()
  const [code, setCode] = useState('')
  const [percent, setPercent] = useState('20')
  const [maxUses, setMaxUses] = useState('')
  const [release, setRelease] = useState<StoryLinkOption | null>(null)
  const [scope, setScope] = useState<'all' | 'release'>('all')
  const create = useMutation({
    mutationFn: () => createDiscountCode({
      code: code.trim(),
      percentOff: Number(percent),
      releaseId: scope === 'release' ? release?.id ?? null : null,
      maxRedemptions: maxUses.trim() ? Number(maxUses) : null,
    }),
    onSuccess: (created) => {
      toast({title: `${created.code} created`, description: `${created.percent_off}% off ${created.release_title ?? 'all music'}`})
      setCode(''); setMaxUses(''); setRelease(null); setScope('all')
      void queryClient.invalidateQueries({queryKey: QUERY_KEY})
    },
    onError: (error) => toast({title: 'Code not created', description: error.message, variant: 'destructive'}),
  })
  const percentValue = Number(percent)
  const percentValid = Number.isInteger(percentValue) && percentValue >= 1 && percentValue <= 90
  const maxValid = !maxUses.trim() || (Number.isInteger(Number(maxUses)) && Number(maxUses) >= 1)
  const codeValid = /^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/.test(code.trim())
  const ready = codeValid && percentValid && maxValid && (scope === 'all' || Boolean(release)) && !create.isPending

  return <section className="border-y border-white/10 py-5">
    <h2 className="font-bold">New code</h2>
    <form className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_8rem_10rem]" onSubmit={(event) => { event.preventDefault(); if (ready) create.mutate() }}>
      <label className="text-sm"><span className="mb-1 block text-zinc-400">Code</span>
        <Input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="BOLDY20" maxLength={32} autoComplete="off" className="uppercase" aria-invalid={code.length > 0 && !codeValid} />
        <span className="mt-1 block text-xs text-zinc-500">3 to 32 letters, numbers, dashes or underscores.</span>
      </label>
      <label className="text-sm"><span className="mb-1 block text-zinc-400">Percent off</span>
        <Input type="number" min={1} max={90} value={percent} onChange={(event) => setPercent(event.target.value)} aria-invalid={!percentValid} />
        <span className="mt-1 block text-xs text-zinc-500">1 to 90.</span>
      </label>
      <label className="text-sm"><span className="mb-1 block text-zinc-400">Max uses</span>
        <Input type="number" min={1} value={maxUses} onChange={(event) => setMaxUses(event.target.value)} placeholder="Unlimited" aria-invalid={!maxValid} />
      </label>
      <fieldset className="text-sm md:col-span-3">
        <legend className="mb-2 text-zinc-400">Works on</legend>
        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2"><input type="radio" name="discount-scope" checked={scope === 'all'} onChange={() => setScope('all')} />All music</label>
          <label className="flex items-center gap-2"><input type="radio" name="discount-scope" checked={scope === 'release'} onChange={() => setScope('release')} />One release and its songs</label>
        </div>
        {scope === 'release' && <ReleasePicker selected={release} onSelect={setRelease} />}
      </fieldset>
      <div className="md:col-span-3"><Button type="submit" disabled={!ready} className="gap-2 bg-emerald-400 font-semibold text-zinc-950 hover:bg-emerald-300"><Plus className="h-4 w-4" />{create.isPending ? 'Creating...' : 'Create code'}</Button></div>
    </form>
  </section>
}

function ReleasePicker({selected, onSelect}: {selected: StoryLinkOption | null; onSelect: (release: StoryLinkOption | null) => void}) {
  const [query, setQuery] = useState('')
  const search = useMutation({mutationFn: (value: string) => lookupStoryLinks('release', value)})
  if (selected) {
    return <div className="mt-3 flex max-w-xl items-center gap-3 bg-white/[0.04] px-3 py-2">
      <span className="min-w-0 flex-1 truncate">{selected.title}{selected.artist_name ? ` · ${selected.artist_name}` : ''}</span>
      <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 px-2" onClick={() => onSelect(null)}><X className="h-3.5 w-3.5" />Change</Button>
    </div>
  }
  return <div className="mt-3 max-w-xl">
    <div className="flex gap-2">
      <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search releases or artists" aria-label="Search releases"
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (query.trim()) search.mutate(query.trim()) } }} />
      <Button type="button" variant="outline" className="gap-2" disabled={!query.trim() || search.isPending} onClick={() => search.mutate(query.trim())}><Search className="h-4 w-4" />Search</Button>
    </div>
    {search.isError && <p className="mt-2 text-xs text-red-300">{search.error.message}</p>}
    {search.data && (search.data.length === 0
      ? <p className="mt-2 text-xs text-zinc-500">No releases found.</p>
      : <ul className="mt-2 divide-y divide-white/10 border-y border-white/10">{search.data.map((option) => <li key={option.id}>
        <button type="button" className="flex w-full items-center gap-3 px-2 py-2 text-left hover:bg-white/5" onClick={() => onSelect(option)}>
          <span className="min-w-0 flex-1 truncate">{option.title}{option.artist_name ? ` · ${option.artist_name}` : ''}</span>
          <span className="text-xs capitalize text-zinc-500">{option.status?.toLowerCase().replace(/_/g, ' ')}</span>
        </button>
      </li>)}</ul>)}
  </div>
}

function CodeTable({codes, isAdmin}: {codes: DiscountCode[]; isAdmin: boolean}) {
  const queryClient = useQueryClient()
  const toggle = useMutation({
    mutationFn: (code: DiscountCode) => updateDiscountCode(code.id, {active: !code.active}),
    onSuccess: (updated) => {
      toast({title: `${updated.code} ${updated.active ? 'switched on' : 'switched off'}`})
      void queryClient.invalidateQueries({queryKey: QUERY_KEY})
    },
    onError: (error) => toast({title: 'Code not changed', description: error.message, variant: 'destructive'}),
  })
  const copyLink = async (code: DiscountCode) => {
    if (!code.release_id) return
    const url = `${window.location.origin}/app/store/${encodeURIComponent(code.release_id)}?code=${encodeURIComponent(code.code)}`
    try {
      await navigator.clipboard.writeText(url)
      toast({title: 'Link copied', description: 'Opens the release with the code applied.'})
    } catch {
      toast({title: 'Copy this link', description: url})
    }
  }
  if (codes.length === 0) return <p className="border-y border-dashed border-white/10 py-12 text-center text-sm text-zinc-500">No discount codes yet.</p>
  return <section>
    <h2 className="text-lg font-semibold">Codes</h2>
    <div className="mt-4 overflow-x-auto border-y border-white/10">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead><tr className="text-xs uppercase text-zinc-500"><th className="px-3 py-3">Code</th><th className="px-3 py-3">Off</th><th className="px-3 py-3">Works on</th><th className="px-3 py-3">Uses</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Actions</th></tr></thead>
        <tbody className="divide-y divide-white/10">{codes.map((code) => {
          const usedUp = code.max_redemptions !== null && code.redemption_count >= code.max_redemptions
          return <tr key={code.id}>
            <td className="px-3 py-3 font-mono font-semibold">{code.code}</td>
            <td className="px-3 py-3 tabular-nums">{code.percent_off}%</td>
            <td className="px-3 py-3">{code.release_id ? code.release_title ?? 'Removed release' : 'All music'}</td>
            <td className="px-3 py-3 tabular-nums">{code.redemption_count}{code.max_redemptions !== null ? ` / ${code.max_redemptions}` : ''}</td>
            <td className="px-3 py-3">{!code.active ? <span className="text-zinc-500">Off</span> : usedUp ? <span className="text-amber-300">Used up</span> : <span className="text-emerald-300">On</span>}</td>
            <td className="px-3 py-3"><div className="flex gap-2">
              {code.release_id && <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void copyLink(code)}><Copy className="h-3.5 w-3.5" />Copy link</Button>}
              {isAdmin && <Button size="sm" variant="outline" disabled={toggle.isPending} onClick={() => toggle.mutate(code)}>{code.active ? 'Switch off' : 'Switch on'}</Button>}
            </div></td>
          </tr>
        })}</tbody>
      </table>
    </div>
  </section>
}
