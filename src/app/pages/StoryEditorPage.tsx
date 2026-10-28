import {useEffect, useMemo, useState} from 'react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {AlertTriangle, ArrowLeft, Check, ExternalLink, Monitor, Smartphone} from 'lucide-react'
import {Link, useNavigate, useParams, useSearchParams} from 'react-router-dom'

import {PreviewFrame} from '@/app/components/admin/stories/PreviewFrame'
import {StoryContentEditor} from '@/app/components/admin/stories/StoryContentEditor'
import {FocalPointPicker, GalleryEditor, ImageSlot, InlinePhotoText, type MediaText} from '@/app/components/admin/stories/StoryMediaFields'
import {StoryRenderer} from '@/app/components/stories/StoryRenderer'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Switch} from '@/components/ui/switch'
import {Textarea} from '@/components/ui/textarea'
import {toast} from '@/hooks/use-toast'
import {getStoreRelease} from '@/lib/musicStoreApi'
import {
  commandAdminStory, createAdminStory, deleteStoryMedia, getAdminStory, lookupStoryLinks, updateAdminStory, uploadStoryImage,
  StoryApiError, type AdminStory, type AdminStoryMedia, type MediaRole, type StoryCommandAction, type StoryLinkOption,
} from '@/lib/storiesAdminApi'
import {draftFromStory, TEMPLATE_INFO, toStoryView, toUpdateInput, type StoryDraft} from '@/lib/storyDraft'
import type {StoryPalette, StoryTemplate} from '@/lib/storiesApi'

const STEPS = [
  {id: 'template', label: 'Choose template'},
  {id: 'content', label: 'Add story'},
  {id: 'photos', label: 'Photos & look'},
  {id: 'preview', label: 'Preview & publish'},
] as const
type StepId = typeof STEPS[number]['id']

const PALETTES: Array<{id: StoryPalette; label: string; swatch: string}> = [
  {id: 'ink', label: 'MeJay ink', swatch: 'bg-[#0a0a0b] ring-emerald-400'},
  {id: 'midnight', label: 'Midnight', swatch: 'bg-[#0a0f1f] ring-sky-300'},
  {id: 'violet', label: 'Violet', swatch: 'bg-[#110a1c] ring-fuchsia-400'},
  {id: 'teal', label: 'Teal', swatch: 'bg-[#071618] ring-cyan-300'},
  {id: 'paper', label: 'Paper (light)', swatch: 'bg-white ring-violet-700'},
]
const EMPTY_TEXT: MediaText = {altText: '', caption: '', credit: ''}
const MIN_OVERLAY_WITH_BACKGROUND = 35
const ADMIN_HOME = '/app/marketplace-admin?section=stories'

export default function StoryEditorPage() {
  const {storyId = ''} = useParams()
  return <div className="min-h-screen bg-[#09090b] text-zinc-100">
    <header className="flex h-16 items-center gap-3 border-b border-white/10 px-4 sm:px-7">
      <Link to={ADMIN_HOME} className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-zinc-100"><ArrowLeft className="h-4 w-4" />Stories</Link>
      <span className="ml-auto text-xs uppercase text-zinc-500">Publishing Desk</span>
    </header>
    <main className="mx-auto max-w-5xl p-4 sm:p-7">{storyId === 'new' ? <NewStory /> : <StoryEditor storyId={storyId} />}</main>
  </div>
}

function TemplatePicker({value, onChange}: {value: StoryTemplate | null; onChange: (template: StoryTemplate) => void}) {
  return <div role="radiogroup" aria-label="Story template" className="grid gap-3 sm:grid-cols-3">
    {(Object.keys(TEMPLATE_INFO) as StoryTemplate[]).map((template) => <button key={template} type="button" role="radio" aria-checked={value === template} onClick={() => onChange(template)}
      className={`rounded-md border p-4 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 ${value === template ? 'border-emerald-400 bg-emerald-400/10' : 'border-white/10 bg-white/[0.02] hover:border-white/25'}`}>
      <TemplateSketch template={template} />
      <p className="mt-3 font-semibold">{TEMPLATE_INFO[template].name}</p>
      <p className="mt-1 text-xs text-zinc-400">{TEMPLATE_INFO[template].description}</p>
    </button>)}
  </div>
}

