/**
 * Cleans up a quote as editors often paste it, e.g.
 *   Pull quote:
 *   “People wanna hear what's hot…”
 *   — John Blaze
 * The page adds its own quote marks and attribution line, so a typed label, typed quote marks and
 * a trailing "— Name" would otherwise show twice.
 */
export function tidyQuote(text: string, attribution: string | null | undefined): {text: string; attribution: string | null} {
  let lines = text.trim().replace(/^(pull\s*quote|quote)\s*:\s*/i, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  let by = attribution?.trim() || null
  const last = lines.at(-1)
  const trailing = last && lines.length > 1 ? /^[—–-]{1,2}\s*(.+)$/.exec(last) : null
  if (trailing) {
    lines = lines.slice(0, -1)
    by = by ?? trailing[1].trim()
  }
  let body = lines.join(' ')
  // A "— Name" at the end of a single line, matching the attribution.
  if (by) body = body.replace(new RegExp(`\\s*[—–-]{1,2}\\s*${by.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i'), '')
  body = body.replace(/^["“”'‘’]+|["“”'‘’]+$/g, '').trim()
  return {text: body, attribution: by}
}
