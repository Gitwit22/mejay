import {useState} from 'react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {AlertTriangle, ExternalLink, FileText, ShieldAlert, ShieldCheck} from 'lucide-react'

import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog'
import {Textarea} from '@/components/ui/textarea'
import {toast} from '@/hooks/use-toast'
import {commandMarketplaceRelease, getReleaseReview, reviewAssetUrl, type ReleaseAdminAction, type ReleaseReview} from '@/lib/marketplaceAdminApi'

const APPROVABLE = ['CERTIFIED_ORIGINAL', 'RIGHTS_CLEARED']
const CLEARABLE = ['NOT_CERTIFIED', 'RIGHTS_DOCUMENTATION_ATTACHED', 'RIGHTS_REVIEW_REQUIRED']

const rightsLabels: Record<string, {label: string; tone: 'ok' | 'warn' | 'bad'}> = {
  NOT_CERTIFIED: {label: 'Not certified (legacy submission)', tone: 'warn'},
  CERTIFIED_ORIGINAL: {label: 'Certified original', tone: 'ok'},
  RIGHTS_DOCUMENTATION_ATTACHED: {label: 'Rights documentation attached', tone: 'warn'},
  RIGHTS_REVIEW_REQUIRED: {label: 'Rights review required', tone: 'bad'},
  RIGHTS_CLEARED: {label: 'Rights cleared by reviewer', tone: 'ok'},
  RIGHTS_ISSUE_FLAGGED: {label: 'Rights issue flagged', tone: 'bad'},
}
const thirdPartyLabels: Record<string, string> = {none: 'No — entirely original', licensed: 'Yes — documented rights/licenses', unsure: 'Unsure'}

function Section({title, children}: {title: string; children: React.ReactNode}) {
  return <section className="space-y-2"><h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>{children}</section>
}

function Datum({label, value}: {label: string; value: React.ReactNode}) {
  return <div><dt className="text-xs text-zinc-500">{label}</dt><dd className="text-sm text-zinc-200">{value || '—'}</dd></div>
}

