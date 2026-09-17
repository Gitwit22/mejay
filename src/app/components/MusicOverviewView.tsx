import {useEffect, useRef, useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {ArrowRight, Disc3, Pause, Play, ShoppingBag, Sparkles} from 'lucide-react'
import {Link} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Skeleton} from '@/components/ui/skeleton'
import {getMusicDiscovery} from '@/lib/musicDiscoveryApi'
import {recordStorePreview, storeAssetUrl, type StoreRelease} from '@/lib/musicStoreApi'

export function MusicOverviewView() {
  const discovery = useQuery({queryKey: ['music', 'discovery'], queryFn: getMusicDiscovery})
  const preview = usePreviewPlayer()

  if (discovery.isLoading) return <MusicLoading />
  if (discovery.isError) return <MusicError message={discovery.error.message} retry={() => void discovery.refetch()} />
  if (!discovery.data) return null

  const data = discovery.data
  const empty = Object.values(data).every((items) => items.length === 0)

  return <div className="mx-auto h-full w-full max-w-7xl overflow-y-auto pb-32 text-zinc-100">
    <header className="flex items-end justify-between gap-4 border-b border-white/10 pb-6">
      <div><p className="text-xs font-semibold uppercase text-emerald-400">Discover</p><h1 className="mt-1 text-3xl font-black tracking-normal sm:text-4xl">MEJAY MUSIC</h1><p className="mt-2 text-sm text-zinc-500">What is new and moving across MEJay.</p></div>
      <Button asChild variant="outline" className="shrink-0 gap-2 border-white/10 bg-black/20"><Link to="/app/store"><ShoppingBag className="h-4 w-4" /><span className="hidden sm:inline">Marketplace</span></Link></Button>
    </header>

    {empty ? <EmptyMusic /> : <div className="space-y-12 py-8">
      <ReleaseRail title="Admin Picks" releases={data.featuredReleases} preview={preview} icon={<Sparkles className="h-4 w-4 text-emerald-400" />} />
      <ReleaseRail title="New This Week" releases={data.newestReleases} preview={preview} />
      <ReleaseRail title="New Singles" releases={data.newestSingles} preview={preview} />
      <ReleaseRail title="New Projects" releases={data.newestProjects} preview={preview} />
      {(data.mostPurchased.length > 0 || data.mostPreviewed.length > 0) && <section>
        <SectionHeading title="Trending on MEJay" />
        <div className="space-y-8">
          <ReleaseRail title="Most Purchased" releases={data.mostPurchased} preview={preview} nested />
          <ReleaseRail title="Most Previewed" releases={data.mostPreviewed} preview={preview} nested />
        </div>
      </section>}
      {data.featuredArtists.length > 0 && <section><SectionHeading title="Featured Artists" /><div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">{data.featuredArtists.map((artist) => {
        const artwork = storeAssetUrl(artist.artwork_asset_id)
        return <Link key={artist.id} to={`/app/store?artist=${encodeURIComponent(artist.id)}`} className="group min-w-0"><div className="aspect-square overflow-hidden rounded-full bg-[#18181b]">{artwork ? <img src={artwork} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" /> : <div className="grid h-full place-items-center"><Disc3 className="h-10 w-10 text-zinc-700" /></div>}</div><p className="mt-3 truncate text-center font-bold group-hover:text-emerald-400">{artist.name}</p><p className="mt-1 text-center text-xs text-zinc-600">{artist.release_count} {artist.release_count === 1 ? 'release' : 'releases'}</p></Link>
      })}</div></section>}
    </div>}
  </div>
}

type PreviewPlayer = {playingId: string | null; toggle: (release: StoreRelease) => void}

