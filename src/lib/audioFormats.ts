/**
 * Single source of truth for importable audio. Undecodable files are still caught at import
 * (decode failure marks the track 'error'), so this list errs on the side of letting files in.
 */
export const SUPPORTED_AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'wav', 'mp4', 'flac', 'ogg', 'oga', 'opus'] as const

/** Value for <input type="file" accept>. */
export const AUDIO_FILE_ACCEPT = ['audio/*', 'application/octet-stream', ...SUPPORTED_AUDIO_EXTENSIONS.map((ext) => `.${ext}`)].join(',')

export const SUPPORTED_FORMATS_LABEL = '.mp3, .m4a, .aac, .wav, .flac, .ogg or .opus'

const extensions = new Set<string>(SUPPORTED_AUDIO_EXTENSIONS)

function extensionOf(name: string): string {
  const lower = name.toLowerCase()
  return lower.includes('.') ? lower.split('.').pop() ?? '' : ''
}

export function isSupportedAudioFile(file: Pick<File, 'name' | 'type'>): boolean {
  const mime = (file.type || '').toLowerCase().trim()
  const hasSupportedExt = extensions.has(extensionOf(file.name || ''))

  // Prefer the extension: iOS often reports an empty MIME type, mail attachments arrive as
  // application/octet-stream, and some providers label audio as video/*.
  if (hasSupportedExt) {
    return !mime || mime === 'application/octet-stream' || mime.startsWith('audio/') || mime.startsWith('video/')
  }
  if (!mime) return false
  return mime.startsWith('audio/') || mime === 'application/octet-stream'
}
