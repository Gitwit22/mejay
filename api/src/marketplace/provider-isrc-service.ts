import {escapeCsvCell} from './admin-service'
import {formatIsrc} from './isrc'
import {providerContext, type Database} from './service'

export type ProviderIsrcRow = {
  id: string
  isrc: string
  track_title: string | null
  artist_name: string | null
  release_id: string | null
  release_title: string | null
  /** MEJAY_ASSIGNED: issued by MeJay under QT-A3L. EXTERNAL: a code the artist already owned. */
  assignment_type: 'MEJAY_ASSIGNED' | 'EXTERNAL' | null
  status: 'RESERVED' | 'ASSIGNED' | 'REGISTERED' | 'VOIDED' | null
  assigned_at: string | null
}

/**
 * The artist account's own view of the ISRC registry: every code recorded against its tracks,
 * MeJay-issued or brought from elsewhere. Read-only; issuing codes stays in the approval flow.
 */
export class ProviderIsrcService {
  constructor(private readonly database: Database) {}

  async list(userId: string): Promise<ProviderIsrcRow[]> {
    const context = await providerContext(this.database, userId, false)
    const {results} = await this.database.prepare(
      `SELECT registry.id, registry.isrc,
        COALESCE(registry.track_title, track.title) AS track_title,
        COALESCE(registry.artist_name, artist.name) AS artist_name,
        release.id AS release_id, release.title AS release_title,
        registry.assignment_type, registry.status, registry.assigned_at
       FROM isrc_registry registry
       LEFT JOIN tracks track ON track.id = registry.track_id
       LEFT JOIN releases release ON release.id = track.release_id AND release.provider_profile_id = registry.provider_profile_id
       LEFT JOIN artists artist ON artist.id = registry.artist_id
       WHERE registry.provider_profile_id = ?1
       ORDER BY registry.assigned_at DESC NULLS LAST, registry.isrc`,
    ).bind(context.providerId).all<ProviderIsrcRow>()
    return results.map((row) => ({...row, isrc: formatIsrc(row.isrc)}))
  }

  async exportCsv(userId: string): Promise<{data: string; fileName: string}> {
    const rows = await this.list(userId)
    const lines = [
      ['ISRC', 'Track', 'Artist', 'Release', 'Source', 'Status', 'Assigned'].join(','),
      ...rows.map((row) => [
        row.isrc,
        row.track_title,
        row.artist_name,
        row.release_title,
        row.assignment_type === 'MEJAY_ASSIGNED' ? 'Issued by MeJay' : row.assignment_type === 'EXTERNAL' ? 'Your existing code' : '',
        row.status,
        row.assigned_at ? new Date(row.assigned_at).toISOString() : '',
      ].map(escapeCsvCell).join(',')),
    ]
    return {data: `${lines.join('\n')}\n`, fileName: `mejay-isrcs-${new Date().toISOString().slice(0, 10)}.csv`}
  }
}
