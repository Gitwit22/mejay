import {useEffect, useState} from 'react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {ArrowDown, ArrowUp, ExternalLink, ImagePlus, ImageUp, Pencil, Trash2} from 'lucide-react'
import {Link} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Textarea} from '@/components/ui/textarea'
import {toast} from '@/hooks/use-toast'
import {getArtistProfile, replaceArtistGallery, updateArtistProfile, uploadProviderAsset, type ArtistLinks, type ArtistProfile, type ProviderArtist} from '@/lib/providerApi'

const linkFields: Array<[keyof ArtistLinks, string, string]> = [
  ['website', 'Website', 'https://yoursite.com'],
  ['instagram', 'Instagram', 'https://instagram.com/…'],
  ['tiktok', 'TikTok', 'https://tiktok.com/@…'],
  ['youtube', 'YouTube', 'https://youtube.com/@…'],
  ['facebook', 'Facebook', 'https://facebook.com/…'],
  ['x', 'X / Twitter', 'https://x.com/…'],
  ['spotify', 'Spotify artist URL', 'https://open.spotify.com/artist/…'],
  ['appleMusic', 'Apple Music artist URL', 'https://music.apple.com/…'],
  ['soundcloud', 'SoundCloud', 'https://soundcloud.com/…'],
  ['bandcamp', 'Bandcamp', 'https://….bandcamp.com'],
]

const DEFAULT_ACCENT = '#10b981'
const GALLERY_LIMIT = 12

type GalleryItem = {assetId: string; caption: string; preview?: string}

type FormState = {
  name: string
  slug: string
  tagline: string
  bio: string
  location: string
  genres: string
  links: ArtistLinks
  spotifyArtistId: string
  appleMusicArtistId: string
  profilePhotoAssetId: string | null
  bannerAssetId: string | null
  cutoutAssetId: string | null
  storyPhotoAssetId: string | null
  featuredReleaseId: string
  accentColor: string
  highlightQuote: string
}

function toForm(profile: ArtistProfile): FormState {
  return {
    name: profile.name, slug: profile.slug, tagline: profile.tagline ?? '', bio: profile.bio ?? '', location: profile.location ?? '',
    genres: profile.genres.join(', '), links: profile.links ?? {}, spotifyArtistId: profile.spotify_artist_id ?? '',
    appleMusicArtistId: profile.apple_music_artist_id ?? '', profilePhotoAssetId: profile.profile_photo_asset_id, bannerAssetId: profile.banner_asset_id,
    cutoutAssetId: profile.cutout_asset_id ?? null, storyPhotoAssetId: profile.story_photo_asset_id ?? null,
    featuredReleaseId: profile.featured_release_id ?? '', accentColor: profile.accent_color ?? DEFAULT_ACCENT, highlightQuote: profile.highlight_quote ?? '',
  }
}

type ImageKind = 'artist_photo' | 'artist_banner' | 'artist_cutout' | 'artist_gallery'
type ImageSlot = 'profilePhotoAssetId' | 'bannerAssetId' | 'cutoutAssetId' | 'storyPhotoAssetId'

