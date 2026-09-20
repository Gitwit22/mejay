export type InspectedUpload = {mimeType: string; width?: number; height?: number}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length))
}

function uint24le(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

export function inspectUpload(bytes: Uint8Array): InspectedUpload | null {
  if (bytes.length >= 24 && bytes.slice(0, 8).every((value, index) => value === [137, 80, 78, 71, 13, 10, 26, 10][index])) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    return {mimeType: 'image/png', width: view.getUint32(16), height: view.getUint32(20)}
  }
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === 'fLaC') return {mimeType: 'audio/flac'}
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return {mimeType: 'audio/wav'}
  if (bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    const chunk = ascii(bytes, 12, 4)
    if (chunk === 'VP8X') return {mimeType: 'image/webp', width: uint24le(bytes, 24) + 1, height: uint24le(bytes, 27) + 1}
    if (chunk === 'VP8L' && bytes[20] === 0x2f) {
      const packed = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24)
      return {mimeType: 'image/webp', width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1}
    }
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2
    while (offset + 8 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue }
      const marker = bytes[offset + 1]
      if (marker === 0xd9 || marker === 0xda) break
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3]
      if (length < 2 || offset + 2 + length > bytes.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return {
          mimeType: 'image/jpeg',
          height: (bytes[offset + 5] << 8) | bytes[offset + 6],
          width: (bytes[offset + 7] << 8) | bytes[offset + 8],
        }
      }
      offset += 2 + length
    }
  }
  return null
}

export function validateInspectedUpload(args: {
  declaredMimeType: string
  kind: 'artwork' | 'audio'
  metadata: {width?: number; height?: number}
  inspected: InspectedUpload | null
}): string[] {
  const {declaredMimeType, kind, metadata, inspected} = args
  if (!inspected) return ['file_signature_invalid']
  const aliases: Record<string, string> = {'audio/x-wav': 'audio/wav', 'audio/x-flac': 'audio/flac'}
  if ((aliases[declaredMimeType] ?? declaredMimeType) !== inspected.mimeType) return ['file_type_mismatch']
  if (kind === 'artwork') {
    if (!inspected.width || !inspected.height) return ['artwork_dimensions_missing']
    if (inspected.width !== inspected.height || inspected.width < 3000) return ['artwork_dimensions_invalid']
    if (metadata.width !== inspected.width || metadata.height !== inspected.height) return ['artwork_dimensions_mismatch']
  }
  return []
}