function TemplateSketch({template}: {template: StoryTemplate}) {
  const bar = 'rounded-sm bg-white/20'
  if (template === 'headliner') return <div aria-hidden="true" className="space-y-1.5 rounded bg-white p-2"><div className="h-2 w-3/4 rounded-sm bg-zinc-800" /><div className="h-8 rounded-sm bg-zinc-300" /><div className="h-1 rounded-sm bg-zinc-300" /><div className="h-1 w-5/6 rounded-sm bg-zinc-300" /></div>
  if (template === 'artist_spotlight') return <div aria-hidden="true" className="relative h-[4.4rem] rounded bg-gradient-to-br from-fuchsia-900 to-indigo-950 p-2"><div className="absolute bottom-2 left-2 space-y-1"><div className={`h-1.5 w-14 ${bar}`} /><div className="h-1.5 w-10 rounded-sm bg-fuchsia-400" /></div></div>
  return <div aria-hidden="true" className="flex h-[4.4rem] gap-2 rounded bg-[#071618] p-2"><div className="aspect-square h-full rounded-sm bg-gradient-to-br from-fuchsia-500 to-cyan-400" /><div className="flex-1 space-y-1.5"><div className={`h-1.5 w-3/4 ${bar}`} /><div className="h-3 rounded-sm bg-cyan-300/70" /></div></div>
}

function NewStory() {
  const navigate = useNavigate()
  const [template, setTemplate] = useState<StoryTemplate | null>(null)
  const [title, setTitle] = useState('')
  const create = useMutation({
    mutationFn: () => createAdminStory({template: template!, title: title.trim()}),
    onSuccess: (story) => navigate(`/app/marketplace-admin/stories/${story.id}?step=content`, {replace: true}),
  })
  return <section className="space-y-6">
    <StepNav current="template" onSelect={() => undefined} disabledAfter="template" />
    <div><h1 className="text-2xl font-bold">Create your story</h1><p className="mt-1 text-sm text-zinc-400">Turn music, moments and ideas into an editorial story on Discover.</p></div>
    <TemplatePicker value={template} onChange={setTemplate} />
    <div className="max-w-xl space-y-2"><Label htmlFor="new-story-title">Working title</Label><Input id="new-story-title" maxLength={160} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="You can change it later" /></div>
    {create.isError && <p role="alert" className="text-sm text-red-300">{create.error.message}</p>}
    <Button className="bg-emerald-400 font-semibold text-zinc-950 hover:bg-emerald-300" disabled={!template || !title.trim() || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'Creating…' : 'Create draft and continue'}</Button>
  </section>
}

