import {useState} from 'react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {AlertTriangle} from 'lucide-react'

import {Button} from '@/components/ui/button'
import {Checkbox} from '@/components/ui/checkbox'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog'
import {Label} from '@/components/ui/label'
import {Textarea} from '@/components/ui/textarea'
import {toast} from '@/hooks/use-toast'
import {formatChangeValue, SAME_SONG_NOTE} from '@/lib/changeRequestFormat'
import {commandChangeRequest, getChangeRequestReview, listChangeRequests, reviewAssetUrl, type ChangeRequestCommand, type ChangeRequestReview} from '@/lib/marketplaceAdminApi'
import type {ChangeDiffItem} from '@/lib/providerApi'

/** Changes artists asked for on approved, scheduled or live releases. */
export function ChangeRequestsSection() {
  const queue = useQuery({queryKey: ['marketplace-admin', 'change-requests'], queryFn: listChangeRequests})
  return <section>
    <h1 className="text-2xl font-bold">Change requests</h1>
    <p className="mt-1 text-sm text-zinc-400">Edits to approved releases. Nothing changes on a release until you approve its request.</p>
    {queue.isError ? <p role="alert" className="mt-4 text-sm text-red-300">{queue.error.message}</p>
      : !queue.data ? <p className="mt-4 text-sm text-zinc-500">Loading…</p>
        : queue.data.length === 0 ? <p className="mt-4 border-y border-dashed border-white/10 py-12 text-center text-sm text-zinc-500">No change requests waiting.</p>
          : <div className="mt-4 overflow-x-auto border-y border-white/10"><table className="w-full min-w-[720px] text-left text-sm">
            <thead><tr className="text-xs uppercase text-zinc-500"><th className="px-3 py-3">Release</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Files</th><th className="px-3 py-3">Submitted</th><th className="px-3 py-3" /></tr></thead>
            <tbody className="divide-y divide-white/10">{queue.data.map((item) => <tr key={item.id}>
              <td className="px-3 py-3"><p className="text-zinc-200">{item.release_title}</p><p className="text-xs text-zinc-500">{item.provider_name} · {item.release_status.toLowerCase()}</p></td>
              <td className="px-3 py-3">{item.status === 'in_review' ? 'In review' : 'Waiting'}</td>
              <td className="px-3 py-3 text-zinc-300">{[item.replaces_artwork && 'Cover art', Number(item.audio_replacement_count) > 0 && `${item.audio_replacement_count} audio`].filter(Boolean).join(', ') || '—'}
                {item.same_recording_required && <p className="text-xs text-amber-300">Same-song check</p>}</td>
              <td className="px-3 py-3 text-zinc-400">{new Date(item.submitted_at).toLocaleString()}</td>
              <td className="px-3 py-3"><ChangeRequestReviewDialog changeRequestId={item.id} title={item.release_title} /></td>
            </tr>)}</tbody>
          </table></div>}
  </section>
}