const IMAGE_RULES: Record<ImageKind, {label: string; minWidth: number; minHeight: number; maxBytes: number; types: string[]; hint: string}> = {
  artist_photo: {label: 'Photo', minWidth: 400, minHeight: 400, maxBytes: 10 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'], hint: 'JPG, PNG or WebP, at least 400×400, up to 10 MB'},
  artist_banner: {label: 'City background', minWidth: 1200, minHeight: 300, maxBytes: 15 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'], hint: 'Wide skyline photo: JPG, PNG or WebP, at least 1200×300, up to 15 MB. Leave empty to use the MeJay Detroit skyline.'},
  artist_cutout: {label: 'Artist cutout', minWidth: 600, minHeight: 800, maxBytes: 15 * 1024 * 1024, types: ['image/png', 'image/webp'], hint: 'A PNG or WebP of you with the background removed (transparent), at least 600×800, up to 15 MB. Stands in front of the skyline.'},
  artist_gallery: {label: 'Gallery photo', minWidth: 800, minHeight: 600, maxBytes: 10 * 1024 * 1024, types: ['image/jpeg', 'image/png', 'image/webp'], hint: 'JPG, PNG or WebP, at least 800×600, up to 10 MB'},
}

const SLOTS: Array<{slot: ImageSlot; kind: ImageKind; label: string; shape: string; hint?: string}> = [
  {slot: 'cutoutAssetId', kind: 'artist_cutout', label: 'Artist cutout', shape: 'aspect-[3/4] max-w-40 object-contain'},
  {slot: 'bannerAssetId', kind: 'artist_banner', label: 'City background', shape: 'aspect-[3/1] rounded object-cover'},
  {slot: 'profilePhotoAssetId', kind: 'artist_photo', label: 'Profile photo', shape: 'aspect-square max-w-32 rounded-full object-cover', hint: 'Shown when there is no cutout. JPG, PNG or WebP, at least 400×400.'},
  {slot: 'storyPhotoAssetId', kind: 'artist_photo', label: 'Story photo', shape: 'aspect-[4/5] max-w-40 rounded object-cover', hint: 'Shown beside your biography. JPG, PNG or WebP, at least 400×400.'},
]

/** Checks type, size and dimensions in the browser, then uploads through the signed URL flow. */
async function uploadImage(kind: ImageKind, artistId: string, file: File): Promise<string> {
  const rules = IMAGE_RULES[kind]
  if (!rules.types.includes(file.type)) throw new Error(kind === 'artist_cutout' ? 'Use a transparent PNG or WebP' : 'Use a JPG, PNG or WebP image')
  if (file.size > rules.maxBytes) throw new Error(`${rules.label} must be ${Math.round(rules.maxBytes / 1024 / 1024)} MB or smaller`)
  const image = await createImageBitmap(file)
  try {
    if (image.width < rules.minWidth || image.height < rules.minHeight) throw new Error(`${rules.label} must be at least ${rules.minWidth}×${rules.minHeight}`)
    if (kind === 'artist_banner' && image.width <= image.height) throw new Error('The city background must be wider than it is tall')
    return await uploadProviderAsset({kind, artistId, fileName: file.name, mimeType: file.type as 'image/jpeg' | 'image/png' | 'image/webp', byteSize: file.size, width: image.width, height: image.height}, file)
  } finally {
    image.close()
  }
}

/** Edit an artist's public profile. The server only lets the artist's own account save it. */
export function ArtistProfileEditor({artist}: {artist: ProviderArtist}) {
  const [open, setOpen] = useState(false)
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm" variant="outline" className="gap-2"><Pencil className="h-3.5 w-3.5" />Edit profile</Button></DialogTrigger>
    <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-white/10 bg-[#111114] text-zinc-100">
      <DialogHeader><DialogTitle>{artist.name} — artist page</DialogTitle></DialogHeader>
      {open && <ProfileForm artistId={artist.id} onSaved={() => setOpen(false)} />}
    </DialogContent>
  </Dialog>
}

function ProfileForm({artistId, onSaved}: {artistId: string; onSaved: () => void}) {
  const queryClient = useQueryClient()
  const profile = useQuery({queryKey: ['provider', 'artist-profile', artistId], queryFn: () => getArtistProfile(artistId)})
  const [form, setForm] = useState<FormState | null>(null)
  const [gallery, setGallery] = useState<GalleryItem[] | null>(null)
  const [galleryChanged, setGalleryChanged] = useState(false)
  const [previews, setPreviews] = useState<Partial<Record<ImageSlot, string>>>({})
  useEffect(() => {
    if (profile.data && !form) {
      setForm(toForm(profile.data))
      setGallery((profile.data.gallery ?? []).map((image) => ({assetId: image.asset_id, caption: image.caption ?? ''})))
    }
  }, [profile.data, form])
  useEffect(() => () => {
    Object.values(previews).forEach((url) => url && URL.revokeObjectURL(url))
  }, [previews])

  const upload = useMutation({
    mutationFn: async ({slot, kind, file}: {slot: ImageSlot; kind: ImageKind; file: File}) => ({slot, assetId: await uploadImage(kind, artistId, file), preview: URL.createObjectURL(file)}),
    onSuccess: ({slot, assetId, preview}) => {
      setForm((current) => current && ({...current, [slot]: assetId}))
      setPreviews((current) => ({...current, [slot]: preview}))
    },
    onError: (error) => toast({title: 'Upload failed', description: error.message, variant: 'destructive'}),
  })

  const addGalleryPhoto = useMutation({
    mutationFn: async (file: File) => ({assetId: await uploadImage('artist_gallery', artistId, file), preview: URL.createObjectURL(file)}),
    onSuccess: ({assetId, preview}) => {
      setGallery((current) => [...(current ?? []), {assetId, caption: '', preview}])
      setGalleryChanged(true)
    },
    onError: (error) => toast({title: 'Upload failed', description: error.message, variant: 'destructive'}),
  })

  const save = useMutation({
    mutationFn: async () => {
      await updateArtistProfile(artistId, {
        name: form!.name.trim(),
        slug: form!.slug.trim() || undefined,
        tagline: form!.tagline.trim() || null,
        bio: form!.bio.trim() || null,
        location: form!.location.trim() || null,
        genres: form!.genres.split(',').map((genre) => genre.trim()).filter(Boolean).slice(0, 5),
        links: Object.fromEntries(Object.entries(form!.links).map(([key, value]) => [key, value?.trim() ?? '']).filter(([, value]) => value)),
        spotifyArtistId: form!.spotifyArtistId.trim() || null,
        appleMusicArtistId: form!.appleMusicArtistId.trim() || null,
        profilePhotoAssetId: form!.profilePhotoAssetId,
        bannerAssetId: form!.bannerAssetId,
        cutoutAssetId: form!.cutoutAssetId,
        storyPhotoAssetId: form!.storyPhotoAssetId,
        featuredReleaseId: form!.featuredReleaseId || null,
        accentColor: form!.accentColor,
        highlightQuote: form!.highlightQuote.trim() || null,
      })
      if (galleryChanged && gallery) {
        await replaceArtistGallery(artistId, gallery.map((item) => ({assetId: item.assetId, caption: item.caption.trim() || null})))
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({queryKey: ['provider', 'artist-profile', artistId]}),
        queryClient.invalidateQueries({queryKey: ['provider', 'artists']}),
      ])
      toast({title: 'Artist page saved'})
      onSaved()
    },
  })

  if (profile.isLoading || !form || !gallery) return <p className="text-sm text-zinc-400">Loading profile...</p>
  if (profile.isError) return <p className="text-sm text-red-400">{profile.error.message}</p>
  const live = (profile.data?.liveReleaseCount ?? 0) > 0
  const liveReleases = profile.data?.liveReleases ?? []
  const set = (patch: Partial<FormState>) => setForm({...form, ...patch})
  const updateGallery = (next: GalleryItem[]) => {
    setGallery(next)
    setGalleryChanged(true)
  }
  const moveGallery = (index: number, offset: number) => {
    const next = [...gallery]
    const [item] = next.splice(index, 1)
    next.splice(index + offset, 0, item)
    updateGallery(next)
  }
  const busy = upload.isPending || addGalleryPhoto.isPending

  return <form className="space-y-6" onSubmit={(event) => {event.preventDefault(); save.mutate()}}>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor="artist-name">Artist / stage name</Label><Input id="artist-name" required maxLength={120} value={form.name} onChange={(event) => set({name: event.target.value})} /></div>
      <div className="space-y-1"><Label htmlFor="artist-slug">Page address</Label><div className="flex items-center gap-1 text-sm text-zinc-500">/artist/<Input id="artist-slug" className="h-9" value={form.slug} maxLength={80} onChange={(event) => set({slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-')})} /></div></div>
    </div>
    <p className="text-xs text-zinc-500">{live ? <Link to={`/artist/${profile.data?.slug}`} target="_blank" className="inline-flex items-center gap-1 text-emerald-400 hover:underline">View public page <ExternalLink className="h-3 w-3" /></Link> : 'Your public page goes live with your first approved, published release.'}</p>

    <fieldset className="space-y-3"><legend className="text-sm font-semibold">Page look</legend>
      <div className="grid gap-4 sm:grid-cols-2">
        {SLOTS.map(({slot, kind, label, shape, hint}) => {
          const assetId = form[slot]
          return <div key={slot} className="space-y-2 rounded-md border border-white/10 bg-[#141417] p-3">
            <p className="text-sm font-medium">{label}</p>
            {previews[slot] ? <img src={previews[slot]} alt="" className={`w-full ${shape}`} /> : <p className="text-xs text-zinc-500">{assetId ? 'Image set' : 'No image yet'}</p>}
            <Label className="inline-flex cursor-pointer items-center gap-2 text-sm text-emerald-400"><ImageUp className="h-4 w-4" />{upload.isPending && upload.variables?.slot === slot ? 'Uploading...' : 'Upload'}
              <input type="file" aria-label={`Upload ${label.toLowerCase()}`} accept={IMAGE_RULES[kind].types.join(',')} className="sr-only" disabled={busy} onChange={(event) => {const file = event.target.files?.[0]; if (file) upload.mutate({slot, kind, file}); event.target.value = ''}} />
            </Label>
            {assetId && <Button type="button" variant="ghost" size="sm" onClick={() => set({[slot]: null} as Partial<FormState>)}>Remove</Button>}
            <p className="text-xs text-zinc-500">{hint ?? IMAGE_RULES[kind].hint}</p>
          </div>
        })}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="artist-accent">Accent colour</Label>
          <div className="flex items-center gap-2"><input id="artist-accent" type="color" className="h-9 w-12 cursor-pointer rounded border border-white/10 bg-transparent" value={form.accentColor} onChange={(event) => set({accentColor: event.target.value})} /><span className="font-mono text-xs text-zinc-400">{form.accentColor}</span></div>
        </div>
        <div className="space-y-1"><Label htmlFor="artist-featured">Featured release</Label>
          <select id="artist-featured" className="h-9 w-full rounded-md border border-white/10 bg-[#141417] px-2 text-sm" value={form.featuredReleaseId} onChange={(event) => set({featuredReleaseId: event.target.value})}>
            <option value="">Latest release (automatic)</option>
            {liveReleases.map((release) => <option key={release.id} value={release.id}>{release.title}</option>)}
          </select>
        </div>
      </div>
    </fieldset>

    <div className="space-y-1"><Label htmlFor="artist-tagline">Short bio / tagline</Label><Input id="artist-tagline" maxLength={160} value={form.tagline} onChange={(event) => set({tagline: event.target.value})} /></div>
    <div className="space-y-1"><Label htmlFor="artist-bio">Biography</Label><Textarea id="artist-bio" rows={6} maxLength={5000} value={form.bio} onChange={(event) => set({bio: event.target.value})} /></div>
    <div className="space-y-1"><Label htmlFor="artist-quote">Quote or career highlight</Label><Input id="artist-quote" maxLength={280} value={form.highlightQuote} onChange={(event) => set({highlightQuote: event.target.value})} /></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor="artist-location">City / location</Label><Input id="artist-location" maxLength={120} value={form.location} onChange={(event) => set({location: event.target.value})} /></div>
      <div className="space-y-1"><Label htmlFor="artist-genres">Genres (comma separated, up to 5)</Label><Input id="artist-genres" value={form.genres} onChange={(event) => set({genres: event.target.value})} /></div>
    </div>

    <fieldset className="space-y-3"><legend className="text-sm font-semibold">Photo gallery ({gallery.length}/{GALLERY_LIMIT})</legend>
      {gallery.length > 0 && <ul className="space-y-2">
        {gallery.map((item, index) => <li key={item.assetId} className="flex items-center gap-2 rounded-md border border-white/10 bg-[#141417] p-2">
          {item.preview ? <img src={item.preview} alt="" className="h-12 w-12 shrink-0 rounded object-cover" /> : <div className="grid h-12 w-12 shrink-0 place-items-center rounded bg-zinc-800 text-xs text-zinc-500">{index + 1}</div>}
          <Input aria-label={`Caption for photo ${index + 1}`} placeholder="Caption (optional)" maxLength={140} value={item.caption} onChange={(event) => updateGallery(gallery.map((entry, i) => i === index ? {...entry, caption: event.target.value} : entry))} />
          <Button type="button" size="icon" variant="ghost" aria-label="Move up" disabled={index === 0} onClick={() => moveGallery(index, -1)}><ArrowUp className="h-4 w-4" /></Button>
          <Button type="button" size="icon" variant="ghost" aria-label="Move down" disabled={index === gallery.length - 1} onClick={() => moveGallery(index, 1)}><ArrowDown className="h-4 w-4" /></Button>
          <Button type="button" size="icon" variant="ghost" aria-label="Remove photo" onClick={() => updateGallery(gallery.filter((_, i) => i !== index))}><Trash2 className="h-4 w-4" /></Button>
        </li>)}
      </ul>}
      {gallery.length < GALLERY_LIMIT && <Label className="inline-flex cursor-pointer items-center gap-2 text-sm text-emerald-400"><ImagePlus className="h-4 w-4" />{addGalleryPhoto.isPending ? 'Uploading...' : 'Add photo'}
        <input type="file" aria-label="Add gallery photo" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={(event) => {const file = event.target.files?.[0]; if (file) addGalleryPhoto.mutate(file); event.target.value = ''}} />
      </Label>}
      <p className="text-xs text-zinc-500">{IMAGE_RULES.artist_gallery.hint}. Press photos, performances, behind the scenes.</p>
    </fieldset>

    <fieldset className="space-y-3"><legend className="text-sm font-semibold">Links</legend>
      <div className="space-y-1"><Label htmlFor="link-booking">Booking / contact</Label><Input id="link-booking" placeholder="https://… or mailto:booking@you.com" maxLength={300} value={form.links.booking ?? ''} onChange={(event) => set({links: {...form.links, booking: event.target.value}})} /></div>
      <div className="grid gap-3 sm:grid-cols-2">{linkFields.map(([key, label, placeholder]) => <div key={key} className="space-y-1"><Label htmlFor={`link-${key}`}>{label}</Label><Input id={`link-${key}`} type="url" placeholder={placeholder} value={form.links[key] ?? ''} onChange={(event) => set({links: {...form.links, [key]: event.target.value}})} /></div>)}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="spotify-id">Spotify artist ID (optional)</Label><Input id="spotify-id" value={form.spotifyArtistId} onChange={(event) => set({spotifyArtistId: event.target.value})} /></div>
        <div className="space-y-1"><Label htmlFor="apple-id">Apple Music artist ID (optional)</Label><Input id="apple-id" inputMode="numeric" value={form.appleMusicArtistId} onChange={(event) => set({appleMusicArtistId: event.target.value})} /></div>
      </div>
    </fieldset>

    {save.isError && <p className="text-sm text-red-400">{save.error.message}</p>}
    <div className="flex justify-end gap-2"><Button type="submit" disabled={save.isPending || busy}>{save.isPending ? 'Saving...' : 'Save artist page'}</Button></div>
  </form>
}
