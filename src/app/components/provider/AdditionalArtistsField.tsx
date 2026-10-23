import {Plus, X} from 'lucide-react'

import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {cn} from '@/lib/utils'
import type {ProviderArtist} from '@/lib/providerApi'
import {EXTERNAL_ARTIST, MAX_ADDITIONAL_ARTISTS, newArtistRowKey, type AdditionalArtistRow} from '@/lib/artistCredit'

/**
 * More primary artists ("A & B") and featured artists ("feat. C") on a release. Each is one of the
 * account's artists or a typed name for someone who isn't on MeJay.
 */
export function AdditionalArtistsField({rows, onChange, artists, leadArtistId}: {
  rows: AdditionalArtistRow[]
  onChange: (rows: AdditionalArtistRow[]) => void
  artists: ProviderArtist[]
  leadArtistId: string
}) {
  const update = (key: string, patch: Partial<AdditionalArtistRow>) => onChange(rows.map((row) => row.key === key ? {...row, ...patch} : row))
  const add = (role: 'primary' | 'featured') => onChange([...rows, {key: newArtistRowKey(), role, artistId: EXTERNAL_ARTIST, name: ''}])
  const choosable = artists.filter((artist) => artist.id !== leadArtistId)

  return <div className="space-y-3 sm:col-span-2">
    <div>
      <p className="text-sm font-medium">Additional artists</p>
      <p className="text-xs text-zinc-500">Add another main artist or a featured guest. They don't need a MeJay account.</p>
    </div>
    {rows.map((row, index) => {
      const external = row.artistId === EXTERNAL_ARTIST
      return <div key={row.key} className="grid gap-2 rounded-md border border-white/10 bg-white/[0.02] p-3 sm:grid-cols-[auto_1fr_1fr_auto] sm:items-center">
        <div role="radiogroup" aria-label={`Artist ${index + 1} role`} className="inline-flex rounded-md border border-white/10 p-0.5 text-xs">
          {(['primary', 'featured'] as const).map((role) => <button key={role} type="button" role="radio" aria-checked={row.role === role} onClick={() => update(row.key, {role})}
            className={cn('rounded px-2.5 py-1.5 font-medium transition', row.role === role ? 'bg-emerald-400 text-zinc-950' : 'text-zinc-400 hover:text-zinc-100')}>{role === 'primary' ? 'Primary' : 'Featured'}</button>)}
        </div>
        <select aria-label={`Artist ${index + 1}`} className="h-10 w-full rounded-md border border-white/10 bg-zinc-950 px-3 text-sm" value={row.artistId} onChange={(event) => update(row.key, {artistId: event.target.value})}>
          <option value={EXTERNAL_ARTIST}>Someone not on MeJay…</option>
          {choosable.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}
        </select>
        {external
          ? <Input aria-label={`Artist ${index + 1} name`} placeholder="Artist name, e.g. Boldy James" value={row.name} maxLength={300} aria-invalid={!row.name.trim()} onChange={(event) => update(row.key, {name: event.target.value})} />
          : <p className="px-1 text-xs text-zinc-500">From your MeJay artists</p>}
        <Button type="button" size="icon" variant="ghost" className="h-9 w-9 justify-self-end text-zinc-500 hover:text-red-300" aria-label={`Remove artist ${index + 1}`} onClick={() => onChange(rows.filter((candidate) => candidate.key !== row.key))}><X className="h-4 w-4" /></Button>
      </div>
    })}
    {rows.length < MAX_ADDITIONAL_ARTISTS && <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => add('featured')}><Plus className="h-3.5 w-3.5" />Add featured artist</Button>
      <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => add('primary')}><Plus className="h-3.5 w-3.5" />Add primary artist</Button>
    </div>}
  </div>
}
