import {useState} from 'react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {ArrowLeft, Check, ChevronRight, Disc3, Upload} from 'lucide-react'
import {Link, useNavigate, useParams} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Switch} from '@/components/ui/switch'
import {toast} from '@/hooks/use-toast'
import {
  assignProviderIsrc,
  createProviderTrack,
  generateProviderIsrc,
  getProviderRelease,
  listProviderArtists,
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
  return <><StepHeading title="ISRC" detail="Enter an existing code or permanently assign the next MEJay QTA3L code." /><div className="divide-y divide-white/10 border-y border-white/10">{detail.tracks.map((track) => <IsrcRow key={track.id} track={track} releaseId={detail.release.id} />)}</div>{detail.tracks.length === 0 && <p className="text-sm text-zinc-500">Add tracks before assigning ISRCs.</p>}</>
}

function IsrcRow({track, releaseId}: {track: ProviderTrack; releaseId: string}) {
  const queryClient = useQueryClient(), [value, setValue] = useState('')
  const assign = useMutation({mutationFn: (generated: boolean) => generated ? generateProviderIsrc(track.id) : assignProviderIsrc(track.id, value), onSuccess: async () => {setValue(''); await queryClient.invalidateQueries({queryKey: ['provider', 'release', releaseId]})}})
  return <div className="py-5"><div className="flex flex-wrap items-center gap-3"><p className="min-w-40 flex-1 font-medium">{track.track_number}. {track.title}</p>{track.isrc ? <span className="font-mono text-sm text-emerald-400">{formatIsrc(track.isrc)}</span> : <><Input className="max-w-56 font-mono" value={value} onChange={(event) => setValue(event.target.value)} placeholder="QT-A3L-YY-NNNNN" /><Button variant="outline" disabled={!value.trim() || assign.isPending} onClick={() => assign.mutate(false)}>Enter ISRC</Button><Button disabled={assign.isPending} onClick={() => assign.mutate(true)}>Assign MEJay ISRC</Button></>}</div>{assign.isError && <p className="mt-2 text-sm text-red-400">{assign.error.message}</p>}</div>
}

function formatIsrc(value: string) {const canonical = value.replace(/[-\s]/g, '').toUpperCase(); return canonical.length === 12 ? `${canonical.slice(0, 2)}-${canonical.slice(2, 5)}-${canonical.slice(5, 7)}-${canonical.slice(7)}` : value}