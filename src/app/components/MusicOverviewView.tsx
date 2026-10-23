import {useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {ArrowRight, Disc3, Library, Pause, Play, Sparkles} from 'lucide-react'
import {Link} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Skeleton} from '@/components/ui/skeleton'
import {usePreview, type PreviewController} from '@/hooks/useStorePreview'
import {getMusicDiscovery, type DiscoveryArtist} from '@/lib/musicDiscoveryApi'
import {storeAssetUrl, type StoreRelease} from '@/lib/musicStoreApi'
import {getStoriesHome, type StoryCard} from '@/lib/storiesApi'
import {LeadStoryCard, StoryCardItem} from '@/app/components/stories/StoryCards'
import {BrowseAllMusic} from './BrowseAllMusic'

export function MusicOverviewView() {
  const discovery = useQuery({queryKey: ['music', 'discovery'], queryFn: getMusicDiscovery})
  // Stories load separately: if they fail, Discover simply stays music-only.
  const stories = useQuery({queryKey: ['stories', 'home'], queryFn: getStoriesHome, retry: 1})
  const preview = usePreview()

  if (discovery.isLoading) return <MusicLoading />
  if (discovery.isError) return <MusicError message={discovery.error.message} retry={() => void discovery.refetch()} />
  if (!discovery.data) return null

  const data = discovery.data
  const empty = Object.values(data).every((items) => items.length === 0)
  const lead = stories.data?.featured ?? null
  const latest = stories.data?.latest ?? []

  return <div className="mx-auto h-full w-full max-w-7xl overflow-y-auto pb-32 text-zinc-100">
    <header className="flex items-end justify-between gap-4 border-b border-white/10 pb-6">
      <div><p className="text-xs font-semibold uppercase text-emerald-400">Discover</p><h1 className="mt-1 text-3xl font-black tracking-normal sm:text-4xl">MEJAY MUSIC</h1><p className="mt-2 text-sm text-zinc-500">What is new and moving across MEJay.</p></div>
      <Button asChild variant="outline" className="shrink-0 gap-2 border-white/10 bg-black/20"><Link to="/app/purchased" aria-label="Purchased Music"><Library className="h-4 w-4" /><span className="hidden sm:inline">Purchased Music</span></Link></Button>
    </header>

    {lead && <FeaturedStories lead={lead} more={latest.slice(0, 3)} />}

    {empty ? <EmptyMusic /> : <div className="space-y-12 py-8">
      <NewReleases all={data.newestReleases} singles={data.newestSingles} projects={data.newestProjects} preview={preview} />
      <ReleaseRail title="Admin Picks" releases={data.featuredReleases} preview={preview} icon={<Sparkles className="h-4 w-4 text-emerald-400" />} />
      {(data.mostPurchased.length > 0 || data.mostPreviewed.length > 0) && <section>
        <SectionHeading title="Trending on MEJay" />
        <div className="space-y-8">
          <ReleaseRail title="Most Purchased" releases={data.mostPurchased} preview={preview} nested />
          <ReleaseRail title="Most Previewed" releases={data.mostPreviewed} preview={preview} nested />
        </div>
      </section>}
      {data.featuredArtists.length > 0 && <section><SectionHeading title="Featured Artists" /><div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">{data.featuredArtists.map((artist) => {
        const artwork = storeAssetUrl(artist.artwork_asset_id)
        return <Link key={artist.id} to={artistHref(artist)} className="group min-w-0"><div className="aspect-square overflow-hidden rounded-full bg-[#18181b]">{artwork ? <img src={artwork} alt="" className="h-full w-full object-cover transition duration-300 group-hover:scale-105" loading="lazy" /> : <div className="grid h-full place-items-center"><Disc3 className="h-10 w-10 text-zinc-700" /></div>}</div><p className="mt-3 truncate text-center font-bold group-hover:text-emerald-400">{artist.name}</p><p className="mt-1 text-center text-xs text-zinc-600">{artist.release_count} {artist.release_count === 1 ? 'release' : 'releases'}</p></Link>
      })}</div></section>}
    </div>}
    {latest.length > 3 && <MoreStories stories={latest.slice(3)} />}
    <div id="browse-all-music" className="scroll-mt-4 pb-8"><BrowseAllMusic preview={preview} /></div>
  </div>
}

/** One lead story with a few recent ones beside it. Hidden entirely when nothing is published. */
function FeaturedStories({lead, more}: {lead: StoryCard; more: StoryCard[]}) {
  return <section aria-labelledby="discover-stories" className="border-b border-white/10 py-8">
    <h2 id="discover-stories" className="sr-only">Featured stories</h2>
    <LeadStoryCard story={lead} />
    {more.length > 0 && <div className="mt-6 grid gap-4 sm:mt-8 sm:grid-cols-3 sm:gap-6">{more.map((story) => <StoryCardItem key={story.slug} story={story} compact />)}</div>}
  </section>
}

function MoreStories({stories}: {stories: StoryCard[]}) {
  return <section className="pb-12">
    <div className="mb-5 flex items-center gap-3"><h2 className="text-xl font-black">More Stories</h2><div className="h-px flex-1 bg-white/10" /><Link to="/stories" className="text-sm font-semibold text-emerald-400 hover:underline">All stories</Link></div>
    <div className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">{stories.map((story) => <StoryCardItem key={story.slug} story={story} />)}</div>
  </section>
}

type NewFilter = 'all' | 'singles' | 'projects'

