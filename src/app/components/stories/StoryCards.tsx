import {Newspaper} from 'lucide-react'
import {Link} from 'react-router-dom'

import {storyMediaUrl, type StoryCard} from '@/lib/storiesApi'

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'}) : ''
}

function CardImage({story, className}: {story: StoryCard; className: string}) {
  return <div className={`overflow-hidden rounded-md bg-[#18181b] ${className}`}>
    {story.image
      ? <img src={storyMediaUrl(story.image.url)} alt={story.image.altText} loading="lazy" className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]" style={{objectPosition: `${story.image.focal.x}% ${story.image.focal.y}%`}} />
      : <div className="grid h-full place-items-center"><Newspaper className="h-10 w-10 text-zinc-700" /></div>}
  </div>
}

function Meta({story}: {story: StoryCard}) {
  return <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-400">{story.category || 'Stories'}<span className="ml-2 font-normal normal-case tracking-normal text-zinc-500">{formatDate(story.publishedAt)}</span></p>
}

/** The large lead story at the top of Discover. */
export function LeadStoryCard({story}: {story: StoryCard}) {
  return <Link to={`/stories/${story.slug}`} className="group grid gap-5 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 md:grid-cols-[1.3fr_1fr] md:items-center">
    <CardImage story={story} className="aspect-[16/10]" />
    <div>
      <Meta story={story} />
      <h3 className="mt-3 font-serif text-3xl font-black leading-tight group-hover:text-emerald-300 sm:text-4xl">{story.title}</h3>
      {story.teaser && <p className="mt-3 line-clamp-3 text-base text-zinc-400">{story.teaser}</p>}
      <span className="mt-4 inline-block text-sm font-semibold text-emerald-400">Read the story →</span>
    </div>
  </Link>
}

/** A story card. Compact cards sit beside the lead story: a small row on phones, a column above. */
export function StoryCardItem({story, compact = false}: {story: StoryCard; compact?: boolean}) {
  return <Link to={`/stories/${story.slug}`} className={`group min-w-0 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-400 ${compact ? 'grid grid-cols-[6.5rem_1fr] items-center gap-3 sm:block' : 'block'}`}>
    <CardImage story={story} className={compact ? 'aspect-[4/3] sm:aspect-[16/10]' : 'aspect-[4/3]'} />
    <div>
      <div className={compact ? 'sm:mt-3' : 'mt-3'}><Meta story={story} /></div>
      <h3 className={`mt-1.5 line-clamp-2 font-serif font-bold leading-snug group-hover:text-emerald-300 ${compact ? 'text-base sm:text-lg' : 'text-lg'}`}>{story.title}</h3>
      {!compact && story.teaser && <p className="mt-1 line-clamp-2 text-sm text-zinc-500">{story.teaser}</p>}
    </div>
  </Link>
}
