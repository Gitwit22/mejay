import type {KeyboardEvent, MouseEvent} from 'react'
import {ArrowDown, ArrowUp, ImagePlus, Trash2} from 'lucide-react'

import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {apiUrl} from '@/lib/api'
import {staffStoryMediaPath, type AdminStoryMedia} from '@/lib/storiesAdminApi'

export type MediaText = {altText: string; caption: string; credit: string}

/** File picker that hands over one image and resets, so the same file can be chosen again after an error. */
export function ImagePicker({label, uploading, onFile}: {label: string; uploading: boolean; onFile: (file: File) => void}) {
  return <Button asChild variant="outline" size="sm" className="gap-2"><label className="cursor-pointer"><ImagePlus className="h-4 w-4" />{uploading ? 'Uploading…' : label}
    <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => {
      const file = event.target.files?.[0]
      event.target.value = ''
      if (file) onFile(file)
    }} /></label></Button>
}

function TextFields({id, text, onChange, caption = true}: {id: string; text: MediaText; onChange: (text: MediaText) => void; caption?: boolean}) {
  return <div className={`grid gap-2 ${caption ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
    <div className="space-y-1"><Label htmlFor={`${id}-alt`}>Alt text (required)</Label><Input id={`${id}-alt`} maxLength={300} placeholder="What the photo shows" value={text.altText} aria-invalid={!text.altText.trim()} onChange={(event) => onChange({...text, altText: event.target.value})} /></div>
    {caption && <div className="space-y-1"><Label htmlFor={`${id}-caption`}>Caption</Label><Input id={`${id}-caption`} maxLength={300} value={text.caption} onChange={(event) => onChange({...text, caption: event.target.value})} /></div>}
    <div className="space-y-1"><Label htmlFor={`${id}-credit`}>Photo credit</Label><Input id={`${id}-credit`} maxLength={120} value={text.credit} onChange={(event) => onChange({...text, credit: event.target.value})} /></div>
  </div>
}

/**
 * Choose the part of the cover that must stay in view when it's cropped: click the photo, or
 * focus it and use the arrow keys.
 */
export function FocalPointPicker({media, focal, onChange}: {media: AdminStoryMedia; focal: {x: number; y: number}; onChange: (focal: {x: number; y: number}) => void}) {
  const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)))
  const pick = (event: MouseEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    onChange({x: clamp(((event.clientX - box.left) / box.width) * 100), y: clamp(((event.clientY - box.top) / box.height) * 100)})
  }
  const nudge = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 5
    const moves: Record<string, [number, number]> = {ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]}
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    onChange({x: clamp(focal.x + move[0]), y: clamp(focal.y + move[1])})
  }
  return <div className="space-y-2">
    <p className="text-xs text-zinc-400">Focus point: click the most important part of the photo, or use the arrow keys. Crops keep it in view.</p>
    <div role="slider" tabIndex={0} aria-label="Cover focus point" aria-valuetext={`${focal.x}% across, ${focal.y}% down`} aria-valuenow={focal.x} aria-valuemin={0} aria-valuemax={100}
      onClick={pick} onKeyDown={nudge} className="relative inline-block max-w-full cursor-crosshair overflow-hidden rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400">
      <img src={apiUrl(staffStoryMediaPath(media.id))} alt="" className="block max-h-72 max-w-full" draggable={false} />
      <span aria-hidden="true" className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-emerald-400/60 shadow" style={{left: `${focal.x}%`, top: `${focal.y}%`}} />
    </div>
    <div className="grid grid-cols-3 gap-2">{[['Wide', 'aspect-[16/9]'], ['Card', 'aspect-[4/3]'], ['Square', 'aspect-square']].map(([label, aspect]) => <figure key={label}>
      <div className={`overflow-hidden rounded ${aspect}`}><img src={apiUrl(staffStoryMediaPath(media.id))} alt="" className="h-full w-full object-cover" style={{objectPosition: `${focal.x}% ${focal.y}%`}} /></div>
      <figcaption className="mt-1 text-center text-[11px] text-zinc-500">{label}</figcaption>
    </figure>)}</div>
  </div>
}

/** One image slot (cover or background): upload, describe, replace or remove. */
export function ImageSlot({id, label, hint, media, text, uploading, error, onFile, onText, onRemove, caption = false, children}: {
  id: string; label: string; hint: string; media: AdminStoryMedia | null; text: MediaText; uploading: boolean; error: string | null
  onFile: (file: File) => void; onText: (text: MediaText) => void; onRemove: () => void; caption?: boolean; children?: React.ReactNode
}) {
  return <section aria-labelledby={`${id}-label`} className="space-y-3 rounded-md border border-white/10 p-4">
    <div className="flex flex-wrap items-center gap-3">
      <div className="mr-auto"><h3 id={`${id}-label`} className="font-semibold">{label}</h3><p className="text-xs text-zinc-500">{hint}</p></div>
      <ImagePicker label={media ? 'Replace' : 'Upload'} uploading={uploading} onFile={onFile} />
      {media && <Button type="button" size="sm" variant="ghost" className="text-zinc-400 hover:text-red-300" onClick={onRemove}>Remove</Button>}
    </div>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    {media && <>{children ?? <img src={apiUrl(staffStoryMediaPath(media.id))} alt="" className="max-h-48 rounded object-cover" />}<TextFields id={id} text={text} onChange={onText} caption={caption} /></>}
  </section>
}

/** Gallery photos in order, each with alt text, caption and credit. */
export function GalleryEditor({items, text, uploading, error, onFile, onText, onMove, onRemove}: {
  items: AdminStoryMedia[]; text: Record<string, MediaText>; uploading: boolean; error: string | null
  onFile: (file: File) => void; onText: (id: string, text: MediaText) => void; onMove: (index: number, by: -1 | 1) => void; onRemove: (id: string) => void
}) {
  return <section aria-labelledby="gallery-label" className="space-y-3 rounded-md border border-white/10 p-4">
    <div className="flex flex-wrap items-center gap-3">
      <div className="mr-auto"><h3 id="gallery-label" className="font-semibold">Photo gallery (optional)</h3><p className="text-xs text-zinc-500">At least 800 x 600. JPEG, PNG or WebP up to 15 MB.</p></div>
      <ImagePicker label="Add photo" uploading={uploading} onFile={onFile} />
    </div>
    {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
    <ol className="space-y-3">{items.map((media, index) => <li key={media.id} className="grid gap-3 rounded border border-white/5 p-3 sm:grid-cols-[8rem_1fr]">
      <img src={apiUrl(staffStoryMediaPath(media.id))} alt="" className="aspect-[4/3] w-32 rounded object-cover" />
      <div className="space-y-2">
        <TextFields id={`gallery-${media.id}`} text={text[media.id] ?? {altText: '', caption: '', credit: ''}} onChange={(value) => onText(media.id, value)} />
        <div className="flex gap-1">
          <Button type="button" size="sm" variant="ghost" aria-label={`Move photo ${index + 1} earlier`} disabled={index === 0} onClick={() => onMove(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
          <Button type="button" size="sm" variant="ghost" aria-label={`Move photo ${index + 1} later`} disabled={index === items.length - 1} onClick={() => onMove(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
          <Button type="button" size="sm" variant="ghost" className="text-zinc-400 hover:text-red-300" aria-label={`Remove photo ${index + 1}`} onClick={() => onRemove(media.id)}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
    </li>)}</ol>
  </section>
}

export function InlinePhotoText({items, text, onText}: {items: AdminStoryMedia[]; text: Record<string, MediaText>; onText: (id: string, text: MediaText) => void}) {
  if (items.length === 0) return null
  return <section aria-labelledby="inline-photos-label" className="space-y-3 rounded-md border border-white/10 p-4">
    <h3 id="inline-photos-label" className="font-semibold">Photos in the article</h3>
    <ol className="space-y-3">{items.map((media) => <li key={media.id} className="grid gap-3 sm:grid-cols-[8rem_1fr]">
      <img src={apiUrl(staffStoryMediaPath(media.id))} alt="" className="aspect-[4/3] w-32 rounded object-cover" />
      <TextFields id={`inline-${media.id}`} text={text[media.id] ?? {altText: '', caption: '', credit: ''}} onChange={(value) => onText(media.id, value)} />
    </li>)}</ol>
  </section>
}
