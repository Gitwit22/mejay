import {useEffect, useState} from 'react'
import {useMutation, useQuery, useQueryClient} from '@tanstack/react-query'
import {ExternalLink, ImageUp, Pencil} from 'lucide-react'
import {Link} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger} from '@/components/ui/dialog'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Textarea} from '@/components/ui/textarea'
import {toast} from '@/hooks/use-toast'
import {getArtistProfile, updateArtistProfile, uploadProviderAsset, type ArtistLinks, type ArtistProfile, type ProviderArtist} from '@/lib/providerApi'

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
}

function toForm(profile: ArtistProfile): FormState {
  return {
    name: profile.name, slug: profile.slug, tagline: profile.tagline ?? '', bio: profile.bio ?? '', location: profile.location ?? '',
    genres: profile.genres.join(', '), links: profile.links ?? {}, spotifyArtistId: profile.spotify_artist_id ?? '',
    appleMusicArtistId: profile.apple_music_artist_id ?? '', profilePhotoAssetId: profile.profile_photo_asset_id, bannerAssetId: profile.banner_asset_id,
  }
}

const IMAGE_RULES = {
  artist_photo: {label: 'Profile photo', minWidth: 400, minHeight: 400, maxBytes: 10 * 1024 * 1024, hint: 'JPG, PNG or WebP, at least 400×400, up to 10 MB'},
  artist_banner: {label: 'Banner', minWidth: 1200, minHeight: 300, maxBytes: 15 * 1024 * 1024, hint: 'JPG, PNG or WebP, at least 1200×300 and wider than tall, up to 15 MB'},
} as const

