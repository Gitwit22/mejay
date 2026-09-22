import {useState} from 'react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {ArrowLeft, Check, ChevronRight, Disc3, Upload} from 'lucide-react'
import {Link, useNavigate, useParams} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Checkbox} from '@/components/ui/checkbox'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Switch} from '@/components/ui/switch'
import {toast} from '@/hooks/use-toast'
import {
  assignProviderIsrc,
  createProviderPricing,
  createProviderRights,
  createProviderTrack,
  generateProviderIsrc,
  getProviderRelease,
  listProviderArtists,
  replaceProviderSplits,
  submitProviderRelease,
  type ProviderReleaseDetail,
  type ProviderTrack,
  type ReleaseDraftStep,
  updateProviderRelease,
  updateProviderTrack,
  uploadProviderAsset,
} from '@/lib/providerApi'

const steps: Array<{id: ReleaseDraftStep; label: string}> = [
  {id: 'release-information', label: 'Release Information'},
  {id: 'artwork', label: 'Upload Artwork'},
  {id: 'tracks', label: 'Upload Tracks'},
  {id: 'track-metadata', label: 'Track Metadata'},
  {id: 'isrc', label: 'ISRC'},
  {id: 'rights', label: 'Rights'},
  {id: 'pricing', label: 'Pricing'},
  {id: 'splits', label: 'Splits'},
  {id: 'review', label: 'Review & Submit'},
]

export default function ReleaseWizardPage() {
  const {releaseId = '', step = 'release-information'} = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const detail = useQuery({queryKey: ['provider', 'release', releaseId], queryFn: () => getProviderRelease(releaseId), enabled: Boolean(releaseId)})
  const activeStep = steps.some((item) => item.id === step) ? step as ReleaseDraftStep : 'release-information'
  const advance = useMutation({
    mutationFn: async (next: ReleaseDraftStep) => {
      if (!detail.data) throw new Error('Release is still loading')
      const release = detail.data.release
      return updateProviderRelease(releaseId, {
        expectedVersion: release.version, draftStep: next, title: release.title,
        versionTitle: release.version_title, releaseType: release.release_type,
        primaryArtistId: release.primary_artist_id, labelName: release.label_name,
        catalogNumber: release.catalog_number, genre: release.genre, subgenre: release.subgenre,
        upc: release.upc, originalReleaseDate: release.original_release_date,
        scheduledReleaseAt: release.scheduled_release_at, copyrightYear: release.copyright_year,
        copyrightHolder: release.copyright_holder, phonographicCopyrightYear: release.phonographic_copyright_year,
        phonographicCopyrightHolder: release.phonographic_copyright_holder,
      })
    },
    onSuccess: async (_release, next) => {
      await queryClient.invalidateQueries({queryKey: ['provider', 'release', releaseId]})
      navigate(`/app/artist/releases/${releaseId}/edit/${next}`)
    },
  })

  if (detail.isLoading) return <div className="grid min-h-screen place-items-center bg-[#09090b] text-zinc-400">Loading release...</div>
  if (detail.isError || !detail.data) return <div className="grid min-h-screen place-items-center bg-[#09090b] text-red-300">{detail.error?.message || 'Release not found'}</div>
  const index = steps.findIndex((item) => item.id === activeStep)
  const next = steps[index + 1]?.id

  return <div className="min-h-screen bg-[#09090b] text-zinc-100">
    <header className="border-b border-white/10 px-4 py-4 sm:px-8"><div className="mx-auto flex max-w-7xl items-center gap-4">
      <Button asChild variant="ghost" size="icon"><Link to="/app/artist" aria-label="Back to releases"><ArrowLeft /></Link></Button>
      <div className="min-w-0"><p className="truncate font-semibold">{detail.data.release.title}</p><p className="text-xs text-zinc-500">Release draft</p></div>
      <span className="ml-auto rounded-full border border-white/10 px-3 py-1 text-xs">{detail.data.release.status}</span>
    </div></header>
    <div className="mx-auto grid max-w-7xl gap-8 px-4 py-7 lg:grid-cols-[14rem_1fr] lg:px-8">
      <nav aria-label="Release steps" className="flex gap-2 overflow-x-auto lg:block lg:space-y-1">
        {steps.map((item, itemIndex) => <Link key={item.id} to={`/app/artist/releases/${releaseId}/edit/${item.id}`} className={`flex shrink-0 items-center gap-3 rounded-md px-3 py-2 text-sm ${item.id === activeStep ? 'bg-emerald-400 text-zinc-950' : 'text-zinc-400 hover:bg-white/5'}`}>
          <span className="grid h-6 w-6 place-items-center rounded-full border border-current text-xs">{itemIndex < index ? <Check className="h-3 w-3" /> : itemIndex + 1}</span>{item.label}
        </Link>)}
      </nav>
      <main className="min-w-0 max-w-3xl">
        {activeStep === 'release-information' && <ReleaseInformation detail={detail.data} />}
        {activeStep === 'artwork' && <ArtworkStep releaseId={releaseId} detail={detail.data} />}
        {activeStep === 'tracks' && <TracksStep releaseId={releaseId} detail={detail.data} />}
        {activeStep === 'track-metadata' && <MetadataStep detail={detail.data} />}
        {activeStep === 'isrc' && <IsrcStep detail={detail.data} />}
        {activeStep === 'rights' && <RightsStep detail={detail.data} />}
        {activeStep === 'pricing' && <PricingStep detail={detail.data} />}
        {activeStep === 'splits' && <SplitsStep detail={detail.data} />}
        {activeStep === 'review' && <ReviewStep detail={detail.data} />}
        {advance.isError && <p className="mt-5 text-sm text-red-400">{advance.error.message}</p>}
        {next && <div className="mt-8 flex justify-end border-t border-white/10 pt-5"><Button onClick={() => advance.mutate(next)} disabled={advance.isPending} className="gap-2 bg-emerald-400 text-zinc-950 hover:bg-emerald-300">Save and continue <ChevronRight className="h-4 w-4" /></Button></div>}
      </main>
    </div>
  </div>
}

