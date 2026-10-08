import {useEffect, useState} from 'react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {AlertTriangle, FileText, Plus, ShieldCheck, Trash2, Upload} from 'lucide-react'

import {Button} from '@/components/ui/button'
import {Checkbox} from '@/components/ui/checkbox'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Textarea} from '@/components/ui/textarea'
import {toast} from '@/hooks/use-toast'
import {
  addRightsMaterial,
  deleteRightsMaterial,
  getReleaseCertification,
  listProviderArtists,
  replaceTrackCredits,
  saveReleaseCertification,
  uploadProviderAsset,
  type ContributorRole,
  type ProviderReleaseDetail,
  type ProviderTrack,
  type RightsLicenseType,
  type RightsMaterialType,
  type ThirdPartyMaterial,
  type TrackContributor,
} from '@/lib/providerApi'

const EDITABLE_STATUSES = ['DRAFT', 'METADATA_COMPLETE', 'RIGHTS_COMPLETE', 'ISRC_COMPLETE', 'PRICING_COMPLETE', 'CHANGES_REQUESTED']
const selectClass = 'h-10 w-full rounded-md border border-white/10 bg-zinc-950 px-3 text-sm'

const roleLabels: Record<ContributorRole, string> = {
  writer: 'Songwriter', composer: 'Composer', producer: 'Producer', featured_artist: 'Featured artist (other account)', remixer: 'Remixer', other: 'Other',
}

function Heading({title, detail}: {title: string; detail: string}) {
  return <div className="mb-7"><h1 className="text-2xl font-bold">{title}</h1><p className="mt-1 text-sm text-zinc-400">{detail}</p></div>
}

export function CreditsStep({detail}: {detail: ProviderReleaseDetail}) {
  const editable = EDITABLE_STATUSES.includes(detail.release.status)
  return <><Heading title="Credits" detail="Who performed, wrote and produced each track. Add what you know; leave anything genuinely unknown blank." />
    <div className="space-y-4">{detail.tracks.map((track) => <TrackCredits key={track.id} track={track} detail={detail} editable={editable} />)}</div>
    {detail.tracks.length === 0 && <p className="text-sm text-zinc-500">Add tracks before entering credits.</p>}
  </>
}