/** The newest LIVE releases (one section, filterable), replacing the old three "new" rails. */
function NewReleases({all, singles, projects, preview}: {all: StoreRelease[]; singles: StoreRelease[]; projects: StoreRelease[]; preview: PreviewController}) {
  const [filter, setFilter] = useState<NewFilter>('all')
  if (all.length === 0) return null
  const lists: Record<NewFilter, StoreRelease[]> = {all, singles, projects}
  const tabs = ([['all', 'All'], ['singles', 'Singles'], ['projects', 'Projects']] as const).filter(([key]) => key === 'all' || lists[key].length > 0)
  const shown = lists[filter].slice(0, 8)
  return <section aria-labelledby="discover-new-releases">
    <div className="mb-5 flex flex-wrap items-center gap-3">
      <h2 id="discover-new-releases" className="text-xl font-black">New Releases</h2>
      <div className="h-px flex-1 bg-white/10" />
      {/* The full searchable catalog lives further down this page. */}
      <button type="button" onClick={() => document.getElementById('browse-all-music')?.scrollIntoView({behavior: 'smooth'})} className="text-sm font-semibold text-emerald-400 hover:underline">View all music</button>
    </div>
    {tabs.length > 1 && <div role="tablist" aria-label="New release type" className="mb-5 inline-flex rounded-md border border-white/10 p-0.5 text-sm">
      {tabs.map(([key, label]) => <button key={key} type="button" role="tab" aria-selected={filter === key} onClick={() => setFilter(key)}
        className={`rounded px-3 py-1.5 font-medium transition ${filter === key ? 'bg-emerald-400 text-zinc-950' : 'text-zinc-400 hover:text-zinc-100'}`}>{label}</button>)}
    </div>}
    <div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4">{shown.map((release) => <ReleaseCard key={release.id} release={release} preview={preview} />)}</div>
  </section>
}

// Older API responses omit the slug; fall back to the catalog's artist filter.
function artistHref(artist: DiscoveryArtist): string {
  return artist.slug ? `/artist/${encodeURIComponent(artist.slug)}` : `/app?tab=music&artist=${encodeURIComponent(artist.id)}`
}

function ReleaseRail({title, releases, preview, nested = false, icon}: {title: string; releases: StoreRelease[]; preview: PreviewController; nested?: boolean; icon?: React.ReactNode}) {
  if (releases.length === 0) return null
  return <section><SectionHeading title={title} small={nested} icon={icon} /><div className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{releases.map((release) => <ReleaseCard key={release.id} release={release} preview={preview} />)}</div></section>
}

function ReleaseCard({release, preview}: {release: StoreRelease; preview: PreviewController}) {
  const artwork = storeAssetUrl(release.artwork_asset_id)
  const playing = preview.playingId === release.id
  return <article className="group min-w-0"><Link to={`/app/store/${release.id}`} className="block"><div className="relative aspect-square overflow-hidden rounded-md bg-[#18181b]">{artwork ? <img src={artwork} alt={`${release.title} cover`} className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" loading="lazy" /> : <div className="grid h-full place-items-center"><Disc3 className="h-12 w-12 text-zinc-700" /></div>}<span className="absolute bottom-2 right-2 grid h-9 w-9 place-items-center rounded-full bg-black/80 text-white opacity-0 transition group-hover:opacity-100"><ArrowRight className="h-4 w-4" /></span></div><h3 className="mt-3 truncate font-bold group-hover:text-emerald-400">{release.title}</h3><p className="mt-1 truncate text-sm text-zinc-400">{release.artist_name}</p></Link><div className="mt-2 flex items-center justify-between gap-2"><span className="truncate text-xs text-zinc-600">{releaseTypeLabel(release.release_type)} · {formatPrice(release.amount_minor, release.currency)}</span><Button type="button" size="icon" variant="ghost" className="h-8 w-8 shrink-0" disabled={!release.preview_asset_id} aria-label={`${playing ? 'Pause' : 'Preview'} ${release.title}`} onClick={() => preview.toggle(release.id, release.preview_asset_id)}>{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button></div></article>
}

function SectionHeading({title, small = false, icon}: {title: string; small?: boolean; icon?: React.ReactNode}) { return <div className="mb-5 flex items-center gap-3">{icon}<h2 className={small ? 'text-sm font-bold uppercase text-zinc-400' : 'text-xl font-black'}>{title}</h2><div className="h-px flex-1 bg-white/10" /></div> }
function formatPrice(amount: number, currency: string) { return new Intl.NumberFormat('en-US', {style: 'currency', currency: currency || 'USD'}).format(Number(amount) / 100) }
function releaseTypeLabel(type: StoreRelease['release_type']) { return type === 'ep' ? 'EP' : type.charAt(0).toUpperCase() + type.slice(1) }
function MusicLoading() { return <div className="mx-auto w-full max-w-7xl space-y-8 pb-32"><Skeleton className="h-20 w-full bg-white/5" /><div className="grid grid-cols-2 gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="aspect-square bg-white/5" />)}</div></div> }
function MusicError({message, retry}: {message: string; retry: () => void}) { return <div className="grid min-h-64 place-items-center text-center"><div><p className="font-bold text-red-300">Music discovery is unavailable</p><p className="mt-2 text-sm text-zinc-500">{message}</p><Button variant="outline" className="mt-5" onClick={retry}>Try again</Button></div></div> }
function EmptyMusic() { return <div className="grid min-h-72 place-items-center text-center"><div><Disc3 className="mx-auto h-10 w-10 text-zinc-700" /><h2 className="mt-4 text-lg font-bold">New music is on the way</h2><p className="mt-1 text-sm text-zinc-500">Published releases will appear here automatically.</p></div></div> }