function usePreviewPlayer(): PreviewPlayer {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [playingId, setPlayingId] = useState<string | null>(null)

  useEffect(() => () => audioRef.current?.pause(), [])

  const toggle = (release: StoreRelease) => {
    const url = storeAssetUrl(release.preview_asset_id)
    if (!url) return
    if (playingId === release.id) {
      audioRef.current?.pause()
      setPlayingId(null)
      return
    }
    audioRef.current?.pause()
    const audio = new Audio(url)
    audio.preload = 'metadata'
    audio.addEventListener('ended', () => setPlayingId(null), {once: true})
    audio.addEventListener('error', () => setPlayingId(null), {once: true})
    audioRef.current = audio
    void audio.play().then(() => {
      setPlayingId(release.id)
      if (release.preview_asset_id) void recordStorePreview(release.preview_asset_id).catch(() => undefined)
    }).catch(() => setPlayingId(null))
  }

  return {playingId, toggle}
}

function ReleaseRail({title, releases, preview, nested = false, icon}: {title: string; releases: StoreRelease[]; preview: PreviewPlayer; nested?: boolean; icon?: React.ReactNode}) {
  if (releases.length === 0) return null
  return <section><SectionHeading title={title} small={nested} icon={icon} /><div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{releases.map((release) => <ReleaseCard key={release.id} release={release} preview={preview} />)}</div></section>
}

function ReleaseCard({release, preview}: {release: StoreRelease; preview: PreviewPlayer}) {
  const artwork = storeAssetUrl(release.artwork_asset_id)
  const playing = preview.playingId === release.id
  return <article className="group min-w-0"><Link to={`/app/store/${release.id}`} className="block"><div className="relative aspect-square overflow-hidden rounded-md bg-[#18181b]">{artwork ? <img src={artwork} alt={`${release.title} cover`} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" loading="lazy" /> : <div className="grid h-full place-items-center"><Disc3 className="h-12 w-12 text-zinc-700" /></div>}<span className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-black/80 text-white opacity-0 transition group-hover:opacity-100"><ArrowRight className="h-4 w-4" /></span></div><h3 className="mt-3 truncate font-bold group-hover:text-emerald-400">{release.title}</h3><p className="mt-1 truncate text-sm text-zinc-400">{release.artist_name}</p></Link><div className="mt-2 flex items-center justify-between gap-2"><span className="truncate text-xs text-zinc-600">{releaseTypeLabel(release.release_type)}</span><Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" disabled={!release.preview_asset_id} aria-label={`${playing ? 'Pause' : 'Preview'} ${release.title}`} onClick={() => preview.toggle(release)}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button></div></article>
}

function SectionHeading({title, small = false, icon}: {title: string; small?: boolean; icon?: React.ReactNode}) { return <div className="mb-5 flex items-center gap-3">{icon}<h2 className={small ? 'text-sm font-bold uppercase text-zinc-400' : 'text-xl font-black'}>{title}</h2><div className="h-px flex-1 bg-white/10" /></div> }
function releaseTypeLabel(type: StoreRelease['release_type']) { return type === 'ep' ? 'EP' : type.charAt(0).toUpperCase() + type.slice(1) }
function MusicLoading() { return <div className="mx-auto w-full max-w-7xl space-y-8 pb-32"><Skeleton className="h-20 w-full bg-white/5" /><div className="grid grid-cols-2 gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="aspect-square bg-white/5" />)}</div></div> }
function MusicError({message, retry}: {message: string; retry: () => void}) { return <div className="grid min-h-64 place-items-center text-center"><div><p className="font-bold text-red-300">Music discovery is unavailable</p><p className="mt-2 text-sm text-zinc-500">{message}</p><Button variant="outline" className="mt-5" onClick={retry}>Try again</Button></div></div> }
function EmptyMusic() { return <div className="grid min-h-72 place-items-center text-center"><div><Disc3 className="mx-auto h-10 w-10 text-zinc-700" /><h2 className="mt-4 text-lg font-bold">New music is on the way</h2><p className="mt-1 text-sm text-zinc-500">Published releases will appear here automatically.</p></div></div> }