/** Full submission review for marketplace staff, including rights certification and documents. */
export function ReleaseReviewDialog({releaseId, title}: {releaseId: string; title: string}) {
  const [open, setOpen] = useState(false)
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm">Review</Button></DialogTrigger>
    <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto border-white/10 bg-[#111114] text-zinc-100">
      <DialogHeader><DialogTitle>Review: {title}</DialogTitle></DialogHeader>
      {open && <ReviewBody releaseId={releaseId} onDone={() => setOpen(false)} />}
    </DialogContent>
  </Dialog>
}

function ReviewBody({releaseId, onDone}: {releaseId: string; onDone: () => void}) {
  const queryClient = useQueryClient()
  const review = useQuery({queryKey: ['marketplace-admin', 'release-review', releaseId], queryFn: () => getReleaseReview(releaseId)})
  const [note, setNote] = useState('')
  const command = useMutation({
    mutationFn: (action: ReleaseAdminAction) => commandMarketplaceRelease(releaseId, {action, expectedVersion: Number(review.data!.release.version), ...(note.trim() ? {note: note.trim()} : {})}),
    onSuccess: async (_data, action) => {
      await queryClient.invalidateQueries({queryKey: ['marketplace-admin']})
      toast({title: {start_review: 'Review started', approve: 'Release approved', request_changes: 'Changes requested', reject: 'Release rejected', flag_rights: 'Rights issue flagged', clear_rights: 'Rights cleared'}[action as string] ?? 'Updated'})
      setNote('')
      if (action !== 'start_review' && action !== 'clear_rights') onDone()
    },
    onError: (error) => toast({title: 'Action failed', description: error.message, variant: 'destructive'}),
  })
  if (review.isLoading) return <p className="text-sm text-zinc-400">Loading submission...</p>
  if (review.isError || !review.data) return <p className="text-sm text-red-400">{review.error?.message || 'Submission unavailable'}</p>
  const data: ReleaseReview = review.data
  const release = data.release
  const rights = rightsLabels[release.rights_status] ?? {label: release.rights_status, tone: 'warn' as const}
  const latest = data.certifications[0]
  const status = release.status
  const canApprove = status === 'UNDER_REVIEW' && APPROVABLE.includes(release.rights_status)
  const needsNote = (action: ReleaseAdminAction) => ['request_changes', 'reject', 'flag_rights', 'clear_rights'].includes(action)
  const run = (action: ReleaseAdminAction) => {
    if (needsNote(action) && !note.trim()) {
      toast({title: 'Add a note for the artist first', variant: 'destructive'})
      return
    }
    command.mutate(action)
  }

  return <div className="space-y-6">
    <div className="grid gap-5 sm:grid-cols-[10rem_1fr]">
      {release.artwork_asset_id ? <a href={reviewAssetUrl(release.artwork_asset_id)} target="_blank" rel="noreferrer"><img src={reviewAssetUrl(release.artwork_asset_id)} alt="Release artwork" className="aspect-square w-40 rounded object-cover" /></a> : <div className="grid aspect-square w-40 place-items-center rounded bg-zinc-800 text-xs text-zinc-500">No artwork</div>}
      <dl className="grid gap-3 sm:grid-cols-3">
        <Datum label="Artist" value={release.primary_artist_name} /><Datum label="Account" value={release.provider_name} /><Datum label="Status" value={status.replace(/_/g, ' ')} />
        <Datum label="Type" value={release.release_type} /><Datum label="Genre" value={[release.genre, release.subgenre].filter(Boolean).join(' / ')} /><Datum label="Version" value={release.version_title} />
        <Datum label="Label" value={release.label_name} /><Datum label="UPC" value={release.upc} /><Datum label="Original release" value={release.original_release_date} />
        <Datum label="© " value={[release.copyright_year, release.copyright_holder].filter(Boolean).join(' ')} /><Datum label="℗ " value={[release.phonographic_copyright_year, release.phonographic_copyright_holder].filter(Boolean).join(' ')} /><Datum label="Distribution" value={release.distribution_status.replace(/_/g, ' ')} />
      </dl>
    </div>

    {data.warnings.length > 0 && <div className="space-y-1 rounded-md border border-amber-400/30 bg-amber-400/5 p-3 text-sm text-amber-200">{data.warnings.map((warning) => <p key={warning} className="flex gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{warning}</p>)}</div>}

    <Section title="Rights certification">
      <p className={`flex items-center gap-2 text-sm font-medium ${rights.tone === 'ok' ? 'text-emerald-300' : rights.tone === 'bad' ? 'text-red-300' : 'text-amber-300'}`}>{rights.tone === 'ok' ? <ShieldCheck className="h-4 w-4" /> : <ShieldAlert className="h-4 w-4" />}{rights.label}</p>
      {latest ? <div className="space-y-2 text-sm">
        <p className="text-zinc-400">Third-party material: <span className="text-zinc-200">{thirdPartyLabels[latest.third_party_material] ?? latest.third_party_material}</span> · Certified {new Date(latest.certified_at).toLocaleString()} · Version {latest.certification_version}</p>
        <ul className="space-y-1">{latest.accepted_certifications.map((statement) => <li key={statement.key} className="flex gap-2 text-zinc-300"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" /><span><span className="font-medium">{statement.title}:</span> {statement.text}</span></li>)}</ul>
        {data.certifications.length > 1 && <p className="text-xs text-zinc-500">{data.certifications.length - 1} earlier certification(s) on file.</p>}
      </div> : <p className="text-sm text-zinc-400">No certification on file.</p>}
    </Section>

    {data.materials.length > 0 && <Section title="Third-party material and documents">
      <ul className="divide-y divide-white/10 rounded-md border border-white/10">{data.materials.map((material) => <li key={material.id} className="flex items-start gap-3 p-3 text-sm">
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
        <div className="min-w-0 flex-1"><p className="font-medium">{material.material_type.replace(/_/g, ' ')} · {material.licensor_name}</p><p className="text-zinc-400">{material.description}</p><p className="text-xs text-zinc-500">{material.license_type.replace(/_/g, ' ')}</p></div>
        {material.document_asset_id ? <a className="inline-flex items-center gap-1 text-emerald-400 hover:underline" href={reviewAssetUrl(material.document_asset_id)} target="_blank" rel="noreferrer">{material.document_file_name || 'Document'}<ExternalLink className="h-3 w-3" /></a> : <span className="text-xs text-amber-300">No document</span>}
      </li>)}</ul>
    </Section>}

    <Section title="Tracks and credits">
      <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead className="text-xs uppercase text-zinc-500"><tr><th className="py-2 pr-3">#</th><th className="py-2 pr-3">Track</th><th className="py-2 pr-3">Credits</th><th className="py-2 pr-3">ISRC</th><th className="py-2">Audio</th></tr></thead>
        <tbody className="divide-y divide-white/10">{data.tracks.map((track) => <tr key={track.id} className="align-top">
          <td className="py-2 pr-3 text-zinc-500">{track.track_number}</td>
          <td className="py-2 pr-3"><p>{track.title}{track.version_title ? ` (${track.version_title})` : ''}</p><p className="text-xs text-zinc-500">{track.explicit ? 'Explicit' : 'Clean'}{track.language_code ? ` · ${track.language_code}` : ''}</p></td>
          <td className="py-2 pr-3 text-xs text-zinc-300">{[...track.featured_artists.map((artist) => `feat. ${artist.name}`), ...track.contributors.map((contributor) => `${contributor.name} (${contributor.role.replace(/_/g, ' ')}${contributor.publisherName ? `, ${contributor.publisherName}` : ''})`)].join(', ') || <span className="text-zinc-500">None</span>}</td>
          <td className="py-2 pr-3 font-mono text-xs">{track.isrc ?? <span className="font-sans text-zinc-500">Assigned on approval</span>}</td>
          <td className="py-2 text-xs">{track.audio_ready ? 'Ready' : <span className="text-red-300">Missing</span>}</td>
        </tr>)}</tbody></table></div>
    </Section>

    <Section title="Marketplace readiness">
      <p className="text-sm text-zinc-300">Price: {data.readiness.hasMinimumPrice ? 'set' : 'missing'} · Stripe payouts: {data.readiness.stripeReady ? 'ready' : 'not ready'}</p>
    </Section>

    {data.reviewEvents.length > 0 && <Section title="Review history"><ul className="space-y-1 text-sm text-zinc-400">{data.reviewEvents.map((event, index) => <li key={index}>{new Date(event.created_at).toLocaleString()} · {event.decision.replace(/_/g, ' ')}{event.note ? ` — ${event.note}` : ''}</li>)}</ul></Section>}

    {['SUBMITTED', 'UNDER_REVIEW'].includes(status) && <div className="space-y-3 border-t border-white/10 pt-4">
      <Textarea placeholder="Note to the artist (required to request changes, reject, flag or clear rights)" value={note} onChange={(event) => setNote(event.target.value)} />
      <div className="flex flex-wrap gap-2">
        {status === 'SUBMITTED' && <Button disabled={command.isPending} onClick={() => run('start_review')}>Start review</Button>}
        {status === 'UNDER_REVIEW' && <Button className="bg-emerald-400 text-zinc-950 hover:bg-emerald-300" disabled={command.isPending || !canApprove} title={canApprove ? undefined : 'Clear the rights or request changes first'} onClick={() => run('approve')}>Approve</Button>}
        {CLEARABLE.includes(release.rights_status) && <Button variant="outline" disabled={command.isPending} onClick={() => run('clear_rights')}>Clear rights</Button>}
        {status === 'UNDER_REVIEW' && <Button variant="outline" disabled={command.isPending} onClick={() => run('request_changes')}>Request changes</Button>}
        <Button variant="outline" className="border-amber-400/40 text-amber-200" disabled={command.isPending} onClick={() => run('flag_rights')}>Flag rights issue</Button>
        {status === 'UNDER_REVIEW' && <Button variant="outline" className="border-red-400/40 text-red-300" disabled={command.isPending} onClick={() => run('reject')}>Reject</Button>}
      </div>
      {status === 'UNDER_REVIEW' && !canApprove && <p className="text-xs text-amber-300">Approval is locked until the rights are cleared. MeJay never approves releases marked for rights review automatically.</p>}
    </div>}
  </div>
}
