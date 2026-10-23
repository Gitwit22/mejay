import {ArrowDown, ArrowUp, Heading2, ImagePlus, List, Pilcrow, Quote, Trash2} from 'lucide-react'

import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Textarea} from '@/components/ui/textarea'
import {staffStoryMediaPath, type AdminStoryMedia} from '@/lib/storiesAdminApi'
import {apiUrl} from '@/lib/api'
import type {StoryBlock} from '@/lib/storiesApi'

const BLOCK_LABELS: Record<StoryBlock['type'], string> = {paragraph: 'Paragraph', heading: 'Heading', list: 'List', quote: 'Quote', image: 'Photo'}

/**
 * The article body as a list of blocks. Every control is a real button or field, so the whole
 * editor works from the keyboard. Formatting inside text: **bold**, *italic*, [text](https://link).
 */
export function StoryContentEditor({blocks, onChange, inlineImages, onUploadInline, uploading}: {
  blocks: StoryBlock[]
  onChange: (blocks: StoryBlock[]) => void
  inlineImages: AdminStoryMedia[]
  onUploadInline: (file: File) => Promise<string | null>
  uploading: boolean
}) {
  const update = (index: number, block: StoryBlock) => onChange(blocks.map((current, at) => at === index ? block : current))
  const move = (index: number, by: -1 | 1) => {
    const next = [...blocks]
    const [item] = next.splice(index, 1)
    next.splice(index + by, 0, item)
    onChange(next)
  }
  const add = (block: StoryBlock) => onChange([...blocks, block])

  return <div className="space-y-3">
    <p className="text-xs text-zinc-500">Formatting: <code>**bold**</code>, <code>*italic*</code>, and links as <code>[words](https://example.com)</code>. Only https:// and http:// links are allowed.</p>
    {blocks.length === 0 && <p className="rounded-md border border-dashed border-white/10 p-4 text-sm text-zinc-500">Start with a paragraph.</p>}
    <ol className="space-y-3">{blocks.map((block, index) => <li key={index} className="rounded-md border border-white/10 bg-white/[0.02] p-3">
      <div className="mb-2 flex items-center gap-1">
        <span className="mr-auto text-xs font-semibold uppercase text-zinc-500">{index + 1}. {BLOCK_LABELS[block.type]}</span>
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`Move block ${index + 1} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" aria-label={`Move block ${index + 1} down`} disabled={index === blocks.length - 1} onClick={() => move(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8 text-zinc-500 hover:text-red-300" aria-label={`Remove block ${index + 1}`} onClick={() => onChange(blocks.filter((_, at) => at !== index))}><Trash2 className="h-4 w-4" /></Button>
      </div>
      <BlockFields block={block} index={index} onChange={(next) => update(index, next)} inlineImages={inlineImages} />
    </li>)}</ol>
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => add({type: 'paragraph', text: ''})}><Pilcrow className="h-3.5 w-3.5" />Paragraph</Button>
      <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => add({type: 'heading', text: ''})}><Heading2 className="h-3.5 w-3.5" />Heading</Button>
      <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => add({type: 'list', items: ['']})}><List className="h-3.5 w-3.5" />List</Button>
      <Button type="button" size="sm" variant="outline" className="gap-1.5" onClick={() => add({type: 'quote', text: ''})}><Quote className="h-3.5 w-3.5" />Quote</Button>
      <Button asChild size="sm" variant="outline" className="gap-1.5"><label className="cursor-pointer"><ImagePlus className="h-3.5 w-3.5" />{uploading ? 'Uploading…' : 'Photo'}
        <input className="sr-only" type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void onUploadInline(file).then((mediaId) => { if (mediaId) add({type: 'image', mediaId}) })
        }} /></label></Button>
    </div>
  </div>
}

function BlockFields({block, index, onChange, inlineImages}: {block: StoryBlock; index: number; onChange: (block: StoryBlock) => void; inlineImages: AdminStoryMedia[]}) {
  const id = `block-${index}`
  switch (block.type) {
    case 'paragraph':
      return <><Label htmlFor={id} className="sr-only">Paragraph {index + 1}</Label><Textarea id={id} rows={5} maxLength={5000} value={block.text} onChange={(event) => onChange({...block, text: event.target.value})} /></>
    case 'heading':
      return <><Label htmlFor={id} className="sr-only">Heading {index + 1}</Label><Input id={id} maxLength={200} value={block.text} onChange={(event) => onChange({...block, text: event.target.value})} /></>
    case 'quote':
      return <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
        <div><Label htmlFor={id} className="sr-only">Quote {index + 1}</Label><Textarea id={id} rows={2} maxLength={600} value={block.text} onChange={(event) => onChange({...block, text: event.target.value})} /></div>
        <div><Label htmlFor={`${id}-by`} className="sr-only">Quote {index + 1} attribution</Label><Input id={`${id}-by`} placeholder="Who said it" maxLength={120} value={block.attribution ?? ''} onChange={(event) => onChange({...block, attribution: event.target.value})} /></div>
      </div>
    case 'list':
      return <div className="space-y-2">{block.items.map((item, at) => <div key={at} className="flex gap-2">
        <Input aria-label={`List ${index + 1} item ${at + 1}`} maxLength={500} value={item} onChange={(event) => onChange({...block, items: block.items.map((value, position) => position === at ? event.target.value : value)})} />
        <Button type="button" size="icon" variant="ghost" aria-label={`Remove item ${at + 1}`} onClick={() => onChange({...block, items: block.items.filter((_, position) => position !== at)})}><Trash2 className="h-4 w-4" /></Button>
      </div>)}<Button type="button" size="sm" variant="ghost" onClick={() => onChange({...block, items: [...block.items, '']})}>Add item</Button></div>
    case 'image': {
      const media = inlineImages.find((item) => item.id === block.mediaId)
      return media ? <img src={apiUrl(staffStoryMediaPath(media.id))} alt={media.alt_text ?? ''} className="max-h-48 rounded object-cover" />
        : <p className="text-sm text-amber-300">This photo is missing. Remove the block or upload it again.</p>
    }
  }
}
