import type {StoryView} from './storiesApi'

/** The clean public link for a story and a short, human line to go with it. */
export function shareDetails(story: Pick<StoryView, 'slug' | 'title' | 'teaser'>, origin = window.location.origin) {
  const url = `${origin}/stories/${story.slug}`
  const text = `“${story.title}” on MeJay`
  return {url, text, title: story.title, summary: story.teaser ? `${text}: ${story.teaser}` : text}
}
