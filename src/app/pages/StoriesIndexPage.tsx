import {useInfiniteQuery} from '@tanstack/react-query'

import {StoriesTopBar} from '@/app/components/stories/StoriesTopBar'
import {StoryCardItem} from '@/app/components/stories/StoryCards'
import {Button} from '@/components/ui/button'
import {Skeleton} from '@/components/ui/skeleton'
import {usePageMeta} from '@/hooks/usePageMeta'
import {listStories} from '@/lib/storiesApi'

const PAGE = 12

export default function StoriesIndexPage() {
  usePageMeta({title: 'Stories | MeJay', description: 'Stories about the artists and music on MeJay.', url: `${window.location.origin}/stories`})
  const stories = useInfiniteQuery({
    queryKey: ['stories', 'list'],
    queryFn: ({pageParam}) => listStories(pageParam, PAGE),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => {
      const loaded = pages.reduce((count, page) => count + page.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
  })
  const items = stories.data?.pages.flatMap((page) => page.items) ?? []
  return <div className="min-h-screen bg-[#0a0a0b] text-zinc-100">
    <StoriesTopBar />
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-8">
      <p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-400">MeJay</p>
      <h1 className="mt-2 text-4xl font-black">Stories</h1>
      {stories.isLoading ? <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{[0, 1, 2].map((key) => <Skeleton key={key} className="aspect-[4/3] bg-white/5" />)}</div>
        : stories.isError ? <p role="alert" className="mt-8 text-red-300">{stories.error.message}</p>
          : items.length === 0 ? <p className="mt-8 text-zinc-400">No stories yet. Check back soon.</p>
            : <div className="mt-8 grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">{items.map((story) => <StoryCardItem key={story.slug} story={story} />)}</div>}
      {stories.hasNextPage && <div className="mt-10 text-center"><Button variant="outline" disabled={stories.isFetchingNextPage} onClick={() => void stories.fetchNextPage()}>{stories.isFetchingNextPage ? 'Loading…' : 'Load more stories'}</Button></div>}
    </main>
  </div>
}