function StepHeading({title, detail}: {title: string; detail: string}) {
  return <div className="mb-7"><h1 className="text-2xl font-bold">{title}</h1><p className="mt-1 text-sm text-zinc-400">{detail}</p></div>
}

function ReleaseInformation({detail}: {detail: ProviderReleaseDetail}) {
  const queryClient = useQueryClient()
  const release = detail.release
  const artists = useQuery({queryKey: ['provider', 'artists'], queryFn: listProviderArtists})
  const [form, setForm] = useState({title: release.title, versionTitle: release.version_title || '', releaseType: release.release_type, primaryArtistId: release.primary_artist_id, labelName: release.label_name || '', catalogNumber: release.catalog_number || '', genre: release.genre || '', subgenre: release.subgenre || '', upc: release.upc || '', originalReleaseDate: release.original_release_date || '', copyrightYear: release.copyright_year?.toString() || '', copyrightHolder: release.copyright_holder || '', phonographicCopyrightYear: release.phonographic_copyright_year?.toString() || '', phonographicCopyrightHolder: release.phonographic_copyright_holder || ''})
  const save = useMutation({mutationFn: () => updateProviderRelease(release.id, {expectedVersion: release.version, draftStep: 'release-information', ...form, versionTitle: form.versionTitle || null, labelName: form.labelName || null, catalogNumber: form.catalogNumber || null, genre: form.genre || null, subgenre: form.subgenre || null, upc: form.upc || null, originalReleaseDate: form.originalReleaseDate || null, copyrightYear: form.copyrightYear ? Number(form.copyrightYear) : null, copyrightHolder: form.copyrightHolder || null, phonographicCopyrightYear: form.phonographicCopyrightYear ? Number(form.phonographicCopyrightYear) : null, phonographicCopyrightHolder: form.phonographicCopyrightHolder || null}), onSuccess: async () => {await queryClient.invalidateQueries({queryKey: ['provider', 'release', release.id]}); toast({title: 'Release information saved'})}})
  const field = (key: keyof typeof form) => ({value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({...form, [key]: event.target.value})})
  return <><StepHeading title="Release Information" detail="Core catalog details for this release." /><form onSubmit={(event) => {event.preventDefault(); save.mutate()}} className="grid gap-5 sm:grid-cols-2">
    <Field label="Release title"><Input required {...field('title')} /></Field><Field label="Version"><Input placeholder="Optional" {...field('versionTitle')} /></Field>
    <Field label="Release type"><select className="h-10 w-full rounded-md border border-white/10 bg-zinc-950 px-3 text-sm" {...field('releaseType')}><option value="single">Single</option><option value="ep">EP</option><option value="album">Album</option></select></Field>
    <Field label="Primary artist"><select required className="h-10 w-full rounded-md border border-white/10 bg-zinc-950 px-3 text-sm" {...field('primaryArtistId')}>{artists.data?.map((artist) => <option key={artist.id} value={artist.id}>{artist.name}</option>)}</select></Field>
    <Field label="Label"><Input {...field('labelName')} /></Field><Field label="Catalog number"><Input {...field('catalogNumber')} /></Field>
    <Field label="Genre"><Input {...field('genre')} /></Field><Field label="Subgenre"><Input {...field('subgenre')} /></Field>
    <Field label="UPC"><Input inputMode="numeric" {...field('upc')} /></Field><Field label="Original release date"><Input type="date" {...field('originalReleaseDate')} /></Field>
    <Field label="Copyright year"><Input type="number" min="1900" max="2200" {...field('copyrightYear')} /></Field><Field label="Copyright holder"><Input {...field('copyrightHolder')} /></Field>
    <Field label="Phonographic copyright year"><Input type="number" min="1900" max="2200" {...field('phonographicCopyrightYear')} /></Field><Field label="Phonographic copyright holder"><Input {...field('phonographicCopyrightHolder')} /></Field>
    {save.isError && <p className="text-sm text-red-400 sm:col-span-2">{save.error.message}</p>}<Button disabled={save.isPending} className="sm:col-span-2">{save.isPending ? 'Saving...' : 'Save information'}</Button>
  </form></>
}

