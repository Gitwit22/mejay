import {useEffect} from 'react'

type PageMeta = {title: string; description?: string | null; image?: string | null; url?: string; type?: 'article' | 'website'}

function setMeta(attribute: 'name' | 'property', key: string, value: string | null | undefined): () => void {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`)
  const created = !element
  const previous = element?.getAttribute('content') ?? null
  if (!value) return () => undefined
  if (!element) {
    element = document.createElement('meta')
    element.setAttribute(attribute, key)
    document.head.appendChild(element)
  }
  element.setAttribute('content', value)
  return () => {
    if (created) element?.remove()
    else if (previous !== null) element?.setAttribute('content', previous)
  }
}

/** Title, description and social-share tags for a page, restored when it unmounts. */
export function usePageMeta(meta: PageMeta | null): void {
  useEffect(() => {
    if (!meta) return
    const previousTitle = document.title
    document.title = meta.title
    const undo = [
      setMeta('name', 'description', meta.description),
      setMeta('property', 'og:title', meta.title),
      setMeta('property', 'og:description', meta.description),
      setMeta('property', 'og:image', meta.image),
      setMeta('property', 'og:url', meta.url),
      setMeta('property', 'og:type', meta.type ?? 'website'),
      setMeta('name', 'twitter:card', meta.image ? 'summary_large_image' : 'summary'),
      setMeta('name', 'twitter:title', meta.title),
      setMeta('name', 'twitter:description', meta.description),
      setMeta('name', 'twitter:image', meta.image),
    ]
    return () => {
      document.title = previousTitle
      undo.forEach((restore) => restore())
    }
  }, [meta?.title, meta?.description, meta?.image, meta?.url, meta?.type]) // eslint-disable-line react-hooks/exhaustive-deps
}
