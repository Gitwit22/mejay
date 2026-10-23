import {useEffect, useMemo, useRef, useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {Disc3, Search, X} from 'lucide-react'
import {useSearchParams} from 'react-router-dom'

import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Skeleton} from '@/components/ui/skeleton'
import type {PreviewController} from '@/hooks/useStorePreview'
import {listStoreReleases} from '@/lib/musicStoreApi'
import {ProductCard, SectionTitle} from '@/app/pages/MusicStorePage'

export const BROWSE_PAGE_SIZE = 20

/**
 * Full LIVE catalog beneath Discover's curated rails, so releases that age out of the
 * capped discovery sections stay findable. The `artist` URL param is honored so legacy
 * `/app/store?artist=` links (redirected here) keep their filter.
 */
export function BrowseAllMusic({preview}: {preview: PreviewController}) {
  const catalog = useQuery({queryKey: ['music-store', 'catalog'], queryFn: listStoreReleases})
  const [searchParams, setSearchParams] = useSearchParams()
  const [search, setSearch] = useState('')
  const [genre, setGenre] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const sectionRef = useRef<HTMLElement | null>(null)
  const artistId = searchParams.get('artist')

  const releases = useMemo(() => catalog.data ?? [], [catalog.data])
  const genres = useMemo(() => [...new Set(releases.map((release) => release.genre).filter((value): value is string => Boolean(value)))].sort(), [releases])
  const selectedArtist = artistId ? releases.find((release) => release.artist_id === artistId)?.artist_name : null
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    return releases.filter((release) => {
      const terms = `${release.title} ${release.artist_name} ${release.genre || ''}`.toLowerCase()
      return terms.includes(term) && (!genre || release.genre === genre) && (!artistId || release.artist_id === artistId)
    })
  }, [releases, search, genre, artistId])

  const pageCount = Math.max(1, Math.ceil(filtered.length / BROWSE_PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(currentPage * BROWSE_PAGE_SIZE, (currentPage + 1) * BROWSE_PAGE_SIZE)

  useEffect(() => setPage(0), [search, genre, artistId])

  // An artist filter arriving from a link should land the user on the filtered results.
  useEffect(() => {
    if (artistId && catalog.isSuccess) sectionRef.current?.scrollIntoView?.({block: 'start'})
  }, [artistId, catalog.isSuccess])

  const clearArtist = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('artist')
    setSearchParams(next, {replace: true})
  }

  // Discover already shows its own empty state; don't repeat it when nothing is live.
  if (catalog.isSuccess && releases.length === 0) return null

  return <section ref={sectionRef}>
    <SectionTitle title="Browse All Music" />
    {catalog.isLoading ? <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="aspect-square bg-white/5" />)}</div>
      : catalog.isError ? <div className="py-10 text-center"><p className="font-bold text-red-300">The catalog is unavailable</p><p className="mt-2 text-sm text-zinc-500">{catalog.error.message}</p><Button variant="outline" className="mt-5" onClick={() => void catalog.refetch()}>Try again</Button></div>
        : <div className="space-y-6">
          <div className="relative max-w-2xl"><Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-zinc-500" /><Input value={search} onChange={(event) => setSearch(event.target.value)} className="h-12 border-white/10 bg-[#151517] pl-12 text-base" placeholder="Search releases, artists, and genres" aria-label="Search all music" /></div>
          {genres.length > 0 && <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by genre">{genres.map((item) => <Button key={item} size="sm" variant="outline" aria-pressed={genre === item} onClick={() => setGenre(genre === item ? null : item)} className={genre === item ? 'border-emerald-400 text-emerald-300' : 'border-white/10 bg-[#131315] hover:border-emerald-400/50'}>{item}</Button>)}</div>}
          {artistId && <div className="flex items-center gap-3 text-sm"><span className="text-zinc-500">Artist:</span><Button size="sm" variant="outline" className="gap-1.5" onClick={clearArtist}>{selectedArtist || 'Selected artist'}<X className="h-3.5 w-3.5" /></Button></div>}
          {visible.length === 0 ? <div className="grid min-h-48 place-items-center border-y border-dashed border-white/10 text-center"><div><Disc3 className="mx-auto h-10 w-10 text-zinc-700" /><p className="mt-4 font-bold">No music matches your filters</p></div></div>
            : <div className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{visible.map((release) => <ProductCard key={release.id} release={release} preview={preview} featured={false} />)}</div>}
          {pageCount > 1 && <nav className="flex items-center justify-center gap-3" aria-label="Catalog pages"><Button variant="outline" size="sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</Button><span className="text-sm text-zinc-500">Page {currentPage + 1} of {pageCount}</span><Button variant="outline" size="sm" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</Button></nav>}
        </div>}
  </section>
}
