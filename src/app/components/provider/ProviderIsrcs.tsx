import {useQuery} from '@tanstack/react-query'
import {Download, Fingerprint} from 'lucide-react'

import {Button} from '@/components/ui/button'
import {Skeleton} from '@/components/ui/skeleton'
import {listProviderIsrcs, providerIsrcExportUrl, type ProviderIsrc} from '@/lib/providerApi'

const SOURCE_LABELS: Record<NonNullable<ProviderIsrc['assignment_type']>, string> = {
  MEJAY_ASSIGNED: 'Issued by MeJay',
  EXTERNAL: 'Your existing code',
}

const STATUS_LABELS: Record<NonNullable<ProviderIsrc['status']>, string> = {
  RESERVED: 'Reserved',
  ASSIGNED: 'Assigned',
  REGISTERED: 'Registered',
  VOIDED: 'Voided',
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('en-US', {year: 'numeric', month: 'short', day: 'numeric'}).format(date)
}

const source = (row: ProviderIsrc) => (row.assignment_type ? SOURCE_LABELS[row.assignment_type] : '—')
const status = (row: ProviderIsrc) => (row.status ? STATUS_LABELS[row.status] : '—')

/** Portal ISRCs tab: every code on the account's tracks, read-only, with a CSV download. */
export function ProviderIsrcs() {
  const isrcs = useQuery({queryKey: ['provider', 'isrcs'], queryFn: listProviderIsrcs})
  const rows = isrcs.data ?? []

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold">ISRCs</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-400">The recording codes on your tracks. MeJay issues a QT-A3L code when a release without one is approved; codes you already owned are kept as they are.</p>
      </div>
      {rows.length > 0 && <Button asChild variant="outline" size="sm" className="gap-2"><a href={providerIsrcExportUrl()} download><Download className="h-4 w-4" />Download CSV</a></Button>}
    </div>

    {isrcs.isLoading ? <Skeleton className="h-48 bg-white/5" />
      : isrcs.isError ? <div role="alert" className="rounded-md border border-red-400/30 bg-red-400/5 p-4 text-sm text-red-300">{isrcs.error.message}</div>
      : rows.length === 0 ? <div className="grid min-h-60 place-items-center border-y border-dashed border-white/10 py-12 text-center">
        <div>
          <Fingerprint className="mx-auto h-8 w-8 text-zinc-600" />
          <h2 className="mt-4 font-semibold">No ISRCs yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-zinc-500">Add your own code to a track while building a release, or leave it blank and MeJay will issue one when the release is approved.</p>
        </div>
      </div>
      : <>
        {/* Phones get stacked cards; wider screens get the table. */}
        <ul className="space-y-3 md:hidden" aria-label="ISRCs">
          {rows.map((row) => <li key={row.id} className="rounded-lg border border-white/10 p-4">
            <p className="font-mono text-sm font-semibold text-emerald-300">{row.isrc}</p>
            <p className="mt-1 truncate font-medium">{row.track_title ?? 'Untitled track'}</p>
            <p className="truncate text-xs text-zinc-500">{[row.artist_name, row.release_title].filter(Boolean).join(' · ') || '—'}</p>
            <p className="mt-2 text-xs text-zinc-400">{source(row)} · {status(row)} · {formatDate(row.assigned_at)}</p>
          </li>)}
        </ul>
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 text-xs uppercase tracking-wide text-zinc-500">
              <tr><th className="py-3 pr-4 font-medium">ISRC</th><th className="py-3 pr-4 font-medium">Track</th><th className="py-3 pr-4 font-medium">Release</th><th className="py-3 pr-4 font-medium">Source</th><th className="py-3 pr-4 font-medium">Status</th><th className="py-3 font-medium">Assigned</th></tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {rows.map((row) => <tr key={row.id}>
                <td className="whitespace-nowrap py-3 pr-4 font-mono text-emerald-300">{row.isrc}</td>
                <td className="py-3 pr-4"><p className="font-medium">{row.track_title ?? 'Untitled track'}</p>{row.artist_name && <p className="text-xs text-zinc-500">{row.artist_name}</p>}</td>
                <td className="py-3 pr-4 text-zinc-300">{row.release_title ?? '—'}</td>
                <td className="py-3 pr-4 text-zinc-300">{source(row)}</td>
                <td className="py-3 pr-4 text-zinc-300">{status(row)}</td>
                <td className="whitespace-nowrap py-3 text-zinc-400">{formatDate(row.assigned_at)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </>}
  </div>
}