function StepNav({current, onSelect, disabledAfter}: {current: StepId; onSelect: (step: StepId) => void; disabledAfter?: StepId}) {
  const lastEnabled = disabledAfter ? STEPS.findIndex((step) => step.id === disabledAfter) : STEPS.length - 1
  return <nav aria-label="Story steps"><ol className="flex flex-wrap gap-2">{STEPS.map((step, index) => <li key={step.id}>
    <button type="button" aria-current={current === step.id ? 'step' : undefined} disabled={index > lastEnabled} onClick={() => onSelect(step.id)}
      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 disabled:opacity-40 ${current === step.id ? 'border-emerald-400 bg-emerald-400/10 text-emerald-200' : 'border-white/10 text-zinc-400 hover:text-zinc-100'}`}>
      <span className="grid h-5 w-5 place-items-center rounded-full bg-white/10 text-xs font-bold">{index + 1}</span>{step.label}
    </button></li>)}</ol></nav>
}

function StoryEditor({storyId}: {storyId: string}) {
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const step = (STEPS.some((item) => item.id === params.get('step')) ? params.get('step') : 'content') as StepId
  const loaded = useQuery({queryKey: ['marketplace-admin', 'story', storyId], queryFn: () => getAdminStory(storyId), refetchOnWindowFocus: false})
  const [story, setStory] = useState<AdminStory | null>(null)
  const [draft, setDraft] = useState<StoryDraft | null>(null)
  const [savedJson, setSavedJson] = useState('')
  const [problem, setProblem] = useState<StoryApiError | null>(null)
  const [uploading, setUploading] = useState<MediaRole | null>(null)
  const [uploadError, setUploadError] = useState<{role: MediaRole; message: string} | null>(null)

  const adopt = (next: AdminStory, resetDraft: boolean) => {
    setStory(next)
    const nextDraft = resetDraft ? draftFromStory(next) : null
    if (nextDraft) setDraft(nextDraft)
    setSavedJson(JSON.stringify(toUpdateInput(nextDraft ?? draft!, 0, next.media)))
  }

  useEffect(() => {
    if (loaded.data && !story) adopt(loaded.data, true)
  }, [loaded.data]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = Boolean(story && draft && JSON.stringify(toUpdateInput(draft, 0, story.media)) !== savedJson)
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({queryKey: ['marketplace-admin', 'stories']}),
    queryClient.invalidateQueries({queryKey: ['stories']}),
  ])

  const save = useMutation({
    mutationFn: async () => updateAdminStory(storyId, toUpdateInput(draft!, story!.version, story!.media)),
    onMutate: () => setProblem(null),
    onSuccess: async (next) => { adopt(next, false); await invalidate() },
    onError: (error) => setProblem(error instanceof StoryApiError ? error : new StoryApiError(error.message, 'unknown')),
  })
  const command = useMutation({
    mutationFn: async (action: StoryCommandAction) => {
      let current = story!
      if (dirty) {
        current = await updateAdminStory(storyId, toUpdateInput(draft!, current.version, current.media))
        adopt(current, false)
      }
      return commandAdminStory(storyId, action, current.version)
    },
    onMutate: () => setProblem(null),
    onSuccess: async (next, action) => {
      adopt(next, false)
      await invalidate()
      toast({title: {publish: 'Story published', unpublish: 'Story moved back to drafts', archive: 'Story archived', feature: 'Now the featured story on Discover', unfeature: 'No longer featured'}[action]})
    },
    onError: (error) => setProblem(error instanceof StoryApiError ? error : new StoryApiError(error.message, 'unknown')),
  })

  const releaseQuery = useQuery({
    queryKey: ['music-store', 'release', draft?.release?.id],
    queryFn: () => getStoreRelease(draft!.release!.id),
    enabled: step === 'preview' && Boolean(draft?.release?.public),
    retry: false,
  })

  const view = useMemo(() => story && draft ? toStoryView(draft, story.media, {release: releaseQuery.data ?? null}, story.published_at) : null, [story, draft, releaseQuery.data])

  if (loaded.isLoading || (!story && !loaded.isError)) return <p className="text-sm text-zinc-500">Loading story…</p>
  if (loaded.isError || !story || !draft) return <p role="alert" className="text-sm text-red-300">{loaded.error?.message ?? 'Story unavailable'}</p>

  const set = (patch: Partial<StoryDraft>) => setDraft((current) => current ? {...current, ...patch} : current)
  const setText = (id: string, text: MediaText) => setDraft((current) => current ? {...current, mediaText: {...current.mediaText, [id]: text}} : current)
  const goTo = (next: StepId) => setParams((current) => { const copy = new URLSearchParams(current); copy.set('step', next); return copy }, {replace: true})
  const archived = story.status === 'archived'
  const mediaById = new Map(story.media.map((item) => [item.id, item]))
  const inlineImages = story.media.filter((item) => item.role === 'inline')

  const upload = async (role: MediaRole, file: File): Promise<string | null> => {
    setUploading(role)
    setUploadError(null)
    try {
      const media = await uploadStoryImage(storyId, role, file)
      setStory((current) => current ? {...current, media: [...current.media, media]} : current)
      setDraft((current) => {
        if (!current) return current
        const next = {...current, mediaText: {...current.mediaText, [media.id]: {...EMPTY_TEXT}}}
        if (role === 'cover') next.coverMediaId = media.id
        if (role === 'background') next.backgroundMediaId = media.id
        if (role === 'background') next.appearance = {...next.appearance, overlay: Math.max(next.appearance.overlay, MIN_OVERLAY_WITH_BACKGROUND)}
        if (role === 'gallery') next.gallery = [...next.gallery, media.id]
        return next
      })
      return media.id
    } catch (error) {
      const message = error instanceof StoryApiError && error.details?.length ? error.details.join(' ') : error instanceof Error ? error.message : 'Upload failed'
      setUploadError({role, message})
      return null
    } finally {
      setUploading(null)
    }
  }

  const removeMedia = async (media: AdminStoryMedia) => {
    try {
      await deleteStoryMedia(media.id)
      setStory((current) => current ? {...current, media: current.media.filter((item) => item.id !== media.id)} : current)
      setDraft((current) => current ? {
        ...current,
        coverMediaId: current.coverMediaId === media.id ? null : current.coverMediaId,
        backgroundMediaId: current.backgroundMediaId === media.id ? null : current.backgroundMediaId,
        gallery: current.gallery.filter((id) => id !== media.id),
        content: current.content.filter((block) => block.type !== 'image' || block.mediaId !== media.id),
      } : current)
    } catch (error) {
      setUploadError({role: media.role, message: error instanceof Error ? error.message : 'The photo could not be removed'})
    }
  }

  const reloadLatest = async () => {
    const latest = await loaded.refetch()
    if (latest.data) adopt(latest.data, true)
    setProblem(null)
  }

  const stepIndex = STEPS.findIndex((item) => item.id === step)
  const busy = save.isPending || command.isPending

  return <section className="space-y-6">
    <div className="flex flex-wrap items-center gap-3">
      <StepNav current={step} onSelect={goTo} />
      <div className="ml-auto flex items-center gap-3">
        <span className="text-xs text-zinc-500" aria-live="polite">{dirty ? 'Unsaved changes' : 'All changes saved'}</span>
        <Button variant="outline" disabled={busy || !dirty || archived} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save draft'}</Button>
      </div>
    </div>
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="rounded-full border border-white/10 px-2.5 py-0.5 text-xs uppercase text-zinc-300">{story.status}</span>
      {story.featured && <span className="rounded-full bg-emerald-400/15 px-2.5 py-0.5 text-xs font-semibold text-emerald-300">Featured on Discover</span>}
      {story.status === 'published' && <Link to={`/stories/${story.slug}`} target="_blank" className="inline-flex items-center gap-1 text-xs text-emerald-400 hover:underline">View live <ExternalLink className="h-3 w-3" /></Link>}
    </div>
    {archived && <p className="rounded-md border border-white/10 bg-white/[0.03] p-3 text-sm text-zinc-300">This story is archived. Move it back to drafts to edit it.</p>}
    {problem && <div role="alert" className="space-y-2 rounded-md border border-red-400/30 bg-red-400/5 p-3 text-sm text-red-200">
      <p className="flex gap-2"><AlertTriangle className="h-4 w-4 shrink-0" />{problem.message}</p>
      {problem.details && <ul className="list-disc pl-8">{problem.details.map((detail) => <li key={detail}>{detail}</li>)}</ul>}
      {problem.code === 'stale_story_version' && <Button size="sm" variant="outline" onClick={() => void reloadLatest()}>Reload latest (discards your unsaved changes)</Button>}
    </div>}

    <fieldset disabled={archived} className="min-w-0 space-y-6">
      {step === 'template' && <div className="space-y-5">
        <h1 className="text-2xl font-bold">Choose template</h1>
        <TemplatePicker value={draft.template} onChange={(template) => set({template})} />
      </div>}

      {step === 'content' && <div className="space-y-6">
        <h1 className="text-2xl font-bold">Add story</h1>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="story-title" label="Title"><Input id="story-title" required maxLength={160} value={draft.title} onChange={(event) => set({title: event.target.value})} /></Field>
          <Field id="story-slug" label="Link" hint={story.published_at ? 'Locked after publishing so links keep working.' : `mejayapp.com/stories/${draft.slug || '…'}: short words read best when shared; avoid numbers.`}>
            <Input id="story-slug" maxLength={80} value={draft.slug} disabled={Boolean(story.published_at)} onChange={(event) => set({slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-')})} />
          </Field>
          <Field id="story-teaser" label="Teaser" hint="One or two sentences for story cards." className="sm:col-span-2"><Textarea id="story-teaser" rows={2} maxLength={400} value={draft.teaser} onChange={(event) => set({teaser: event.target.value})} /></Field>
          <Field id="story-author" label="Author"><Input id="story-author" maxLength={120} placeholder="MeJay Editorial" value={draft.authorName} onChange={(event) => set({authorName: event.target.value})} /></Field>
          <Field id="story-category" label="Category"><Input id="story-category" maxLength={60} placeholder="Stories, Interview, New Music…" value={draft.category} onChange={(event) => set({category: event.target.value})} /></Field>
          <Field id="story-tags" label="Tags (optional)" hint="Separate with commas." className="sm:col-span-2"><Input id="story-tags" value={draft.tags} onChange={(event) => set({tags: event.target.value})} /></Field>
        </div>
        <section aria-labelledby="story-body-label" className="space-y-2"><h2 id="story-body-label" className="font-semibold">Article</h2>
          <StoryContentEditor blocks={draft.content} onChange={(content) => set({content})} inlineImages={inlineImages} onUploadInline={(file) => upload('inline', file)} uploading={uploading === 'inline'} />
          {uploadError?.role === 'inline' && <p role="alert" className="text-sm text-red-300">{uploadError.message}</p>}
        </section>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="story-quote" label="Highlighted quote (optional)" hint="Just the words. The page adds the quote marks, and the name comes from Quote attribution." className="sm:col-span-2"><Textarea id="story-quote" rows={2} maxLength={600} value={draft.quoteText} onChange={(event) => set({quoteText: event.target.value})} /></Field>
          <Field id="story-quote-by" label="Quote attribution"><Input id="story-quote-by" maxLength={120} value={draft.quoteAttribution} onChange={(event) => set({quoteAttribution: event.target.value})} /></Field>
          <div />
          <Field id="story-source-name" label="Source name (optional)"><Input id="story-source-name" maxLength={120} value={draft.sourceName} onChange={(event) => set({sourceName: event.target.value})} /></Field>
          <Field id="story-source-url" label="Original article link (optional)" hint="Must start with https://"><Input id="story-source-url" type="url" maxLength={2000} value={draft.sourceUrl} onChange={(event) => set({sourceUrl: event.target.value})} /></Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <LinkPicker kind="artist" label={draft.template === 'artist_spotlight' ? 'Featured MeJay artist' : 'Related artist (optional)'} selected={draft.artist ? {id: draft.artist.id, label: draft.artist.name, public: draft.artist.public} : null}
            onSelect={(option) => set({artist: option ? {id: option.id, name: option.name ?? '', slug: option.slug ?? '', public: option.public} : null})} />
          <LinkPicker kind="release" label={draft.template === 'release_drop' ? 'Release (required)' : 'Related release (optional)'} selected={draft.release ? {id: draft.release.id, label: draft.release.title, public: draft.release.public} : null}
            onSelect={(option) => set({release: option ? {id: option.id, title: option.title ?? '', public: option.public} : null})} />
        </div>
      </div>}

      {step === 'photos' && <div className="space-y-6">
        <h1 className="text-2xl font-bold">Photos & look</h1>
        <ImageSlot id="cover" label={draft.template === 'release_drop' ? 'Cover image (optional, the release artwork is used otherwise)' : 'Cover image'} hint="At least 1200 x 630. JPEG, PNG or WebP up to 15 MB."
          media={draft.coverMediaId ? mediaById.get(draft.coverMediaId) ?? null : null} text={draft.coverMediaId ? draft.mediaText[draft.coverMediaId] ?? EMPTY_TEXT : EMPTY_TEXT}
          uploading={uploading === 'cover'} error={uploadError?.role === 'cover' ? uploadError.message : null} onFile={(file) => void upload('cover', file)}
          onText={(text) => draft.coverMediaId && setText(draft.coverMediaId, text)} onRemove={() => { const media = draft.coverMediaId && mediaById.get(draft.coverMediaId); if (media) void removeMedia(media) }}>
          {draft.coverMediaId && mediaById.get(draft.coverMediaId) ? <FocalPointPicker media={mediaById.get(draft.coverMediaId)!} focal={draft.appearance.coverFocal} onChange={(coverFocal) => set({appearance: {...draft.appearance, coverFocal}})} /> : undefined}
        </ImageSlot>

        <section aria-labelledby="look-label" className="space-y-4 rounded-md border border-white/10 p-4">
          <h3 id="look-label" className="font-semibold">Colours</h3>
          <div role="radiogroup" aria-label="Story colours" className="flex flex-wrap gap-3">{PALETTES.map((palette) => <button key={palette.id} type="button" role="radio" aria-checked={draft.appearance.palette === palette.id} onClick={() => set({appearance: {...draft.appearance, palette: palette.id}})}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 ${draft.appearance.palette === palette.id ? 'border-emerald-400' : 'border-white/10'}`}>
            <span aria-hidden="true" className={`h-5 w-5 rounded-full ring-2 ${palette.swatch}`} />{palette.label}{draft.appearance.palette === palette.id && <Check className="h-3.5 w-3.5 text-emerald-300" />}
          </button>)}</div>
          <p className="text-xs text-zinc-500">Colours are preset so text always stays readable.</p>
        </section>

        <ImageSlot id="background" label="Background image (optional)" hint={draft.appearance.palette === 'paper' ? 'Not shown with the light Paper colours.' : 'Shown behind the top of the story under a dark overlay.'}
          media={draft.backgroundMediaId ? mediaById.get(draft.backgroundMediaId) ?? null : null} text={draft.backgroundMediaId ? draft.mediaText[draft.backgroundMediaId] ?? EMPTY_TEXT : EMPTY_TEXT}
          uploading={uploading === 'background'} error={uploadError?.role === 'background' ? uploadError.message : null} onFile={(file) => void upload('background', file)}
          onText={(text) => draft.backgroundMediaId && setText(draft.backgroundMediaId, text)} onRemove={() => { const media = draft.backgroundMediaId && mediaById.get(draft.backgroundMediaId); if (media) void removeMedia(media) }} />
        {draft.backgroundMediaId && <div className="space-y-2 rounded-md border border-white/10 p-4">
          <Label htmlFor="story-overlay">Overlay strength: {draft.appearance.overlay}%</Label>
          <input id="story-overlay" type="range" min={MIN_OVERLAY_WITH_BACKGROUND} max={90} step={5} value={draft.appearance.overlay} onChange={(event) => set({appearance: {...draft.appearance, overlay: Number(event.target.value)}})} className="w-full accent-emerald-400" />
          <p className="text-xs text-zinc-500">At least {MIN_OVERLAY_WITH_BACKGROUND}% so text on top stays readable.</p>
        </div>}

        <GalleryEditor items={draft.gallery.map((id) => mediaById.get(id)).filter((item): item is AdminStoryMedia => Boolean(item))} text={draft.mediaText}
          uploading={uploading === 'gallery'} error={uploadError?.role === 'gallery' ? uploadError.message : null} onFile={(file) => void upload('gallery', file)} onText={setText}
          onMove={(index, by) => { const next = [...draft.gallery]; const [item] = next.splice(index, 1); next.splice(index + by, 0, item); set({gallery: next}) }}
          onRemove={(id) => { const media = mediaById.get(id); if (media) void removeMedia(media) }} />
        <InlinePhotoText items={inlineImages.filter((media) => draft.content.some((block) => block.type === 'image' && block.mediaId === media.id))} text={draft.mediaText} onText={setText} />
      </div>}
    </fieldset>

    {step === 'preview' && view && <PreviewStep story={story} view={view} dirty={dirty} busy={busy} onCommand={(action) => command.mutate(action)} />}

    <div className="flex justify-between border-t border-white/10 pt-5">
      <Button variant="outline" disabled={stepIndex === 0} onClick={() => goTo(STEPS[stepIndex - 1].id)}>Back</Button>
      {stepIndex < STEPS.length - 1 && <Button className="bg-emerald-400 font-semibold text-zinc-950 hover:bg-emerald-300" disabled={busy} onClick={() => {
        if (!dirty || archived) return goTo(STEPS[stepIndex + 1].id)
        save.mutate(undefined, {onSuccess: () => goTo(STEPS[stepIndex + 1].id)})
      }}>{dirty && !archived ? 'Save and continue' : 'Next'}</Button>}
    </div>
  </section>
}

