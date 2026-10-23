import {useState} from 'react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {ArrowLeft, Clock, Lock, Plus, ShieldCheck, Trash2, Upload, XCircle} from 'lucide-react'
import {Link, useParams} from 'react-router-dom'

import {AdditionalArtistsField} from '@/app/components/provider/AdditionalArtistsField'
import {ReleaseDateTimePicker} from '@/app/components/provider/ReleaseDateTimePicker'
import {Button} from '@/components/ui/button'
import {Checkbox} from '@/components/ui/checkbox'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Switch} from '@/components/ui/switch'
import {toast} from '@/hooks/use-toast'
import {creditsInput, rowsFromCredits, type AdditionalArtistRow} from '@/lib/artistCredit'
import {
  getProviderRelease,
  getReleaseChangeRequest,
  listProviderArtists,
  saveReleaseChangeRequest,
  submitReleaseChangeRequest,
  uploadProviderAsset,
  withdrawReleaseChangeRequest,
  type ChangeDiffItem,
  type ChangeRequestInput,
  type ContributorRole,
  type ProviderReleaseDetail,
  type ProviderTrack,
  type ReleaseChangeRequest,
  type TrackContributor,
  type TrackFieldChanges,
} from '@/lib/providerApi'
import {releaseEditState} from '@/lib/releaseEditState'
import {CONTRIBUTOR_ROLE_LABELS, formatChangeValue as formatValue, SAME_SONG_NOTE} from '@/lib/changeRequestFormat'
import {browserTimeZone, formatPreviewStart, formatReleaseTime, listTimeZones, meetsReleaseLead, parsePreviewStart, PREVIEW_SECONDS, RELEASE_LEAD_MESSAGE, utcToZonedLocal, zonedLocalToUtcIso} from '@/lib/releaseTime'

const ROLE_LABELS = CONTRIBUTOR_ROLE_LABELS
const selectClass = 'h-10 w-full rounded-md border border-white/10 bg-zinc-950 px-3 text-sm'

type ReleaseForm = {
  title: string; versionTitle: string; genre: string; subgenre: string; labelName: string; catalogNumber: string; upc: string
  originalReleaseDate: string; copyrightYear: string; copyrightHolder: string; phonographicCopyrightYear: string; phonographicCopyrightHolder: string
  local: string; timeZone: string
}
type TrackForm = {trackId: string; title: string; versionTitle: string; explicit: boolean; languageCode: string; genre: string; previewStart: string; featuredArtistIds: string[]; contributors: TrackContributor[]}

const text = (value: string | null | undefined) => value ?? ''
const orNull = (value: string) => value.trim() || null
const yearOrNull = (value: string) => value ? Number(value) : null

function releaseForm(release: ProviderReleaseDetail['release'], saved?: ReleaseChangeRequest['changes']['release']): ReleaseForm {
  const pick = <T,>(key: keyof NonNullable<typeof saved>, current: T): T => (saved && key in saved ? saved[key] as T : current)
  const timeZone = pick('releaseTimezone', release.release_timezone) || browserTimeZone()
  return {
    title: pick('title', release.title), versionTitle: text(pick('versionTitle', release.version_title)), genre: text(pick('genre', release.genre)),
    subgenre: text(pick('subgenre', release.subgenre)), labelName: text(pick('labelName', release.label_name)), catalogNumber: text(pick('catalogNumber', release.catalog_number)),
    upc: text(pick('upc', release.upc)), originalReleaseDate: text(pick('originalReleaseDate', release.original_release_date)),
    copyrightYear: pick('copyrightYear', release.copyright_year)?.toString() ?? '', copyrightHolder: text(pick('copyrightHolder', release.copyright_holder)),
    phonographicCopyrightYear: pick('phonographicCopyrightYear', release.phonographic_copyright_year)?.toString() ?? '',
    phonographicCopyrightHolder: text(pick('phonographicCopyrightHolder', release.phonographic_copyright_holder)),
    local: utcToZonedLocal(pick('requestedReleaseAt', release.scheduled_release_at ?? release.requested_release_at ?? null), timeZone), timeZone,
  }
}