/** Edit an artist's public profile. The server only lets the artist's own account save it. */
export function ArtistProfileEditor({artist}: {artist: ProviderArtist}) {
  const [open, setOpen] = useState(false)
  return <Dialog open={open} onOpenChange={setOpen}>
    <DialogTrigger asChild><Button size="sm" variant="outline" className="gap-2"><Pencil className="h-3.5 w-3.5" />Edit profile</Button></DialogTrigger>
    <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto border-white/10 bg-[#111114] text-zinc-100">
      <DialogHeader><DialogTitle>{artist.name} — artist profile</DialogTitle></DialogHeader>
      {open && <ProfileForm artistId={artist.id} onSaved={() => setOpen(false)} />}
    </DialogContent>
  </Dialog>
}

function ProfileForm({artistId, onSaved}: {artistId: string; onSaved: () => void}) {
  const queryClient = useQueryClient()
  const profile = useQuery({queryKey: ['provider', 'artist-profile', artistId], queryFn: () => getArtistProfile(artistId)})
  const [form, setForm] = useState<FormState | null>(null)
  const [previews, setPreviews] = useState<{artist_photo?: string; artist_banner?: string}>({})
  useEffect(() => {
    if (profile.data && !form) setForm(toForm(profile.data))
  }, [profile.data, form])
  useEffect(() => () => Object.values(previews).forEach((url) => url && URL.revokeObjectURL(url)), [previews])

  const upload = useMutation({
    mutationFn: async ({kind, file}: {kind: 'artist_photo' | 'artist_banner'; file: File}) => {
      const rules = IMAGE_RULES[kind]
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use a JPG, PNG or WebP image')
      if (file.size > rules.maxBytes) throw new Error(`${rules.label} must be ${Math.round(rules.maxBytes / 1024 / 1024)} MB or smaller`)
      const image = await createImageBitmap(file)
      try {
        if (image.width < rules.minWidth || image.height < rules.minHeight) throw new Error(`${rules.label} must be at least ${rules.minWidth}×${rules.minHeight}`)
        if (kind === 'artist_banner' && image.width <= image.height) throw new Error('Banner must be wider than it is tall')
        const assetId = await uploadProviderAsset({kind, artistId, fileName: file.name, mimeType: file.type as 'image/jpeg' | 'image/png' | 'image/webp', byteSize: file.size, width: image.width, height: image.height}, file)
        return {kind, assetId, preview: URL.createObjectURL(file)}
      } finally {
        image.close()
      }
    },
    onSuccess: ({kind, assetId, preview}) => {
      setForm((current) => current && ({...current, [kind === 'artist_photo' ? 'profilePhotoAssetId' : 'bannerAssetId']: assetId}))
      setPreviews((current) => ({...current, [kind]: preview}))
    },
    onError: (error) => toast({title: 'Upload failed', description: error.message, variant: 'destructive'}),
  })

  const save = useMutation({
    mutationFn: () => updateArtistProfile(artistId, {
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
    }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({queryKey: ['provider', 'artist-profile', artistId]}),
        queryClient.invalidateQueries({queryKey: ['provider', 'artists']}),
      ])
      toast({title: 'Artist profile saved'})
      onSaved()
    },
  })

  if (profile.isLoading || !form) return <p className="text-sm text-zinc-400">Loading profile...</p>
  if (profile.isError) return <p className="text-sm text-red-400">{profile.error.message}</p>
  const live = (profile.data?.liveReleaseCount ?? 0) > 0
  const set = (patch: Partial<FormState>) => setForm({...form, ...patch})

  return <form className="space-y-5" onSubmit={(event) => {event.preventDefault(); save.mutate()}}>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor="artist-name">Artist / stage name</Label><Input id="artist-name" required maxLength={120} value={form.name} onChange={(event) => set({name: event.target.value})} /></div>
      <div className="space-y-1"><Label htmlFor="artist-slug">Page address</Label><div className="flex items-center gap-1 text-sm text-zinc-500">/artist/<Input id="artist-slug" className="h-9" value={form.slug} maxLength={80} onChange={(event) => set({slug: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-')})} /></div></div>
    </div>
    <p className="text-xs text-zinc-500">{live ? <Link to={`/artist/${profile.data?.slug}`} target="_blank" className="inline-flex items-center gap-1 text-emerald-400 hover:underline">View public page <ExternalLink className="h-3 w-3" /></Link> : 'Your public page goes live with your first approved, published release.'}</p>

    <div className="grid gap-4 sm:grid-cols-2">
      {(['artist_photo', 'artist_banner'] as const).map((kind) => {
        const assetId = kind === 'artist_photo' ? form.profilePhotoAssetId : form.bannerAssetId
        return <div key={kind} className="space-y-2 rounded-md border border-white/10 bg-[#141417] p-3">
          <p className="text-sm font-medium">{IMAGE_RULES[kind].label}</p>
          {previews[kind] ? <img src={previews[kind]} alt="" className={`w-full object-cover ${kind === 'artist_photo' ? 'aspect-square max-w-32 rounded-full' : 'aspect-[3/1] rounded'}`} /> : <p className="text-xs text-zinc-500">{assetId ? 'Image set' : 'No image yet'}</p>}
          <Label className="inline-flex cursor-pointer items-center gap-2 text-sm text-emerald-400"><ImageUp className="h-4 w-4" />{upload.isPending && upload.variables?.kind === kind ? 'Uploading...' : 'Upload'}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={upload.isPending} onChange={(event) => {const file = event.target.files?.[0]; if (file) upload.mutate({kind, file}); event.target.value = ''}} /></Label>
          {assetId && <Button type="button" variant="ghost" size="sm" onClick={() => set(kind === 'artist_photo' ? {profilePhotoAssetId: null} : {bannerAssetId: null})}>Remove</Button>}
          <p className="text-xs text-zinc-500">{IMAGE_RULES[kind].hint}</p>
        </div>
      })}
    </div>

    <div className="space-y-1"><Label htmlFor="artist-tagline">Short bio / tagline</Label><Input id="artist-tagline" maxLength={160} value={form.tagline} onChange={(event) => set({tagline: event.target.value})} /></div>
    <div className="space-y-1"><Label htmlFor="artist-bio">Biography</Label><Textarea id="artist-bio" rows={6} maxLength={5000} value={form.bio} onChange={(event) => set({bio: event.target.value})} /></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-1"><Label htmlFor="artist-location">City / location</Label><Input id="artist-location" maxLength={120} value={form.location} onChange={(event) => set({location: event.target.value})} /></div>
      <div className="space-y-1"><Label htmlFor="artist-genres">Genres (comma separated, up to 5)</Label><Input id="artist-genres" value={form.genres} onChange={(event) => set({genres: event.target.value})} /></div>
    </div>

    <fieldset className="space-y-3"><legend className="text-sm font-semibold">Links</legend>
      <div className="grid gap-3 sm:grid-cols-2">{linkFields.map(([key, label, placeholder]) => <div key={key} className="space-y-1"><Label htmlFor={`link-${key}`}>{label}</Label><Input id={`link-${key}`} type="url" placeholder={placeholder} value={form.links[key] ?? ''} onChange={(event) => set({links: {...form.links, [key]: event.target.value}})} /></div>)}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1"><Label htmlFor="spotify-id">Spotify artist ID (optional)</Label><Input id="spotify-id" value={form.spotifyArtistId} onChange={(event) => set({spotifyArtistId: event.target.value})} /></div>
        <div className="space-y-1"><Label htmlFor="apple-id">Apple Music artist ID (optional)</Label><Input id="apple-id" inputMode="numeric" value={form.appleMusicArtistId} onChange={(event) => set({appleMusicArtistId: event.target.value})} /></div>
      </div>
    </fieldset>

    {save.isError && <p className="text-sm text-red-400">{save.error.message}</p>}
    <div className="flex justify-end gap-2"><Button type="submit" disabled={save.isPending || upload.isPending}>{save.isPending ? 'Saving...' : 'Save profile'}</Button></div>
  </form>
}