function Field({label, children}: {label: string; children: React.ReactNode}) { return <div className="space-y-2"><Label>{label}</Label>{children}</div> }

function ArtworkStep({releaseId, detail}: {releaseId: string; detail: ProviderReleaseDetail}) {
  const queryClient = useQueryClient()
  const ready = detail.assets.find((asset) => asset.kind === 'artwork' && asset.processing_status === 'ready')
  const upload = useMutation({mutationFn: async (file: File) => {const image = await createImageBitmap(file); try {await uploadProviderAsset({kind: 'artwork', releaseId, fileName: file.name, mimeType: file.type as 'image/jpeg' | 'image/png' | 'image/webp', byteSize: file.size, width: image.width, height: image.height}, file)} finally {image.close()}}, onSuccess: async () => {await queryClient.invalidateQueries({queryKey: ['provider', 'release', releaseId]}); toast({title: 'Artwork uploaded'})}})
  return <><StepHeading title="Upload Artwork" detail="JPEG, PNG, or WebP. Exactly square, at least 3000 x 3000, up to 20 MB." /><label className="grid min-h-64 cursor-pointer place-items-center rounded-md border border-dashed border-white/20 bg-white/[0.02] p-8 text-center hover:border-emerald-400/50"><div><Upload className="mx-auto h-8 w-8 text-emerald-400" /><p className="mt-3 font-medium">{upload.isPending ? 'Uploading...' : ready ? 'Replace artwork' : 'Choose artwork'}</p>{ready && <p className="mt-1 text-sm text-emerald-400">Current artwork is ready</p>}</div><input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={upload.isPending} onChange={(event) => {const file = event.target.files?.[0]; if (file) upload.mutate(file)}} /></label>{upload.isError && <p className="mt-4 text-sm text-red-400">{upload.error.message}</p>}</>
}

