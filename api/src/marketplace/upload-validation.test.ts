import {describe, expect, it} from 'vitest'
import {inspectUpload, validateInspectedUpload, isTruncatedJpegHeader} from './upload-validation'

describe('marketplace upload inspection', () => {
  it('reads actual PNG dimensions and rejects declared-dimension spoofing', () => {
    const bytes = new Uint8Array(24)
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
    const view = new DataView(bytes.buffer)
    view.setUint32(16, 3000)
    view.setUint32(20, 3000)
    const inspected = inspectUpload(bytes)
    expect(inspected).toEqual({mimeType: 'image/png', width: 3000, height: 3000, hasAlpha: false})
    expect(validateInspectedUpload({declaredMimeType: 'image/png', kind: 'artwork', metadata: {width: 4000, height: 4000}, inspected})).toEqual(['artwork_dimensions_mismatch'])
  })

  it('recognizes lossless audio signatures and aliases', () => {
    expect(inspectUpload(new TextEncoder().encode('fLaC'))).toEqual({mimeType: 'audio/flac'})
    const wav = new Uint8Array(12); wav.set(new TextEncoder().encode('RIFF')); wav.set(new TextEncoder().encode('WAVE'), 8)
    expect(validateInspectedUpload({declaredMimeType: 'audio/x-wav', kind: 'audio', metadata: {}, inspected: inspectUpload(wav)})).toEqual([])
  })

  it('rejects unknown bytes and MIME spoofing', () => {
    expect(validateInspectedUpload({declaredMimeType: 'audio/flac', kind: 'audio', metadata: {}, inspected: null})).toEqual(['file_signature_invalid'])
    expect(validateInspectedUpload({declaredMimeType: 'audio/flac', kind: 'audio', metadata: {}, inspected: {mimeType: 'audio/wav'}})).toEqual(['file_type_mismatch'])
  })
})
describe('JPEG header discovery', () => {
  it('flags a JPEG whose frame header is beyond the inspected window', () => {
    // SOI, then an APP1 segment of 0x2000 bytes, then SOF0 with 3000x3000.
    const app1Length = 0x2000
    const full = new Uint8Array(2 + 2 + app1Length + 2 + 0x11)
    full.set([0xff, 0xd8, 0xff, 0xe1, app1Length >> 8, app1Length & 0xff], 0)
    const sof = 2 + 2 + app1Length
    full.set([0xff, 0xc0, 0x00, 0x11, 0x08, 0x0b, 0xb8, 0x0b, 0xb8, 0x03, 0x01], sof)
    const window = full.slice(0, 1024)
    expect(isTruncatedJpegHeader(window)).toBe(true)
    expect(isTruncatedJpegHeader(full)).toBe(false)
    expect(inspectUpload(full)).toEqual({mimeType: 'image/jpeg', width: 3000, height: 3000})
  })
})

describe('artist page imagery', () => {
  function png(width: number, height: number, colorType: number, extraChunk?: string): Uint8Array {
    const bytes = new Uint8Array(64)
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
    bytes.set([...'IHDR'].map((c) => c.charCodeAt(0)), 12)
    const view = new DataView(bytes.buffer)
    view.setUint32(16, width)
    view.setUint32(20, height)
    bytes[24] = 8
    bytes[25] = colorType
    if (extraChunk) bytes.set([...extraChunk].map((c) => c.charCodeAt(0)), 37)
    bytes.set([...'IDAT'].map((c) => c.charCodeAt(0)), 50)
    return bytes
  }

  function webpVp8x(width: number, height: number, alpha: boolean): Uint8Array {
    const bytes = new Uint8Array(30)
    bytes.set([...'RIFF'].map((c) => c.charCodeAt(0)), 0)
    bytes.set([...'WEBPVP8X'].map((c) => c.charCodeAt(0)), 8)
    bytes[20] = alpha ? 0x10 : 0
    const w = width - 1, h = height - 1
    bytes.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff], 24)
    bytes.set([h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 27)
    return bytes
  }

  const cutout = (inspected: ReturnType<typeof inspectUpload>, declaredMimeType: string, width = 900, height = 1600) =>
    validateInspectedUpload({declaredMimeType, kind: 'artist_cutout', metadata: {width, height}, inspected})

  it('detects transparency in PNG and WebP files', () => {
    expect(inspectUpload(png(900, 1600, 6))?.hasAlpha).toBe(true)
    expect(inspectUpload(png(900, 1600, 4))?.hasAlpha).toBe(true)
    expect(inspectUpload(png(900, 1600, 2))?.hasAlpha).toBe(false)
    expect(inspectUpload(png(900, 1600, 3, 'tRNS'))?.hasAlpha).toBe(true)
    expect(inspectUpload(png(900, 1600, 3))?.hasAlpha).toBe(false)
    expect(inspectUpload(webpVp8x(900, 1600, true))).toEqual({mimeType: 'image/webp', width: 900, height: 1600, hasAlpha: true})
    expect(inspectUpload(webpVp8x(900, 1600, false))?.hasAlpha).toBe(false)
  })

  it('accepts only transparent cutouts of at least 600x800', () => {
    expect(cutout(inspectUpload(png(900, 1600, 6)), 'image/png')).toEqual([])
    expect(cutout(inspectUpload(webpVp8x(900, 1600, true)), 'image/webp')).toEqual([])
    expect(cutout(inspectUpload(png(900, 1600, 2)), 'image/png')).toEqual(['cutout_transparency_required'])
    expect(cutout(inspectUpload(webpVp8x(900, 1600, false)), 'image/webp')).toEqual(['cutout_transparency_required'])
    expect(cutout(inspectUpload(png(500, 700, 6)), 'image/png', 500, 700)).toEqual(['image_dimensions_too_small'])
  })

  it('applies gallery size rules', () => {
    const ok = validateInspectedUpload({declaredMimeType: 'image/png', kind: 'artist_gallery', metadata: {width: 1200, height: 800}, inspected: inspectUpload(png(1200, 800, 2))})
    const small = validateInspectedUpload({declaredMimeType: 'image/png', kind: 'artist_gallery', metadata: {width: 700, height: 500}, inspected: inspectUpload(png(700, 500, 2))})
    expect(ok).toEqual([])
    expect(small).toEqual(['image_dimensions_too_small'])
  })
})