export function ChangeRequestReviewDialog({changeRequestId, title}: {changeRequestId: string; title: string}) {
  const [open, setOpen] = useState(false)
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm">Review</Button></DialogTrigger>
    <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto border-white/10 bg-[#111114] text-zinc-100">
      <DialogHeader><DialogTitle>Changes to {title}</DialogTitle><DialogDescription>Approving applies every change below to the live release at once.</DialogDescription></DialogHeader>
      {open && <ReviewBody changeRequestId={changeRequestId} onDone={() => setOpen(false)} />}
    </DialogContent>
  </Dialog>
}

function ReviewBody({changeRequestId, onDone}: {changeRequestId: string; onDone: () => void}) {
  const queryClient = useQueryClient()
  const review = useQuery({queryKey: ['marketplace-admin', 'change-request', changeRequestId], queryFn: () => getChangeRequestReview(changeRequestId)})
  const [sameSong, setSameSong] = useState(false)
  const [note, setNote] = useState('')
  const command = useMutation({
    mutationFn: (input: ChangeRequestCommand) => commandChangeRequest(changeRequestId, input),
    onSuccess: async (result, input) => {
      await Promise.all([
        queryClient.invalidateQueries({queryKey: ['marketplace-admin', 'change-requests']}),
        queryClient.invalidateQueries({queryKey: ['marketplace-admin', 'change-request', changeRequestId]}),
        queryClient.invalidateQueries({queryKey: ['marketplace-admin', 'overview']}),
      ])
      if (input.action === 'start_review') return
      toast({title: input.action === 'approve' ? 'Changes approved' : 'Changes rejected', description: result.release_date_needed ? 'The new date was saved. Schedule the release from the catalog.' : undefined})
      onDone()
    },
  })
  if (review.isError) return <p role="alert" className="text-sm text-red-300">{review.error.message}</p>
  if (!review.data) return <p className="text-sm text-zinc-500">Loading…</p>
  const data: ChangeRequestReview = review.data
  const request = data.request
  const open = request.status === 'submitted' || request.status === 'in_review'
  const blocked = data.stale.length > 0
  return <div className="space-y-5">
    <p className="text-sm text-zinc-400">Release is {data.release.status.toLowerCase()}. Submitted {request.submitted_at ? new Date(request.submitted_at).toLocaleString() : '—'}.</p>
    {blocked && <p role="alert" className="flex gap-2 rounded-md border border-red-400/30 bg-red-400/5 p-3 text-sm text-red-200"><AlertTriangle className="h-4 w-4 shrink-0" />The release changed after this request was submitted. Reject it so the artist can submit the changes again.</p>}
    <ul className="divide-y divide-white/10 rounded-md border border-white/10">{request.diff.map((item) => <DiffRow key={item.key} item={item} />)}</ul>
    {request.diff.length === 0 && <p className="text-sm text-zinc-500">Everything in this request already matches the release.</p>}
    {open && data.sameRecordingRequired && <div className="space-y-2 rounded-md border border-amber-400/30 bg-amber-400/5 p-3 text-sm">
      <p className="text-amber-200">{SAME_SONG_NOTE} Listen to the current and new audio above.</p>
      <Label className="flex items-center gap-2"><Checkbox checked={sameSong} onCheckedChange={(checked) => setSameSong(checked === true)} />I listened and it's the same song</Label>
    </div>}
    {command.isError && <p role="alert" className="text-sm text-red-300">{command.error.message}</p>}
    {open && <div className="space-y-3 border-t border-white/10 pt-4">
      {request.status === 'submitted' && <Button variant="outline" disabled={command.isPending} onClick={() => command.mutate({action: 'start_review'})}>Start review (locks the artist out)</Button>}
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button className="bg-emerald-400 text-zinc-950 hover:bg-emerald-300" disabled={command.isPending || blocked || (data.sameRecordingRequired && !sameSong)}
          onClick={() => command.mutate({action: 'approve', confirmSameRecording: sameSong})}>Approve and apply</Button>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`reject-note-${changeRequestId}`}>Reason (sent to the artist)</Label>
        <Textarea id={`reject-note-${changeRequestId}`} value={note} onChange={(event) => setNote(event.target.value)} placeholder="What needs to change before this can be approved" />
        <Button variant="outline" className="border-red-400/40 text-red-200" disabled={command.isPending || !note.trim()} onClick={() => command.mutate({action: 'reject', note: note.trim()})}>Reject</Button>
      </div>
    </div>}
  </div>
}

function DiffRow({item}: {item: ChangeDiffItem}) {
  const label = `${item.trackTitle ? `${item.trackTitle}: ` : ''}${item.label}`
  if (item.kind === 'asset') {
    const audio = item.key.endsWith('.audio')
    const preview = (assetId: unknown, caption: string) => typeof assetId === 'string'
      ? <figure className="space-y-1"><figcaption className="text-xs text-zinc-500">{caption}</figcaption>
        {audio ? <audio controls preload="none" src={reviewAssetUrl(assetId)} aria-label={`${caption} audio`} className="w-full" />
          : <img src={reviewAssetUrl(assetId)} alt={`${caption} cover art`} className="h-32 w-32 rounded object-cover" />}</figure>
      : <p className="text-xs text-zinc-500">{caption}: none</p>
    return <li className="space-y-2 p-3 text-sm"><p className="text-zinc-400">{label}</p><div className="grid gap-3 sm:grid-cols-2">{preview(item.before, 'Current')}{preview(item.after, 'New')}</div></li>
  }
  return <li className="grid gap-1 p-3 text-sm sm:grid-cols-[12rem_1fr]">
    <span className="text-zinc-400">{label}</span>
    <span><span className="text-zinc-500 line-through">{formatChangeValue(item.before)}</span> → <span className="text-zinc-100">{formatChangeValue(item.after)}</span></span>
  </li>
}
