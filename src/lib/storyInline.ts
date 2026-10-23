/**
 * Inline formatting for story text: **bold**, *italic* and [text](https://link). The result is
 * a list of tokens the renderer turns into React elements; no HTML is ever produced, and links
 * that are not plain http(s) render as their text.
 */
export type InlineToken =
  | {type: 'text'; text: string}
  | {type: 'bold'; text: string}
  | {type: 'italic'; text: string}
  | {type: 'link'; text: string; href: string}

const PATTERN = /\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|\[([^\]\n]{1,200})\]\(([^)\s]{1,2000})\)/g

export function safeHttpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

export function parseInline(text: string): InlineToken[] {
  const tokens: InlineToken[] = []
  let last = 0
  for (const match of text.matchAll(PATTERN)) {
    if (match.index > last) tokens.push({type: 'text', text: text.slice(last, match.index)})
    if (match[1] !== undefined) tokens.push({type: 'bold', text: match[1]})
    else if (match[2] !== undefined) tokens.push({type: 'italic', text: match[2]})
    else {
      const href = safeHttpUrl(match[4])
      tokens.push(href ? {type: 'link', text: match[3], href} : {type: 'text', text: match[3]})
    }
    last = match.index + match[0].length
  }
  if (last < text.length) tokens.push({type: 'text', text: text.slice(last)})
  return tokens
}