function trackForm(track: ProviderTrack, saved?: TrackFieldChanges): TrackForm {
  const value = <K extends keyof TrackFieldChanges>(key: K, current: TrackFieldChanges[K]) => (saved && key in saved ? saved[key] : current)
  return {
    trackId: track.id, title: value('title', track.title) ?? track.title, versionTitle: text(value('versionTitle', track.version_title)),
    explicit: Boolean(value('explicit', track.explicit)), languageCode: text(value('languageCode', track.language_code)), genre: text(value('genre', track.genre)),
    previewStart: formatPreviewStart(value('previewStartMs', track.preview_start_ms ?? null)),
    featuredArtistIds: saved?.credits?.featuredArtistIds ?? track.featured_artist_ids ?? [],
    contributors: saved?.credits?.contributors ?? track.contributors ?? [],
  }
}

export default function ReleaseChangeRequestPage() {
  const {releaseId = ''} = useParams()
  const detail = useQuery({queryKey: ['provider', 'release', releaseId], queryFn: () => getProviderRelease(releaseId), enabled: Boolean(releaseId)})
  const state = useQuery({queryKey: ['provider', 'release', releaseId, 'change-request'], queryFn: () => getReleaseChangeRequest(releaseId), enabled: Boolean(releaseId)})

  return <div className="min-h-screen bg-[#0a0a0b] px-4 py-8 text-zinc-100 sm:px-8">
    <main className="mx-auto max-w-3xl space-y-6">
      <Link to="/app/artist" className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100"><ArrowLeft className="h-4 w-4" />Back to My releases</Link>
      {detail.isError || state.isError ? <p role="alert" className="text-sm text-red-400">{(detail.error ?? state.error)?.message}</p>
        : !detail.data || !state.data ? <p className="text-sm text-zinc-500">Loading…</p>
          : <ChangeRequestBody detail={detail.data} request={state.data.request} sameRecordingRequired={state.data.sameRecordingRequired} />}
    </main>
  </div>
}

function ChangeRequestBody({detail, request, sameRecordingRequired}: {detail: ProviderReleaseDetail; request: ReleaseChangeRequest | null; sameRecordingRequired: boolean}) {
  const release = detail.release
  const [startNew, setStartNew] = useState(false)
  const heading = <div><h1 className="text-2xl font-bold">Request changes</h1><p className="mt-1 text-sm text-zinc-400">{release.title}. Your release stays exactly as it is until MeJay approves your changes.</p></div>
  if (releaseEditState(release.status) !== 'approved') {
    return <>{heading}<p className="rounded-md border border-white/10 p-4 text-sm text-zinc-300">Change requests are for approved releases. <Link className="text-emerald-300 underline" to={`/app/artist/releases/${release.id}/edit/release-information`}>Open the release</Link> to see what you can do now.</p></>
  }
  if (request?.status === 'submitted' || request?.status === 'in_review') return <>{heading}<PendingRequest releaseId={release.id} request={request} /></>
  const closed = request && ['approved', 'rejected', 'withdrawn'].includes(request.status) ? request : null
  return <>
    {heading}
    {closed && !startNew && <ClosedOutcome request={closed} />}
    <ChangeForm key={request?.status === 'draft' ? request.id : 'new'} detail={detail} draft={request?.status === 'draft' ? request : null} sameRecordingRequired={sameRecordingRequired} onStarted={() => setStartNew(true)} />
  </>
}

function ClosedOutcome({request}: {request: ReleaseChangeRequest}) {
  if (request.status === 'approved') {
    return <div role="status" className="flex gap-3 rounded-md border border-emerald-400/30 bg-emerald-400/5 p-4 text-sm"><ShieldCheck className="h-5 w-5 shrink-0 text-emerald-300" /><p><span className="font-semibold">Your last changes were approved</span> and are live on your release.</p></div>
  }
  if (request.status === 'rejected') {
    return <div role="status" className="flex gap-3 rounded-md border border-red-400/30 bg-red-400/5 p-4 text-sm"><XCircle className="h-5 w-5 shrink-0 text-red-300" /><div><p className="font-semibold">MeJay didn't approve your last changes</p>{request.review_note && <p className="mt-1 text-zinc-300">{request.review_note}</p>}<p className="mt-1 text-zinc-400">Nothing on your release changed. You can request new changes below.</p></div></div>
  }
  return null
}