function TracksStep({releaseId, detail}: {releaseId: string; detail: ProviderReleaseDetail}) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const create = useMutation({mutationFn: () => createProviderTrack(releaseId, {title: title.trim(), primaryArtistId: detail.release.primary_artist_id, trackNumber: detail.tracks.length + 1}), onSuccess: async () => {setTitle(''); await queryClient.invalidateQueries({queryKey: ['provider', 'release', releaseId]})}})
  return <><StepHeading title="Upload Tracks" detail="Create the sequence, then attach a WAV or FLAC master up to 500 MB." /><form className="flex gap-3" onSubmit={(event) => {event.preventDefault(); create.mutate()}}><Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Track title" required /><Button disabled={!title.trim() || create.isPending}>Add track</Button></form>
    <div className="mt-6 divide-y divide-white/10 border-y border-white/10">{detail.tracks.map((track) => <TrackUploadRow key={track.id} track={track} ready={detail.assets.some((asset) => asset.track_id === track.id && asset.kind === 'audio' && asset.processing_status === 'ready')} releaseId={releaseId} />)}</div>
    {detail.tracks.length === 0 && <p className="mt-8 text-center text-sm text-zinc-500">No tracks yet.</p>}</>
}

function TrackUploadRow({track, ready, releaseId}: {track: ProviderTrack; ready: boolean; releaseId: string}) {
  const queryClient = useQueryClient()
  const upload = useMutation({mutationFn: (file: File) => uploadProviderAsset({kind: 'audio', trackId: track.id, fileName: file.name, mimeType: (file.type || (file.name.toLowerCase().endsWith('.flac') ? 'audio/flac' : 'audio/wav')) as 'audio/wav' | 'audio/flac', byteSize: file.size}, file), onSuccess: () => queryClient.invalidateQueries({queryKey: ['provider', 'release', releaseId]})})
  return <div className="flex items-center gap-4 py-4"><Disc3 className="h-5 w-5 text-zinc-500" /><div className="min-w-0 flex-1"><p className="truncate font-medium">{track.track_number}. {track.title}</p><p className={`text-xs ${ready ? 'text-emerald-400' : 'text-zinc-500'}`}>{ready ? 'Master ready' : 'Master required'}</p></div><Button asChild variant="outline" size="sm"><label className="cursor-pointer">{upload.isPending ? 'Uploading...' : ready ? 'Replace' : 'Upload'}<input className="sr-only" type="file" accept=".wav,.flac,audio/wav,audio/flac" disabled={upload.isPending} onChange={(event) => {const file = event.target.files?.[0]; if (file) upload.mutate(file)}} /></label></Button></div>
}

function MetadataStep({detail}: {detail: ProviderReleaseDetail}) {
  return <><StepHeading title="Track Metadata" detail="Review and edit metadata for every recording." /><div className="space-y-4">{detail.tracks.map((track) => <TrackMetadataForm key={track.id} track={track} artistId={detail.release.primary_artist_id} releaseId={detail.release.id} />)}</div>{detail.tracks.length === 0 && <p className="text-sm text-zinc-500">Add tracks before entering metadata.</p>}</>
}

