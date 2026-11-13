/**
 * Which stored file a buyer downloads for a track.
 *
 * Buyers get MeJay's tagged MP3 (title, artist, album, cover art) made from the track's current
 * master, so players and car stereos show the release properly. Until that MP3 exists (processing
 * still running or failed) the master itself is delivered, so a purchase is never left without a file.
 */

/**
 * A subquery returning the download file for the track referenced by `trackRef` (a SQL expression),
 * with columns id, storage_key, mime_type, byte_size, metadata. Use inside `JOIN LATERAL (...)`.
 */
export function downloadAssetSql(trackRef: string): string {
  return `SELECT pick.id, pick.storage_key, pick.mime_type, pick.byte_size, pick.metadata
    FROM (SELECT master.id FROM marketplace_assets master WHERE master.track_id = ${trackRef} AND master.kind = 'audio'
            AND master.processing_status = 'ready' ORDER BY master.created_at DESC LIMIT 1) latest
    JOIN marketplace_assets pick ON pick.processing_status = 'ready' AND (pick.id = latest.id
      OR (pick.kind = 'audio_delivery' AND pick.track_id = ${trackRef} AND pick.metadata->>'sourceAssetId' = latest.id))
    ORDER BY (pick.kind = 'audio_delivery') DESC, pick.created_at DESC LIMIT 1`
}

export function extensionForMime(mimeType: string): string {
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3'
  return mimeType.includes('flac') ? 'flac' : 'wav'
}

export function safeFileName(value: string, fallback: string): string {
  const cleaned = value.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').trim()
  return cleaned || fallback
}

/** The buyer-facing file name: the stored name, else "01 - Title.ext". */
export function downloadFileName(storedName: string | null | undefined, track: {track_number: number; title: string}, mimeType: string): string {
  const fallback = `${String(track.track_number).padStart(2, '0')} - ${track.title}.${extensionForMime(mimeType)}`
  return safeFileName(storedName ?? fallback, fallback)
}
