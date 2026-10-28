import {enqueueAudioJob} from '../audio/jobs'
import {LEGACY_PREVIEW_LENGTH_MS} from '../audio/transcode'
import {PREVIEW_MATCHES_SETTING_SQL} from './service'

type Statement = {
  bind: (...values: unknown[]) => Statement
  first: <T = Record<string, unknown>>() => Promise<T | null>
  all: <T = Record<string, unknown>>() => Promise<{results: T[]}>
  run: () => Promise<unknown>
}

type Database = {prepare: (sql: string) => Statement}

export type ConverterEnv = {CONVERTER_URL?: string; CONVERTER_TRIGGER_SECRET?: string}

/**
 * Keeps every track's store preview current. Queues a conversion for each track whose latest ready
 * upload has no clip for the track's current preview start and length, unless one is already
 * queued or running, or the same file already failed for that same setting (a broken file is not
 * retried forever). Idempotent: repeated runs queue nothing new.
 */
export async function ensurePreviewJobs(db: Database, limit = 25): Promise<{queued: number}> {
  const {results} = await db.prepare(
    `SELECT source.id AS source_asset_id
     FROM tracks t
     JOIN LATERAL (
       SELECT asset.id FROM marketplace_assets asset
       WHERE asset.track_id = t.id AND asset.kind = 'audio' AND asset.processing_status = 'ready'
       ORDER BY asset.created_at DESC LIMIT 1
     ) source ON TRUE
     WHERE NOT EXISTS (
         SELECT 1 FROM marketplace_assets clip WHERE clip.track_id = t.id AND clip.kind = 'audio_preview'
           AND clip.processing_status = 'ready' AND ${PREVIEW_MATCHES_SETTING_SQL('clip', 't')})
       AND NOT EXISTS (
         SELECT 1 FROM audio_processing_jobs job WHERE job.source_asset_id = source.id AND (
           job.status IN ('queued', 'processing')
           OR (job.status = 'failed' AND job.preview_start_ms IS NOT DISTINCT FROM t.preview_start_ms
             AND COALESCE(job.preview_length_ms, ${LEGACY_PREVIEW_LENGTH_MS}) = t.preview_length_ms)))
     ORDER BY t.updated_at DESC
     LIMIT ?1`,
  ).bind(limit).all<{source_asset_id: string}>()
  let queued = 0
  for (const row of results) {
    try {
      await enqueueAudioJob(db as never, row.source_asset_id)
      queued += 1
    } catch (error) {
      // A finished-while-queuing race or a deleted upload; the next run sees the new state.
      console.warn('[preview-jobs] could not queue a preview', {sourceAssetId: row.source_asset_id, error: error instanceof Error ? error.message : 'unknown'})
    }
  }
  return {queued}
}

/**
 * Wakes the converter (a free instance sleeps when idle) when conversions are waiting. Returns
 * whether a wake-up was sent. Never throws; a missed wake-up is retried on the next cycle.
 */
export async function wakeConverterIfQueued(db: Database, env: ConverterEnv, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const url = (env.CONVERTER_URL ?? '').trim().replace(/\/+$/, '')
  const secret = (env.CONVERTER_TRIGGER_SECRET ?? '').trim()
  if (!url || !secret) return false
  const waiting = await db.prepare(
    `SELECT 1 FROM audio_processing_jobs WHERE status = 'queued' AND run_after <= CURRENT_TIMESTAMP LIMIT 1`,
  ).first()
  if (!waiting) return false
  try {
    const response = await fetchImpl(`${url}/jobs/run`, {
      method: 'POST',
      headers: {authorization: `Bearer ${secret}`},
      // A sleeping free instance can take about a minute to boot; the request still wakes it.
      signal: AbortSignal.timeout(15_000),
    })
    if (!response.ok) console.warn('[preview-jobs] converter wake-up returned', response.status)
    return response.ok
  } catch {
    console.warn('[preview-jobs] converter wake-up timed out or failed; it will be retried')
    return false
  }
}
