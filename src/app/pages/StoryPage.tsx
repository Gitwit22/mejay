import {useEffect, useRef, useState} from 'react'
import {useQuery} from '@tanstack/react-query'
import {Link, useParams} from 'react-router-dom'

import {StoriesTopBar} from '@/app/components/stories/StoriesTopBar'
import {ShareStory} from '@/app/components/stories/ShareStory'
import {StoryRenderer} from '@/app/components/stories/StoryRenderer'
import {Skeleton} from '@/components/ui/skeleton'
import {usePageMeta} from '@/hooks/usePageMeta'
import {getStory, recordStoryView, storyMediaUrl, StoryNotFoundError} from '@/lib/storiesApi'

export default function StoryPage() {
  const {slug = ''} = useParams()
  const story = useQuery({queryKey: ['stories', 'story', slug], queryFn: () => getStory(slug), enabled: Boolean(slug), retry: (count, error) => !(error instanceof StoryNotFoundError) && count < 2})
  const [views, setViews] = useState<number | null>(null)
  const counted = useRef<string | null>(null)
  // One view per opened article (the server also ignores repeat visits for 30 minutes).
  useEffect(() => {
    if (!story.data || counted.current === slug) return
    counted.current = slug
    void recordStoryView(slug).then((total) => { if (total !== null) setViews(total) }).catch(() => undefined)
  }, [story.data, slug])
  const data = story.data && views !== null ? {...story.data, viewCount: views} : story.data
  const image = data?.cover?.url ?? data?.background?.url ?? null
  usePageMeta(data ? {
    title: `${data.title} | MeJay Stories`,
    description: data.teaser,
    image: image ? new URL(storyMediaUrl(image), window.location.origin).toString() : null,
    url: `${window.location.origin}/stories/${data.slug}`,
    type: 'article',
  } : null)

  return <div className="min-h-screen bg-[#0a0a0b]">
    <StoriesTopBar />
    {story.isLoading ? <div className="mx-auto max-w-3xl space-y-5 px-4 py-14"><Skeleton className="h-6 w-32 bg-white/5" /><Skeleton className="h-16 w-full bg-white/5" /><Skeleton className="aspect-[16/9] w-full bg-white/5" /></div>
      : story.error instanceof StoryNotFoundError ? <Missing />
        : story.isError ? <div role="alert" className="grid min-h-[50vh] place-items-center px-4 text-center text-red-300"><div><p className="font-semibold">This story could not be loaded</p><p className="mt-2 text-sm text-red-300/70">{story.error.message}</p></div></div>
          : data ? <main><StoryRenderer story={data} share={<ShareStory story={data} />} /></main> : null}
  </div>
}

function Missing() {
  return <main className="grid min-h-[60vh] place-items-center px-4 text-center text-zinc-100">
    <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-emerald-400">Stories</p><h1 className="mt-3 text-3xl font-black">This story isn't available</h1><p className="mt-2 text-zinc-400">It may have been taken down, or the link is wrong.</p><Link to="/stories" className="mt-6 inline-block font-semibold text-emerald-400 hover:underline">See all stories</Link></div>
  </main>
}
