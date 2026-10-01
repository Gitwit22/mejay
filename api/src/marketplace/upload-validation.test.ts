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
    expect(inspected).toEqual({mimeType: 'image/png', width: 3000, height: 3000})
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