function TrackMetadataForm({track, artistId, releaseId}: {track: ProviderTrack; artistId: string; releaseId: string}) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(track.title), [genre, setGenre] = useState(track.genre || ''), [language, setLanguage] = useState(track.language_code || ''), [explicit, setExplicit] = useState(track.explicit), [instrumental, setInstrumental] = useState(track.instrumental || false)
  const save = useMutation({mutationFn: () => updateProviderTrack(track.id, {title, primaryArtistId: artistId, discNumber: track.disc_number, trackNumber: track.track_number, durationMs: track.duration_ms, explicit, languageCode: language || null, genre: genre || null, instrumental}), onSuccess: async () => {await queryClient.invalidateQueries({queryKey: ['provider', 'release', releaseId]}); toast({title: `${title} saved`})}})
  return <form onSubmit={(event) => {event.preventDefault(); save.mutate()}} className="grid gap-4 rounded-md border border-white/10 bg-[#141417] p-5 sm:grid-cols-2"><Field label="Title"><Input value={title} onChange={(event) => setTitle(event.target.value)} required /></Field><Field label="Genre"><Input value={genre} onChange={(event) => setGenre(event.target.value)} /></Field><Field label="Language code"><Input value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="en" maxLength={3} /></Field><div className="flex items-end gap-6 pb-2"><Label className="flex items-center gap-2"><Switch checked={explicit} onCheckedChange={setExplicit} />Explicit</Label><Label className="flex items-center gap-2"><Switch checked={instrumental} onCheckedChange={setInstrumental} />Instrumental</Label></div><Button className="sm:col-span-2" disabled={save.isPending}>Save track metadata</Button></form>
}

function IsrcStep({detail}: {detail: ProviderReleaseDetail}) {
  return <><StepHeading title="ISRC" detail="Register an existing ISRC or certify the recording so MEJay can permanently assign the next QTA3L code." /><div className="divide-y divide-white/10 border-y border-white/10">{detail.tracks.map((track) => <IsrcRow key={track.id} track={track} releaseId={detail.release.id} />)}</div>{detail.tracks.length === 0 && <p className="text-sm text-zinc-500">Add tracks before assigning ISRCs.</p>}</>
}

function IsrcRow({track, releaseId}: {track: ProviderTrack; releaseId: string}) {
  const queryClient = useQueryClient()
  const [value, setValue] = useState('')
  const [controlsRecording, setControlsRecording] = useState(false)
  const [neverAssignedIsrc, setNeverAssignedIsrc] = useState(false)
  const [authorizeAssignment, setAuthorizeAssignment] = useState(false)
  const mejayReady = controlsRecording && neverAssignedIsrc && authorizeAssignment
  const assign = useMutation({
    mutationFn: (generated: boolean) => generated
      ? generateProviderIsrc(track.id, {controlsRecording: true, neverAssignedIsrc: true, authorizeAssignment: true})
      : assignProviderIsrc(track.id, value),
    onSuccess: async () => {
      setValue('')
      setControlsRecording(false)
      setNeverAssignedIsrc(false)
      setAuthorizeAssignment(false)
      await queryClient.invalidateQueries({queryKey: ['provider', 'release', releaseId]})
    },
  })
  return <div className="space-y-4 py-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="font-medium">{track.track_number}. {track.title}</p>
        <p className="mt-1 text-sm text-zinc-500">Does this recording already have an ISRC?</p>
      </div>
      {track.isrc && <div className="text-right">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-400">ISRC Assigned</p>
        <p className="mt-1 font-mono text-sm text-emerald-300">{formatIsrc(track.isrc)}</p>
      </div>}
    </div>
    {!track.isrc && <div className="grid gap-4 rounded-md border border-white/10 bg-[#141417] p-4 lg:grid-cols-2">
      <div className="space-y-3">
        <p className="text-sm font-medium text-zinc-100">Enter Existing ISRC</p>
        <Input className="max-w-full font-mono" value={value} onChange={(event) => setValue(event.target.value)} placeholder="QT-A3L-YY-NNNNN" />
        <Button variant="outline" disabled={!value.trim() || assign.isPending} onClick={() => assign.mutate(false)}>Register existing ISRC</Button>
      </div>
      <div className="space-y-3">
        <p className="text-sm font-medium text-zinc-100">Have MEJay Assign One</p>
        <div className="space-y-2 text-sm text-zinc-300">
          <Label className="flex items-start gap-3"><Checkbox checked={controlsRecording} onCheckedChange={(checked) => setControlsRecording(checked === true)} /><span>I control this recording</span></Label>
          <Label className="flex items-start gap-3"><Checkbox checked={neverAssignedIsrc} onCheckedChange={(checked) => setNeverAssignedIsrc(checked === true)} /><span>This recording has never received an ISRC</span></Label>
          <Label className="flex items-start gap-3"><Checkbox checked={authorizeAssignment} onCheckedChange={(checked) => setAuthorizeAssignment(checked === true)} /><span>I authorize MEJay to assign the identifier</span></Label>
        </div>
        <Button disabled={!mejayReady || assign.isPending} onClick={() => assign.mutate(true)}>Have MEJay Assign One</Button>
      </div>
    </div>}
    {assign.isError && <p className="text-sm text-red-400">{assign.error.message}</p>}
  </div>
}

