import {describe, expect, it} from 'vitest'

import {contentBlockSchema, safeHttpUrl, slugify, updateStorySchema} from './schemas'

const base = {expectedVersion: 1, template: 'headliner', title: 'A story', slug: 'a-story'}

describe('editorial content validation', () => {
  it('accepts only http(s) links, inline or as the source', () => {
    expect(safeHttpUrl('https://mejay.app/x')).toBe('https://mejay.app/x')
    for (const bad of ['javascript:alert(1)', 'data:text/html,hi', 'mailto:a@b.c', '/relative', 'not a url']) expect(safeHttpUrl(bad)).toBeNull()
    expect(contentBlockSchema.safeParse({type: 'paragraph', text: 'Read [this](https://example.com).'}).success).toBe(true)
    expect(contentBlockSchema.safeParse({type: 'paragraph', text: 'Click [here](javascript:alert(1))'}).success).toBe(false)
    expect(contentBlockSchema.safeParse({type: 'list', items: ['[x](data:text/html,1)']}).success).toBe(false)
    expect(updateStorySchema.safeParse({...base, sourceUrl: 'javascript:alert(1)'}).success).toBe(false)
    expect(updateStorySchema.safeParse({...base, sourceUrl: 'https://news.example/story'}).success).toBe(true)
  })

  it('refuses unknown block types, extra fields and oversized content', () => {
    expect(contentBlockSchema.safeParse({type: 'html', html: '<script>1</script>'}).success).toBe(false)
    expect(contentBlockSchema.safeParse({type: 'paragraph', text: 'x', html: '<b>'}).success).toBe(false)
    expect(contentBlockSchema.safeParse({type: 'paragraph', text: 'x'.repeat(5001)}).success).toBe(false)
    expect(updateStorySchema.safeParse({...base, content: Array.from({length: 201}, () => ({type: 'paragraph', text: 'x'}))}).success).toBe(false)
  })

  it('keeps appearance inside the allowed palette and overlay range', () => {
    expect(updateStorySchema.safeParse({...base, appearance: {palette: 'hot-pink'}}).success).toBe(false)
    expect(updateStorySchema.safeParse({...base, appearance: {overlay: 95}}).success).toBe(false)
    expect(updateStorySchema.parse(base).appearance).toEqual({palette: 'ink', overlay: 55, coverFocal: {x: 50, y: 50}})
  })

  it('makes readable slugs and validates edited ones', () => {
    expect(slugify('Détroit Has Something  to Say!')).toBe('detroit-has-something-to-say')
    expect(slugify('***')).toBe('story')
    expect(updateStorySchema.safeParse({...base, slug: 'Bad Slug'}).success).toBe(false)
    expect(updateStorySchema.safeParse({...base, slug: 'double--dash'}).success).toBe(false)
  })
})