function DiffList({diff}: {diff: ChangeDiffItem[]}) {
  if (diff.length === 0) return <p className="text-sm text-zinc-500">No changes.</p>
  const show = (item: ChangeDiffItem, value: unknown) => item.kind === 'asset' ? (value ? 'New file' : 'None') : formatValue(value)
  return <ul className="divide-y divide-white/10 rounded-md border border-white/10">{diff.map((item) => <li key={item.key} className="grid gap-1 p-3 text-sm sm:grid-cols-[12rem_1fr]">
    <span className="text-zinc-400">{item.trackTitle ? `${item.trackTitle}: ` : ''}{item.label}</span>
    <span><span className="text-zinc-500 line-through">{item.kind === 'asset' ? 'Current file' : formatValue(item.before)}</span> → <span className="text-zinc-100">{show(item, item.after)}</span></span>
  </li>)}</ul>
}

function PendingRequest({releaseId, request}: {releaseId: string; request: ReleaseChangeRequest}) {
  const queryClient = useQueryClient()
  const withdraw = useMutation({
    mutationFn: () => withdrawReleaseChangeRequest(releaseId),
    onSuccess: async () => { await queryClient.invalidateQueries({queryKey: ['provider', 'release', releaseId, 'change-request']}); toast({title: 'Changes withdrawn', description: 'Nothing on your release changed.'}) },
    onSettled: () => queryClient.invalidateQueries({queryKey: ['provider', 'release', releaseId, 'change-request']}),
  })
  const inReview = request.status === 'in_review'
  return <section className="space-y-4">
    <div role="status" className={`flex flex-col gap-3 rounded-md border p-4 text-sm sm:flex-row sm:items-center ${inReview ? 'border-amber-400/30 bg-amber-400/5' : 'border-sky-400/30 bg-sky-400/5'}`}>
      {inReview ? <Lock className="h-5 w-5 shrink-0 text-amber-300" /> : <Clock className="h-5 w-5 shrink-0 text-sky-300" />}
      <div className="flex-1">
        <p className="font-semibold">{inReview ? 'MeJay is reviewing your changes' : 'Waiting for MeJay review'}</p>
        <p className="text-zinc-400">{inReview ? 'They can no longer be edited or withdrawn until the review is finished.' : 'Withdraw them if you want to make more edits.'}</p>
        {request.same_recording_required && <p className="mt-1 text-xs text-amber-300">{SAME_SONG_NOTE}</p>}
      </div>
      {!inReview && <Button type="button" variant="outline" disabled={withdraw.isPending} onClick={() => withdraw.mutate()}>{withdraw.isPending ? 'Withdrawing…' : 'Withdraw changes'}</Button>}
    </div>
    {withdraw.isError && <p role="alert" className="text-sm text-red-400">{withdraw.error.message}</p>}
    <DiffList diff={request.diff} />
  </section>
}