function formatIsrc(value: string) {const canonical = value.replace(/[-\s]/g, '').toUpperCase(); return canonical.length === 12 ? `${canonical.slice(0, 2)}-${canonical.slice(2, 5)}-${canonical.slice(5, 7)}-${canonical.slice(7)}` : value}

function RightsStep({detail}: {detail: ProviderReleaseDetail}) {
  const queryClient = useQueryClient()
  const [holder, setHolder] = useState(detail.release.copyright_holder || detail.release.primary_artist_name || '')
  const missing = [
    ...(!detail.rights.some((right) => right.release_id === detail.release.id && right.declaration_type === 'distribution') ? [{releaseId: detail.release.id, declarationType: 'distribution' as const}] : []),
    ...detail.tracks.flatMap((track) => (['master', 'composition'] as const).filter((type) => !detail.rights.some((right) => right.track_id === track.id && right.declaration_type === type)).map((declarationType) => ({trackId: track.id, declarationType}))),
  ]
  const save = useMutation({mutationFn: async () => {for (const declaration of missing) await createProviderRights({...declaration, rightsHolder: holder.trim(), ownershipBps: 10000, territories: ['WORLD']})}, onSuccess: async () => {await queryClient.invalidateQueries({queryKey: ['provider', 'release', detail.release.id]}); toast({title: 'Rights declarations saved'})}})
  return <><StepHeading title="Rights" detail="Affirm worldwide distribution, master, and composition ownership before submission." /><div className="space-y-5"><Field label="Rights holder"><Input value={holder} onChange={(event) => setHolder(event.target.value)} required /></Field><div className="border-y border-white/10 py-4 text-sm text-zinc-400">{missing.length === 0 ? <span className="text-emerald-400">All required rights are declared at 100%.</span> : `${missing.length} declarations will be recorded at 100% worldwide ownership.`}</div><Button disabled={!holder.trim() || missing.length === 0 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving...' : missing.length === 0 ? 'Rights complete' : 'Affirm and save rights'}</Button>{save.isError && <p className="text-sm text-red-400">{save.error.message}</p>}</div></>
}

function PricingStep({detail}: {detail: ProviderReleaseDetail}) {
  const queryClient = useQueryClient()
  const [price, setPrice] = useState(detail.product?.amount_minor != null ? (detail.product.amount_minor / 100).toFixed(2) : '1.00')
  const numericPrice = Number(price)
  const save = useMutation({mutationFn: () => createProviderPricing(detail.release.id, detail.release.title, Math.round(Number(price) * 100)), onSuccess: async () => {await queryClient.invalidateQueries({queryKey: ['provider', 'release', detail.release.id]}); toast({title: 'Release price saved'})}})
  return <><StepHeading title="Pricing" detail="Every MEJay release is sold in USD for at least $1.00." /><div className="max-w-sm space-y-5"><Field label="USD price"><Input type="number" min="1" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} disabled={Boolean(detail.product)} /></Field>{detail.product ? <p className="text-sm text-emerald-400">Current price: ${(Number(detail.product.amount_minor) / 100).toFixed(2)} USD</p> : <Button disabled={!Number.isFinite(numericPrice) || numericPrice < 1 || save.isPending} onClick={() => save.mutate()}>Save price</Button>}{save.isError && <p className="text-sm text-red-400">{save.error.message}</p>}</div></>
}