function PreviewStep({story, view, dirty, busy, onCommand}: {story: AdminStory; view: ReturnType<typeof toStoryView>; dirty: boolean; busy: boolean; onCommand: (action: StoryCommandAction) => void}) {
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const problems = story.publishProblems
  return <div className="space-y-5">
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="mr-auto text-2xl font-bold">Preview & publish</h1>
      <div role="radiogroup" aria-label="Preview size" className="inline-flex rounded-md border border-white/10 p-0.5">
        <button type="button" role="radio" aria-checked={device === 'desktop'} onClick={() => setDevice('desktop')} className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm ${device === 'desktop' ? 'bg-white/10' : 'text-zinc-400'}`}><Monitor className="h-4 w-4" />Desktop</button>
        <button type="button" role="radio" aria-checked={device === 'mobile'} onClick={() => setDevice('mobile')} className={`flex items-center gap-1.5 rounded px-3 py-1.5 text-sm ${device === 'mobile' ? 'bg-white/10' : 'text-zinc-400'}`}><Smartphone className="h-4 w-4" />Mobile</button>
      </div>
    </div>
    <PreviewFrame width={device === 'mobile' ? 390 : '100%'} title={`${device} preview`}><StoryRenderer story={view} /></PreviewFrame>

    {story.status !== 'archived' && <section aria-labelledby="publish-check" className="space-y-3 rounded-md border border-white/10 p-4">
      <h2 id="publish-check" className="font-semibold">Before publishing</h2>
      {dirty && <p className="text-xs text-zinc-400">You have unsaved changes; they are saved first when you publish.</p>}
      {problems.length === 0 ? <p className="flex items-center gap-2 text-sm text-emerald-300"><Check className="h-4 w-4" />Ready to publish (as of the last save).</p>
        : <ul className="list-disc space-y-1 pl-5 text-sm text-amber-200">{problems.map((item) => <li key={item}>{item}</li>)}</ul>}
    </section>}

    <div className="flex flex-wrap items-center gap-3">
      {story.status === 'draft' && <Button className="bg-emerald-400 font-semibold text-zinc-950 hover:bg-emerald-300" disabled={busy} onClick={() => onCommand('publish')}>Publish</Button>}
      {story.status === 'published' && <Button variant="outline" disabled={busy} onClick={() => onCommand('unpublish')}>Unpublish</Button>}
      {story.status === 'archived' && <Button variant="outline" disabled={busy} onClick={() => onCommand('unpublish')}>Move back to drafts</Button>}
      {story.status !== 'archived' && <Button variant="ghost" className="text-zinc-400 hover:text-red-300" disabled={busy} onClick={() => { if (window.confirm('Archive this story? It disappears from MeJay until you move it back to drafts.')) onCommand('archive') }}>Archive</Button>}
      <Label className="ml-auto flex items-center gap-2 text-sm">
        <Switch checked={story.featured} disabled={busy || story.status !== 'published'} onCheckedChange={(checked) => onCommand(checked ? 'feature' : 'unfeature')} />
        Feature on Discover{story.status !== 'published' && <span className="text-xs text-zinc-500">(publish first)</span>}
      </Label>
    </div>
    <p className="text-xs text-zinc-500">Only one story is featured at a time. Featuring this one replaces the current feature.</p>
  </div>
}

function Field({id, label, hint, className, children}: {id: string; label: string; hint?: string; className?: string; children: React.ReactNode}) {
  return <div className={`space-y-1.5 ${className ?? ''}`}><Label htmlFor={id}>{label}</Label>{children}{hint && <p className="text-xs text-zinc-500">{hint}</p>}</div>
}

function LinkPicker({kind, label, selected, onSelect}: {kind: 'artist' | 'release'; label: string; selected: {id: string; label: string; public: boolean} | null; onSelect: (option: StoryLinkOption | null) => void}) {
  const [term, setTerm] = useState('')
  const results = useQuery({queryKey: ['marketplace-admin', 'story-links', kind, term], queryFn: () => lookupStoryLinks(kind, term), enabled: term.trim().length >= 2})
  const id = `link-${kind}`
  return <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    {selected ? <div className="flex items-center gap-2 rounded-md border border-white/10 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate">{selected.label}</span>
      {!selected.public && <span className="text-xs text-amber-300">Not public yet</span>}
      <Button type="button" size="sm" variant="ghost" onClick={() => onSelect(null)}>Remove</Button>
    </div> : <>
      <Input id={id} placeholder={kind === 'artist' ? 'Search artists' : 'Search releases or artists'} value={term} onChange={(event) => setTerm(event.target.value)} />
      {results.data && <ul className="max-h-56 overflow-y-auto rounded-md border border-white/10" aria-label={`${kind} results`}>
        {results.data.length === 0 && <li className="px-3 py-2 text-sm text-zinc-500">No matches.</li>}
        {results.data.map((option) => <li key={option.id}><button type="button" onClick={() => { onSelect(option); setTerm('') }} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none">
          <span className="min-w-0 flex-1 truncate">{option.name ?? option.title}{option.artist_name ? ` · ${option.artist_name}` : ''}</span>
          {!option.public && <span className="text-xs text-amber-300">{kind === 'release' && option.status ? option.status.toLowerCase() : 'not public'}</span>}
        </button></li>)}
      </ul>}
    </>}
  </div>
}