function TrackCredits({track, detail, editable}: {track: ProviderTrack; detail: ProviderReleaseDetail; editable: boolean}) {
  const queryClient = useQueryClient()
  const artists = useQuery({queryKey: ['provider', 'artists'], queryFn: listProviderArtists})
  const [featured, setFeatured] = useState<string[]>(track.featured_artist_ids ?? [])
  const [contributors, setContributors] = useState<TrackContributor[]>(track.contributors ?? [])
  const save = useMutation({
    mutationFn: () => replaceTrackCredits(track.id, {
      featuredArtistIds: featured,
      contributors: contributors.filter((row) => row.name.trim()).map((row) => ({...row, name: row.name.trim(), publisherName: row.publisherName?.trim() || null})),
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({queryKey: ['provider', 'release', detail.release.id]})
      toast({title: `Credits saved for ${track.title}`})
    },
  })
  const otherArtists = (artists.data ?? []).filter((artist) => artist.id !== detail.release.primary_artist_id)
  const update = (index: number, patch: Partial<TrackContributor>) => setContributors((rows) => rows.map((row, rowIndex) => rowIndex === index ? {...row, ...patch} : row))
  return <section className="rounded-md border border-white/10 bg-[#141417] p-5">
    <p className="font-medium">{track.track_number}. {track.title}</p>
    {otherArtists.length > 0 && <div className="mt-4"><p className="text-xs font-semibold uppercase text-zinc-500">Featured artists on your account</p>
      <div className="mt-2 flex flex-wrap gap-3">{otherArtists.map((artist) => <Label key={artist.id} className="flex items-center gap-2 text-sm"><Checkbox disabled={!editable} checked={featured.includes(artist.id)} onCheckedChange={(checked) => setFeatured((current) => checked === true ? [...current, artist.id] : current.filter((id) => id !== artist.id))} />{artist.name}</Label>)}</div>
    </div>}
    <div className="mt-5 space-y-3"><p className="text-xs font-semibold uppercase text-zinc-500">Contributors</p>
      {contributors.map((row, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1fr_12rem_1fr_auto]">
        <Input aria-label="Contributor name" placeholder="Name" value={row.name} disabled={!editable} onChange={(event) => update(index, {name: event.target.value})} />
        <select aria-label="Contributor role" className={selectClass} value={row.role} disabled={!editable} onChange={(event) => update(index, {role: event.target.value as ContributorRole})}>{Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
        <Input aria-label="Publisher" placeholder={row.role === 'writer' || row.role === 'composer' ? 'Publisher (optional)' : '—'} disabled={!editable || !(row.role === 'writer' || row.role === 'composer')} value={row.publisherName ?? ''} onChange={(event) => update(index, {publisherName: event.target.value})} />
        {editable && <Button type="button" variant="ghost" size="icon" aria-label="Remove contributor" onClick={() => setContributors((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}><Trash2 className="h-4 w-4" /></Button>}
      </div>)}
      {editable && <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => setContributors((rows) => [...rows, {name: '', role: 'writer', publisherName: null}])}><Plus className="h-4 w-4" />Add contributor</Button>}
    </div>
    {editable && <Button className="mt-5" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving...' : 'Save credits'}</Button>}
    {save.isError && <p className="mt-3 text-sm text-red-400">{save.error.message}</p>}
  </section>
}

const thirdPartyOptions: Array<{value: ThirdPartyMaterial; label: string; detail: string}> = [
  {value: 'none', label: 'No — entirely original material', detail: 'Everything in this recording was created by you and your credited collaborators.'},
  {value: 'licensed', label: 'Yes — I have documented rights/licenses', detail: 'Tell us what was used and attach the license or agreement. MeJay reviews it before approval.'},
  {value: 'unsure', label: 'Unsure', detail: 'MeJay will not approve this release until you verify your rights with our review team.'},
]

const materialTypeLabels: Record<RightsMaterialType, string> = {
  sample: 'Sample', interpolation: 'Interpolation', leased_beat: 'Leased beat', licensed_beat: 'Licensed beat', purchased_instrumental: 'Purchased instrumental', other: 'Other',
}
const licenseTypeLabels: Record<RightsLicenseType, string> = {
  exclusive_license: 'Exclusive license', non_exclusive_lease: 'Non-exclusive lease', sample_clearance: 'Sample clearance', work_for_hire: 'Work for hire', producer_agreement: 'Producer agreement', other: 'Other',
}

/** Rights & Originality Certification: the last step before Review & Submit. */
export function CertificationStep({detail, onBack, onContinue}: {detail: ProviderReleaseDetail; onBack: () => void; onContinue: () => void}) {
  const queryClient = useQueryClient()
  const releaseId = detail.release.id
  const editable = EDITABLE_STATUSES.includes(detail.release.status)
  const state = useQuery({queryKey: ['provider', 'release', releaseId, 'certification'], queryFn: () => getReleaseCertification(releaseId)})
  const [answer, setAnswer] = useState<ThirdPartyMaterial | null>(null)
  const [accepted, setAccepted] = useState<string[]>([])
  useEffect(() => {
    if (!state.data) return
    setAnswer((current) => current ?? state.data.draft?.thirdPartyMaterial ?? null)
    if (state.data.draft?.version === state.data.version) setAccepted((current) => current.length ? current : state.data.draft!.accepted)
  }, [state.data])
  const save = useMutation({
    mutationFn: () => saveReleaseCertification(releaseId, {version: state.data!.version, thirdPartyMaterial: answer!, accepted}),
    onSuccess: async () => {
      await queryClient.invalidateQueries({queryKey: ['provider', 'release', releaseId]})
      onContinue()
    },
  })
  if (state.isLoading) return <p className="text-sm text-zinc-400">Loading certification...</p>
  if (state.isError || !state.data) return <p className="text-sm text-red-400">{state.error?.message || 'Certification is unavailable'}</p>
  const data = state.data
  const allAccepted = data.requiredKeys.every((key) => accepted.includes(key))
  const needsMaterials = answer === 'licensed' && data.materials.length === 0
  const ready = editable && answer !== null && allAccepted && !needsMaterials

  return <>
    <Heading title="Rights Certification" detail="Confirm you have the rights to release this music. This takes a minute." />
    <div className="flex gap-3 rounded-md border border-emerald-400/30 bg-emerald-400/5 p-4 text-sm text-zinc-200"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" /><p>{data.policy}</p></div>
    {!editable && <p className="mt-4 text-sm text-zinc-400">This release is {detail.release.status.replace(/_/g, ' ').toLowerCase()} and can no longer be changed.</p>}

    <section className="mt-8"><h2 className="text-base font-semibold">Does this recording contain samples, interpolations, leased beats, licensed beats, purchased instrumentals, or other third-party material?</h2>
      <div className="mt-3 grid gap-3" role="radiogroup" aria-label="Third-party material">{thirdPartyOptions.map((option) => <button key={option.value} type="button" role="radio" aria-checked={answer === option.value} disabled={!editable} onClick={() => setAnswer(option.value)} className={`rounded-md border p-4 text-left text-sm ${answer === option.value ? 'border-emerald-400 bg-emerald-400/10' : 'border-white/10 bg-[#141417] hover:border-white/20'}`}><p className="font-medium text-zinc-100">{option.label}</p><p className="mt-1 text-zinc-400">{option.detail}</p></button>)}</div>
    </section>

    {answer === 'unsure' && <div className="mt-4 flex gap-3 rounded-md border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-200"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" /><p>You can submit, but MeJay will hold this release for rights review. You must verify that you own or control every part of the recording before it can be approved.</p></div>}
    {answer === 'licensed' && <RightsMaterials releaseId={releaseId} materials={data.materials} editable={editable} />}

    <section className="mt-8"><h2 className="text-base font-semibold">Certifications</h2><p className="mt-1 text-sm text-zinc-400">Check each statement that is true. All are required.</p>
      <div className="mt-3 grid gap-3">{data.statements.map((statement) => <Label key={statement.key} className={`flex cursor-pointer items-start gap-3 rounded-md border p-4 ${accepted.includes(statement.key) ? 'border-emerald-400/40 bg-emerald-400/5' : 'border-white/10 bg-[#141417]'}`}>
        <Checkbox className="mt-0.5" disabled={!editable} checked={accepted.includes(statement.key)} onCheckedChange={(checked) => setAccepted((current) => checked === true ? [...new Set([...current, statement.key])] : current.filter((key) => key !== statement.key))} />
        <span><span className="block font-medium text-zinc-100">{statement.title}</span><span className="mt-1 block text-sm font-normal text-zinc-400">{statement.text}</span></span>
      </Label>)}</div>
      <p className="mt-3 text-xs text-zinc-500">The beat does not have to be produced by you. Producer-created beats are fine when you have the rights; licensed beats are acceptable only when the license allows commercial sale and distribution.</p>
    </section>

    {save.isError && <p className="mt-5 text-sm text-red-400">{save.error.message}</p>}
    <div className="mt-8 flex justify-between gap-3 border-t border-white/10 pt-5">
      <Button variant="outline" onClick={onBack}>Back</Button>
      <Button className="bg-emerald-400 text-zinc-950 hover:bg-emerald-300" disabled={!ready || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving...' : 'Review Submission'}</Button>
    </div>
    {editable && !ready && <p className="mt-2 text-right text-xs text-zinc-500">{answer === null ? 'Answer the third-party material question.' : needsMaterials ? 'Add the third-party material you used.' : 'Check every certification to continue.'}</p>}
  </>
}

function RightsMaterials({releaseId, materials, editable}: {releaseId: string; materials: Array<{id: string; material_type: RightsMaterialType; licensor_name: string; description: string; license_type: RightsLicenseType; document_asset_id: string | null}>; editable: boolean}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState({materialType: 'leased_beat' as RightsMaterialType, licensorName: '', description: '', licenseType: 'non_exclusive_lease' as RightsLicenseType})
  const [file, setFile] = useState<File | null>(null)
  const refresh = () => queryClient.invalidateQueries({queryKey: ['provider', 'release', releaseId, 'certification']})
  const add = useMutation({
    mutationFn: async () => {
      let documentAssetId: string | null = null
      if (file) {
        documentAssetId = await uploadProviderAsset({kind: 'rights_document', releaseId, fileName: file.name, mimeType: file.type as 'application/pdf' | 'image/jpeg' | 'image/png', byteSize: file.size}, file)
      }
      return addRightsMaterial(releaseId, {...form, licensorName: form.licensorName.trim(), description: form.description.trim(), documentAssetId})
    },
    onSuccess: async () => {
      setForm((current) => ({...current, licensorName: '', description: ''}))
      setFile(null)
      await refresh()
    },
  })
  const remove = useMutation({mutationFn: deleteRightsMaterial, onSuccess: refresh})
  return <section className="mt-5 rounded-md border border-white/10 bg-[#141417] p-5"><h3 className="font-medium">Third-party material</h3>
    {materials.length === 0 ? <p className="mt-2 text-sm text-zinc-500">Nothing added yet.</p> : <ul className="mt-3 divide-y divide-white/10">{materials.map((material) => <li key={material.id} className="flex items-start gap-3 py-3 text-sm">
      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500" />
      <div className="min-w-0 flex-1"><p className="font-medium">{materialTypeLabels[material.material_type]} · {material.licensor_name}</p><p className="text-zinc-400">{material.description}</p><p className="text-xs text-zinc-500">{licenseTypeLabels[material.license_type]} · {material.document_asset_id ? 'Document attached' : 'No document — MeJay will review before approval'}</p></div>
      {editable && <Button variant="ghost" size="icon" aria-label="Remove material" disabled={remove.isPending} onClick={() => remove.mutate(material.id)}><Trash2 className="h-4 w-4" /></Button>}
    </li>)}</ul>}
    {editable && <div className="mt-4 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-2">
      <div className="space-y-1"><Label>Material type</Label><select className={selectClass} value={form.materialType} onChange={(event) => setForm({...form, materialType: event.target.value as RightsMaterialType})}>{Object.entries(materialTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div className="space-y-1"><Label>License type</Label><select className={selectClass} value={form.licenseType} onChange={(event) => setForm({...form, licenseType: event.target.value as RightsLicenseType})}>{Object.entries(licenseTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      <div className="space-y-1 sm:col-span-2"><Label>Producer / licensor</Label><Input value={form.licensorName} onChange={(event) => setForm({...form, licensorName: event.target.value})} placeholder="Who you licensed it from" /></div>
      <div className="space-y-1 sm:col-span-2"><Label>Description</Label><Textarea value={form.description} onChange={(event) => setForm({...form, description: event.target.value})} placeholder="What was used and where it appears" /></div>
      <div className="space-y-1 sm:col-span-2"><Label>License or agreement (PDF, JPG or PNG, up to 15 MB)</Label><Input type="file" accept="application/pdf,image/jpeg,image/png" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></div>
      <Button className="gap-2 sm:col-span-2" disabled={!form.licensorName.trim() || !form.description.trim() || add.isPending} onClick={() => add.mutate()}><Upload className="h-4 w-4" />{add.isPending ? 'Adding...' : 'Add material'}</Button>
      {add.isError && <p className="text-sm text-red-400 sm:col-span-2">{add.error.message}</p>}
    </div>}
  </section>
}