function ChangeForm({detail, draft, sameRecordingRequired, onStarted}: {detail: ProviderReleaseDetail; draft: ReleaseChangeRequest | null; sameRecordingRequired: boolean; onStarted: () => void}) {
  const release = detail.release
  const queryClient = useQueryClient()
  const artists = useQuery({queryKey: ['provider', 'artists'], queryFn: listProviderArtists})
  const artistList = artists.data ?? []
  const live = release.status === 'LIVE'
  const [form, setForm] = useState<ReleaseForm>(() => releaseForm(release, draft?.changes.release))
  const [extraArtists, setExtraArtists] = useState<AdditionalArtistRow[]>(() => rowsFromCredits(
    draft?.changes.release.additionalArtists?.map((artist) => ({role: artist.role, artist_id: artist.artistId ?? null, name: artist.name})) ?? release.additional_artists))
  const [tracks, setTracks] = useState<TrackForm[]>(() => detail.tracks.map((track) => trackForm(track, draft?.changes.tracks.find((change) => change.trackId === track.id))))
  const [artworkAssetId, setArtworkAssetId] = useState<string | null>(draft?.artwork_asset_id ?? null)
  const [audio, setAudio] = useState<Array<{trackId: string; assetId: string}>>(draft?.audio_replacements ?? [])
  const [requestId, setRequestId] = useState<string | null>(draft?.id ?? null)
  const [uploading, setUploading] = useState<string | null>(null)
  const refresh = () => queryClient.invalidateQueries({queryKey: ['provider', 'release', release.id, 'change-request']})

  const field = (key: keyof ReleaseForm) => ({value: form[key], onChange: (event: React.ChangeEvent<HTMLInputElement>) => setForm({...form, [key]: event.target.value})})
  const updateTrack = (trackId: string, patch: Partial<TrackForm>) => setTracks((rows) => rows.map((row) => row.trackId === trackId ? {...row, ...patch} : row))
  const additionalArtists = creditsInput(extraArtists, artistList)
  const currentInstant = release.scheduled_release_at ?? release.requested_release_at ?? null
  const instant = form.local ? zonedLocalToUtcIso(form.local, form.timeZone) : null
  const dateChanged = !live && Boolean(instant) && (!currentInstant || new Date(instant!).getTime() !== new Date(currentInstant).getTime())
  const previewProblems = tracks.map((row) => parsePreviewStart(row.previewStart) === undefined ? row.trackId : null).filter(Boolean)
  const problem = !additionalArtists ? 'Enter a name for each additional artist, or remove the empty row.'
    : !form.title.trim() ? 'The release needs a title.'
      : form.upc && !/^[0-9]{12,14}$/.test(form.upc) ? 'A UPC is 12 to 14 digits (numbers only).'
        : previewProblems.length > 0 ? 'Use minutes:seconds for preview starts, like 1:05, or leave them blank for automatic.'
          : dateChanged && !meetsReleaseLead(instant) ? RELEASE_LEAD_MESSAGE : null

  const payload = (overrides: Partial<Pick<ChangeRequestInput, 'artworkAssetId' | 'audioReplacements'>> = {}): ChangeRequestInput => ({
    release: {
      title: form.title.trim(), versionTitle: orNull(form.versionTitle), genre: orNull(form.genre), subgenre: orNull(form.subgenre),
      labelName: orNull(form.labelName), catalogNumber: orNull(form.catalogNumber), upc: orNull(form.upc), originalReleaseDate: orNull(form.originalReleaseDate),
      copyrightYear: yearOrNull(form.copyrightYear), copyrightHolder: orNull(form.copyrightHolder),
      phonographicCopyrightYear: yearOrNull(form.phonographicCopyrightYear), phonographicCopyrightHolder: orNull(form.phonographicCopyrightHolder),
      additionalArtists: additionalArtists ?? [],
      ...(dateChanged && instant ? {requestedReleaseAt: instant, releaseTimezone: form.timeZone} : {}),
    },
    tracks: tracks.map((row) => ({
      trackId: row.trackId, title: row.title.trim(), versionTitle: orNull(row.versionTitle), explicit: row.explicit, languageCode: orNull(row.languageCode),
      genre: orNull(row.genre), previewStartMs: parsePreviewStart(row.previewStart) ?? null,
      credits: {featuredArtistIds: row.featuredArtistIds, contributors: row.contributors.filter((contributor) => contributor.name.trim()).map((contributor) => ({...contributor, name: contributor.name.trim(), publisherName: contributor.publisherName?.trim() || null}))},
    })),
    artworkAssetId: overrides.artworkAssetId !== undefined ? overrides.artworkAssetId : artworkAssetId,
    audioReplacements: overrides.audioReplacements ?? audio,
  })

  const persist = async (overrides?: Parameters<typeof payload>[0]) => {
    const saved = await saveReleaseChangeRequest(release.id, payload(overrides))
    setRequestId(saved.id)
    onStarted()
    return saved
  }
  const save = useMutation({mutationFn: () => persist(), onSuccess: () => toast({title: 'Draft saved', description: 'Submit it when you are ready for MeJay to review.'})})
  const submit = useMutation({
    mutationFn: async () => { await persist(); return submitReleaseChangeRequest(release.id) },
    onSuccess: async () => { await refresh(); toast({title: 'Changes sent for review', description: 'Your release stays as it is until MeJay approves them.'}) },
  })
  const upload = useMutation({
    mutationFn: async ({file, target}: {file: File; target: {kind: 'artwork'} | {kind: 'audio'; trackId: string}}) => {
      setUploading(target.kind === 'artwork' ? 'artwork' : target.trackId)
      // Replacement files belong to a draft request, so make sure one exists first.
      const id = requestId ?? (await persist()).id
      if (target.kind === 'artwork') {
        const image = await createImageBitmap(file)
        let assetId: string
        try {
          assetId = await uploadProviderAsset({kind: 'artwork', releaseId: release.id, fileName: file.name, mimeType: file.type as 'image/jpeg' | 'image/png' | 'image/webp', byteSize: file.size, width: image.width, height: image.height, changeRequestId: id}, file)
        } finally { image.close() }
        setArtworkAssetId(assetId)
        await persist({artworkAssetId: assetId})
      } else {
        const assetId = await uploadProviderAsset({kind: 'audio', trackId: target.trackId, fileName: file.name, mimeType: (file.type || (file.name.toLowerCase().endsWith('.flac') ? 'audio/flac' : 'audio/wav')) as 'audio/wav' | 'audio/flac', byteSize: file.size, changeRequestId: id}, file)
        const next = [...audio.filter((entry) => entry.trackId !== target.trackId), {trackId: target.trackId, assetId}]
        setAudio(next)
        await persist({audioReplacements: next})
      }
    },
    onSettled: () => setUploading(null),
    onSuccess: () => toast({title: 'File uploaded', description: 'It replaces the current one only after MeJay approves your changes.'}),
  })
  const busy = save.isPending || submit.isPending || upload.isPending
  const error = save.error ?? submit.error ?? upload.error
  const zones = listTimeZones()

  return <form className="space-y-8" onSubmit={(event) => { event.preventDefault(); if (!problem) submit.mutate() }}>
    <section className="grid gap-5 sm:grid-cols-2">
      <h2 className="text-lg font-semibold sm:col-span-2">Release details</h2>
      <Field id="cr-title" label="Release title"><Input id="cr-title" required {...field('title')} /></Field>
      <Field id="cr-version" label="Version"><Input id="cr-version" placeholder="Optional" {...field('versionTitle')} /></Field>
      <AdditionalArtistsField rows={extraArtists} onChange={setExtraArtists} artists={artistList} leadArtistId={release.primary_artist_id} />
      <Field id="cr-genre" label="Genre"><Input id="cr-genre" {...field('genre')} /></Field>
      <Field id="cr-subgenre" label="Subgenre"><Input id="cr-subgenre" {...field('subgenre')} /></Field>
      <Field id="cr-label" label="Label"><Input id="cr-label" {...field('labelName')} /></Field>
      <Field id="cr-catalog" label="Catalog number"><Input id="cr-catalog" {...field('catalogNumber')} /></Field>
      <Field id="cr-upc" label="UPC (optional)"><Input id="cr-upc" inputMode="numeric" value={form.upc} onChange={(event) => setForm({...form, upc: event.target.value.replace(/[\s-]/g, '')})} /></Field>
      <Field id="cr-original-date" label="Original release date (optional)"><Input id="cr-original-date" type="date" {...field('originalReleaseDate')} /></Field>
      <Field id="cr-c-year" label="Copyright year"><Input id="cr-c-year" type="number" min="1900" max="2200" {...field('copyrightYear')} /></Field>
      <Field id="cr-c-holder" label="Copyright holder"><Input id="cr-c-holder" {...field('copyrightHolder')} /></Field>
      <Field id="cr-p-year" label="Phonographic copyright year"><Input id="cr-p-year" type="number" min="1900" max="2200" {...field('phonographicCopyrightYear')} /></Field>
      <Field id="cr-p-holder" label="Phonographic copyright holder"><Input id="cr-p-holder" {...field('phonographicCopyrightHolder')} /></Field>
    </section>

    {!live && <section className="space-y-3 rounded-md border border-white/10 p-4">
      <h2 className="text-lg font-semibold">Release date</h2>
      <p className="text-xs text-zinc-400">{currentInstant ? `Currently ${formatReleaseTime(currentInstant, release.release_timezone)}.` : 'No release date is set yet.'} {RELEASE_LEAD_MESSAGE} Pre-order buyers are emailed if the date changes.</p>
      <ReleaseDateTimePicker value={form.local} onChange={(local) => setForm({...form, local})} />
      <div className="space-y-2"><Label htmlFor="cr-timezone">Timezone</Label>
        <select id="cr-timezone" className={selectClass} value={form.timeZone} onChange={(event) => setForm({...form, timeZone: event.target.value})}>
          {(zones.includes(form.timeZone) ? zones : [form.timeZone, ...zones]).map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>)}
        </select>
      </div>
    </section>}

    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Cover art</h2>
      <FilePicker label={artworkAssetId ? 'Replace the new cover art' : 'Upload new cover art'} accept="image/jpeg,image/png,image/webp" pending={uploading === 'artwork'} disabled={busy}
        onFile={(file) => upload.mutate({file, target: {kind: 'artwork'}})} />
      <p className="text-xs text-zinc-500">{artworkAssetId ? 'New cover art uploaded. It replaces the current art once MeJay approves.' : 'Square JPEG, PNG or WebP, at least 3000 x 3000. Leave it to keep the current art.'}</p>
      {artworkAssetId && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setArtworkAssetId(null)}>Keep the current cover art</Button>}
    </section>

    <section className="space-y-4">
      <h2 className="text-lg font-semibold">Tracks</h2>
      <p className="rounded-md border border-amber-400/20 bg-amber-400/5 p-3 text-xs text-amber-200">{SAME_SONG_NOTE}{sameRecordingRequired ? ' That applies to this release now.' : ''}</p>
      {tracks.map((row) => {
        const track = detail.tracks.find((candidate) => candidate.id === row.trackId)!
        const replaced = audio.some((entry) => entry.trackId === row.trackId)
        const otherArtists = artistList.filter((artist) => artist.id !== release.primary_artist_id)
        const updateContributor = (index: number, patch: Partial<TrackContributor>) => updateTrack(row.trackId, {contributors: row.contributors.map((contributor, at) => at === index ? {...contributor, ...patch} : contributor)})
        return <div key={row.trackId} className="grid gap-4 rounded-md border border-white/10 bg-[#141417] p-5 sm:grid-cols-2">
          <p className="font-medium sm:col-span-2">{track.track_number}. {track.title}</p>
          <Field id={`cr-track-title-${row.trackId}`} label="Title"><Input id={`cr-track-title-${row.trackId}`} required value={row.title} onChange={(event) => updateTrack(row.trackId, {title: event.target.value})} /></Field>
          <Field id={`cr-track-version-${row.trackId}`} label="Version"><Input id={`cr-track-version-${row.trackId}`} value={row.versionTitle} onChange={(event) => updateTrack(row.trackId, {versionTitle: event.target.value})} /></Field>
          <Field id={`cr-track-genre-${row.trackId}`} label="Genre"><Input id={`cr-track-genre-${row.trackId}`} value={row.genre} onChange={(event) => updateTrack(row.trackId, {genre: event.target.value})} /></Field>
          <Field id={`cr-track-language-${row.trackId}`} label="Language code"><Input id={`cr-track-language-${row.trackId}`} maxLength={3} placeholder="en" value={row.languageCode} onChange={(event) => updateTrack(row.trackId, {languageCode: event.target.value})} /></Field>
          <Field id={`cr-track-preview-${row.trackId}`} label="Preview starts at"><Input id={`cr-track-preview-${row.trackId}`} placeholder="Automatic" value={row.previewStart} onChange={(event) => updateTrack(row.trackId, {previewStart: event.target.value})} /></Field>
          <div className="flex items-end pb-2"><Label className="flex items-center gap-2"><Switch checked={row.explicit} onCheckedChange={(explicit) => updateTrack(row.trackId, {explicit})} />Explicit</Label></div>
          <p className="text-xs text-zinc-500 sm:col-span-2">Previews play {PREVIEW_SECONDS} seconds from the start you choose (minutes:seconds).</p>
          {otherArtists.length > 0 && <div className="sm:col-span-2"><p className="text-xs font-semibold uppercase text-zinc-500">Featured artists on your account</p>
            <div className="mt-2 flex flex-wrap gap-3">{otherArtists.map((artist) => <Label key={artist.id} className="flex items-center gap-2 text-sm"><Checkbox checked={row.featuredArtistIds.includes(artist.id)}
              onCheckedChange={(checked) => updateTrack(row.trackId, {featuredArtistIds: checked === true ? [...row.featuredArtistIds, artist.id] : row.featuredArtistIds.filter((id) => id !== artist.id)})} />{artist.name}</Label>)}</div>
          </div>}
          <div className="space-y-2 sm:col-span-2"><p className="text-xs font-semibold uppercase text-zinc-500">Contributors</p>
            {row.contributors.map((contributor, index) => <div key={index} className="grid gap-2 sm:grid-cols-[1fr_11rem_1fr_auto]">
              <Input aria-label="Contributor name" placeholder="Name" value={contributor.name} onChange={(event) => updateContributor(index, {name: event.target.value})} />
              <select aria-label="Contributor role" className={selectClass} value={contributor.role} onChange={(event) => updateContributor(index, {role: event.target.value as ContributorRole})}>{Object.entries(ROLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
              <Input aria-label="Publisher" placeholder="Publisher (optional)" value={contributor.publisherName ?? ''} onChange={(event) => updateContributor(index, {publisherName: event.target.value})} />
              <Button type="button" variant="ghost" size="icon" aria-label="Remove contributor" onClick={() => updateTrack(row.trackId, {contributors: row.contributors.filter((_, at) => at !== index)})}><Trash2 className="h-4 w-4" /></Button>
            </div>)}
            <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => updateTrack(row.trackId, {contributors: [...row.contributors, {name: '', role: 'writer', publisherName: null}]})}><Plus className="h-4 w-4" />Add contributor</Button>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <FilePicker label={replaced ? 'Replace the new audio' : 'Replace audio'} accept=".wav,.flac,audio/wav,audio/flac" pending={uploading === row.trackId} disabled={busy}
              onFile={(file) => upload.mutate({file, target: {kind: 'audio', trackId: row.trackId}})} />
            <p className="text-xs text-zinc-500">{replaced ? 'New audio uploaded. Buyers who already own this keep the file they bought.' : 'WAV or FLAC. Use this for a new mix or master of the same song.'}</p>
            {replaced && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={() => setAudio((entries) => entries.filter((entry) => entry.trackId !== row.trackId))}>Keep the current audio</Button>}
          </div>
        </div>
      })}
    </section>

    {problem && <p className="text-sm text-amber-300">{problem}</p>}
    {error && <p role="alert" className="text-sm text-red-400">{error.message}</p>}
    <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
      <Button type="button" variant="outline" disabled={busy || Boolean(problem)} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save draft'}</Button>
      <Button type="submit" className="bg-emerald-400 font-semibold text-zinc-950 hover:bg-emerald-300" disabled={busy || Boolean(problem)}>{submit.isPending ? 'Sending…' : 'Submit changes for review'}</Button>
    </div>
  </form>
}

function Field({id, label, children}: {id: string; label: string; children: React.ReactNode}) {
  return <div className="space-y-2"><Label htmlFor={id}>{label}</Label>{children}</div>
}

function FilePicker({label, accept, pending, disabled, onFile}: {label: string; accept: string; pending: boolean; disabled: boolean; onFile: (file: File) => void}) {
  return <Button asChild variant="outline" size="sm" className="gap-2"><label className="cursor-pointer"><Upload className="h-4 w-4" />{pending ? 'Uploading…' : label}
    <input className="sr-only" type="file" accept={accept} disabled={disabled} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onFile(file) }} /></label></Button>
}
