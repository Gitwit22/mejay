import {useState} from 'react'
import {useMutation, useQueryClient} from '@tanstack/react-query'
import {Clock, Lock, PencilLine, ShieldCheck} from 'lucide-react'
import {Link} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle} from '@/components/ui/dialog'
import {toast} from '@/hooks/use-toast'
import {withdrawProviderRelease, type ProviderReleaseDetail} from '@/lib/providerApi'
import {releaseEditState} from '@/lib/releaseEditState'

/** Explains why a release can't be edited right now, and offers the one way forward (if any). */
export function ReleaseLockBanner({release}: {release: ProviderReleaseDetail['release']}) {
  const state = releaseEditState(release.status)
  const queryClient = useQueryClient()
  const [confirming, setConfirming] = useState(false)
  const withdraw = useMutation({
    mutationFn: () => withdrawProviderRelease(release.id, release.version),
    onSuccess: async () => {
      setConfirming(false)
      await Promise.all([queryClient.invalidateQueries({queryKey: ['provider', 'release', release.id]}), queryClient.invalidateQueries({queryKey: ['provider', 'releases']})])
      toast({title: 'Release unlocked for editing', description: 'Submit it again when you are done.'})
    },
    onError: async () => {
      // Most often a reviewer just opened it; refresh so the banner shows the new state.
      await queryClient.invalidateQueries({queryKey: ['provider', 'release', release.id]})
    },
  })
  if (state === 'editable') return null

  const box = 'mb-6 flex flex-col gap-3 rounded-md border p-4 text-sm sm:flex-row sm:items-center'
  if (state === 'withdrawable') {
    return <>
      <div role="status" className={`${box} border-sky-400/30 bg-sky-400/5`}>
        <Clock className="h-5 w-5 shrink-0 text-sky-300" />
        <div className="flex-1"><p className="font-semibold text-zinc-100">Waiting for MeJay review</p><p className="text-zinc-400">Everything is locked while your release waits in the review queue.</p></div>
        <Button type="button" variant="outline" className="gap-2" onClick={() => setConfirming(true)}><PencilLine className="h-4 w-4" />Edit</Button>
      </div>
      <Dialog open={confirming} onOpenChange={(open) => { setConfirming(open); if (!open) withdraw.reset() }}>
        <DialogContent className="border-white/10 bg-[#151518]">
          <DialogHeader><DialogTitle>Edit this release?</DialogTitle><DialogDescription>This takes your release out of the review queue and unlocks every field. When you're done, confirm the rights certification again and resubmit.</DialogDescription></DialogHeader>
          {withdraw.isError && <p role="alert" className="text-sm text-red-400">{withdraw.error.message}</p>}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setConfirming(false)} disabled={withdraw.isPending}>Cancel</Button>
            <Button type="button" className="bg-emerald-400 text-zinc-950 hover:bg-emerald-300" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>{withdraw.isPending ? 'Unlocking…' : 'Unlock and edit'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  }
  if (state === 'in_review') {
    return <div role="status" className={`${box} border-amber-400/30 bg-amber-400/5`}>
      <Lock className="h-5 w-5 shrink-0 text-amber-300" />
      <div className="flex-1"><p className="font-semibold text-zinc-100">MeJay is reviewing this release</p><p className="text-zinc-400">Editing is paused until the review is finished.</p></div>
    </div>
  }
  if (state === 'approved') {
    return <div role="status" className={`${box} border-emerald-400/30 bg-emerald-400/5`}>
      <ShieldCheck className="h-5 w-5 shrink-0 text-emerald-300" />
      <div className="flex-1"><p className="font-semibold text-zinc-100">Approved: changes need MeJay approval</p><p className="text-zinc-400">Your release stays as it is until MeJay approves the changes you request.</p></div>
      <Button asChild variant="outline" className="gap-2"><Link to={`/app/artist/releases/${release.id}/changes`}><PencilLine className="h-4 w-4" />Request changes</Link></Button>
    </div>
  }
  return <div role="status" className={`${box} border-white/10 bg-white/[0.03]`}>
    <Lock className="h-5 w-5 shrink-0 text-zinc-400" />
    <div className="flex-1"><p className="font-semibold text-zinc-100">This release is {release.status.replace(/_/g, ' ').toLowerCase()}</p><p className="text-zinc-400">It can no longer be edited. Contact MeJay support if you need help.</p></div>
  </div>
}