function SplitsStep({detail}: {detail: ProviderReleaseDetail}) {
  return <><StepHeading title="Splits" detail="Every track needs an active split totaling exactly 100%." /><div className="space-y-4">{detail.tracks.map((track) => <TrackSplitForm key={track.id} track={track} detail={detail} />)}</div></>
}

function TrackSplitForm({track, detail}: {track: ProviderTrack; detail: ProviderReleaseDetail}) {
  const queryClient = useQueryClient()
  const existing = detail.splits.filter((split) => split.track_id === track.id)
  const [payee, setPayee] = useState(existing[0]?.payee_name || detail.release.primary_artist_name || '')
  const save = useMutation({mutationFn: () => replaceProviderSplits(track.id, [{payeeName: payee.trim(), role: 'rights_holder', shareBps: 10000}]), onSuccess: async () => {await queryClient.invalidateQueries({queryKey: ['provider', 'release', detail.release.id]}); toast({title: `${track.title} split saved`})}})
  return <div className="rounded-md border border-white/10 bg-[#141417] p-5"><p className="mb-4 font-medium">{track.track_number}. {track.title}</p><div className="flex flex-wrap gap-3"><Input className="min-w-52 flex-1" value={payee} onChange={(event) => setPayee(event.target.value)} placeholder="Payee name" /><Input className="w-28" value="100%" disabled /><Button disabled={!payee.trim() || save.isPending} onClick={() => save.mutate()}>{existing.length ? 'Replace split' : 'Save split'}</Button></div>{existing.length > 0 && <p className="mt-2 text-xs text-emerald-400">Active split totals {existing.reduce((sum, entry) => sum + Number(entry.share_bps), 0) / 100}%.</p>}</div>
}

function ReviewStep({detail}: {detail: ProviderReleaseDetail}) {
  const navigate = useNavigate()
  const submit = useMutation({mutationFn: () => submitProviderRelease(detail.release.id, detail.release.version), onSuccess: () => {toast({title: 'Release submitted for review'}); navigate('/app/artist')}})
  const editable = ['DRAFT', 'METADATA_COMPLETE', 'RIGHTS_COMPLETE', 'ISRC_COMPLETE', 'PRICING_COMPLETE', 'CHANGES_REQUESTED'].includes(detail.release.status)
  const latestFeedback = detail.reviewEvents.find((event) => event.note)?.note
  return <><StepHeading title="Review & Submit" detail="Confirm the release package before sending it to MEJay Publishing." />{latestFeedback && <div className="mb-5 border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-200"><p className="font-medium">Review feedback</p><p className="mt-1">{latestFeedback}</p></div>}<div className="divide-y divide-white/10 border-y border-white/10">{detail.prerequisites.length === 0 ? <div className="flex items-center gap-3 py-4 text-emerald-400"><Check className="h-4 w-4" />All submission requirements are complete</div> : detail.prerequisites.map((item) => <div key={item} className="py-3 text-sm text-zinc-400">Required: {item}</div>)}</div><Button className="mt-6 bg-emerald-400 text-zinc-950 hover:bg-emerald-300" disabled={!editable || detail.prerequisites.length > 0 || submit.isPending} onClick={() => submit.mutate()}>{submit.isPending ? 'Submitting...' : editable ? 'Submit to MEJay Review' : `Release is ${detail.release.status.replace(/_/g, ' ')}`}</Button>{submit.isError && <p className="mt-3 text-sm text-red-400">{submit.error.message}</p>}</>
}