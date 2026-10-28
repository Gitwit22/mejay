import {createHash, randomUUID} from 'node:crypto'
import {createReadStream, createWriteStream} from 'node:fs'
import {mkdtemp, rm, stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {pipeline} from 'node:stream/promises'
import type {ReadableStream as WebReadableStream} from 'node:stream/web'

import type {Database} from '../marketplace/service'
import {MARKETPLACE_STORAGE_PREFIX} from '../marketplace/storage-keys'
import type {PrivateBucket} from '../services/r2'
import {runFfmpeg, summarizeToolError} from './ffmpeg'
import {loadTrackTagData} from './metadata'
import {probeAudio} from './probe'
import {coverArgs, deliveryArgs, LEGACY_PREVIEW_LENGTH_MS, previewArgs, previewWindow} from './transcode'
import {verifyMp3} from './verify'

export type AudioJobStatus = 'queued' | 'processing' | 'succeeded' | 'failed'

export type AudioJob = {
  id: string
  provider_profile_id: string
  track_id: string
  source_asset_id: string
  status: AudioJobStatus
  attempts: number
  max_attempts: number
  last_error: string | null
  /** The artist's preview start when queued; null = automatic. */
  preview_start_ms?: number | null
  /** The artist's preview length when queued; null on jobs queued before artists could choose (10 s). */
  preview_length_ms?: number | null
  outputs: Record<string, unknown>
  created_at: string
  updated_at: string
}

export type AudioJobBucket = Pick<PrivateBucket, 'getExact' | 'putFile'>

export type AudioJobDeps = {
  db: Database
  bucket: AudioJobBucket
  /** Lease length; a run that stops renewing (crash, spin-down) becomes claimable again after this. */
  leaseMs?: number
  heartbeatMs?: number
  tmpRoot?: string
  log?: (message: string, details?: Record<string, unknown>) => void
}

const DEFAULT_LEASE_MS = 10 * 60_000
const DEFAULT_HEARTBEAT_MS = 60_000

export class AudioJobError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

/** Thrown when another run took over this job (our lease expired); we stop without touching it. */
export class LeaseLostError extends Error {}

/** Output keys are deterministic per job, so a retry overwrites instead of leaving orphans. */
export function outputKey(job: Pick<AudioJob, 'id' | 'provider_profile_id' | 'track_id'>, kind: 'audio_delivery' | 'audio_preview'): string {
  return `${MARKETPLACE_STORAGE_PREFIX}${job.provider_profile_id}/${kind}/${job.track_id}/${job.id}.mp3`
}

/** "Artist - Title.mp3" without characters that break filenames or headers. */
export function deliveryFileName(artist: string, title: string, suffix = ''): string {
  const clean = (value: string) => value.replace(/[\\/:*?"<>|\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  return `${clean(artist) || 'Unknown Artist'} - ${clean(title) || 'Untitled'}${suffix}.mp3`.slice(0, 200)
}

/** Queues a conversion for a ready audio upload. Idempotent: returns the active job if one exists. */
export async function enqueueAudioJob(db: Database, sourceAssetId: string): Promise<AudioJob> {
  const source = await db.prepare(
    `SELECT id, provider_profile_id, track_id FROM marketplace_assets
     WHERE id = ?1 AND kind = 'audio' AND processing_status = 'ready' AND track_id IS NOT NULL`,
  ).bind(sourceAssetId).first<{id: string; provider_profile_id: string; track_id: string}>()
  if (!source) throw new AudioJobError(404, 'source_not_found', 'No ready audio upload with that id')
  // The job keeps the preview start and length chosen at queue time; a later change queues a fresh job.
  await db.prepare(
    `INSERT INTO audio_processing_jobs (id, provider_profile_id, track_id, source_asset_id, preview_start_ms, preview_length_ms)
     SELECT ?1, ?2, ?3, ?4, track.preview_start_ms, track.preview_length_ms FROM tracks track WHERE track.id = ?3
     ON CONFLICT (source_asset_id) WHERE status IN ('queued', 'processing') DO NOTHING`,
  ).bind(randomUUID(), source.provider_profile_id, source.track_id, source.id).run()
  const job = await db.prepare(
    `SELECT * FROM audio_processing_jobs WHERE source_asset_id = ?1 AND status IN ('queued', 'processing')
     ORDER BY created_at DESC LIMIT 1`,
  ).bind(source.id).first<AudioJob>()
  if (!job) throw new AudioJobError(409, 'enqueue_conflict', 'The job finished while it was being queued; enqueue again to reprocess')
  return job
}

export async function getAudioJob(db: Database, jobId: string): Promise<AudioJob | null> {
  return db.prepare('SELECT * FROM audio_processing_jobs WHERE id = ?1').bind(jobId).first<AudioJob>()
}

/**
 * Claims the next runnable job, or a job whose run was interrupted (lease expired). One SQL statement
 * with SKIP LOCKED, so two runners can never claim the same job. Jobs interrupted on their last
 * attempt are closed as failed first, so they cannot sit in "processing" forever.
 */
export async function claimNextAudioJob(db: Database, leaseMs = DEFAULT_LEASE_MS): Promise<AudioJob | null> {
  await db.prepare(
    `UPDATE audio_processing_jobs SET status = 'failed', lease_expires_at = NULL, finished_at = CURRENT_TIMESTAMP,
       last_error = COALESCE(last_error, 'Processing was interrupted on the final attempt'), updated_at = CURRENT_TIMESTAMP
     WHERE status = 'processing' AND lease_expires_at < CURRENT_TIMESTAMP AND attempts >= max_attempts`,
  ).run()
  return db.prepare(
    `UPDATE audio_processing_jobs
     SET status = 'processing', attempts = attempts + 1,
       lease_expires_at = CURRENT_TIMESTAMP + make_interval(secs => ?1::double precision),
       started_at = COALESCE(started_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
     WHERE id = (
       SELECT id FROM audio_processing_jobs
       WHERE attempts < max_attempts AND (
         (status = 'queued' AND run_after <= CURRENT_TIMESTAMP)
         OR (status = 'processing' AND lease_expires_at < CURRENT_TIMESTAMP)
       )
       ORDER BY run_after, created_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING *`,
  ).bind(leaseMs / 1000).first<AudioJob>()
}

/** Extends our lease. The attempt number is the ownership token: a takeover bumps it. */
async function renewLease(db: Database, job: AudioJob, leaseMs: number): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE audio_processing_jobs SET lease_expires_at = CURRENT_TIMESTAMP + make_interval(secs => ?3::double precision), updated_at = CURRENT_TIMESTAMP
     WHERE id = ?1 AND status = 'processing' AND attempts = ?2`,
  ).bind(job.id, job.attempts, leaseMs / 1000).run() as {meta?: {changes?: number}}
  return (result.meta?.changes ?? 0) > 0
}

async function failOrRetry(db: Database, job: AudioJob, message: string): Promise<'queued' | 'failed'> {
  const final = job.attempts >= job.max_attempts
  // Back off 1, 2, 4... minutes between attempts.
  const backoffSeconds = 60 * 2 ** Math.max(0, job.attempts - 1)
  await db.prepare(
    `UPDATE audio_processing_jobs SET status = ?3, last_error = ?4, lease_expires_at = NULL,
       run_after = CASE WHEN ?3 = 'queued' THEN CURRENT_TIMESTAMP + make_interval(secs => ?5::double precision) ELSE run_after END,
       finished_at = CASE WHEN ?3 = 'failed' THEN CURRENT_TIMESTAMP ELSE NULL END, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?1 AND status = 'processing' AND attempts = ?2`,
  ).bind(job.id, job.attempts, final ? 'failed' : 'queued', message.slice(0, 1000), backoffSeconds).run()
  return final ? 'failed' : 'queued'
}

async function downloadTo(bucket: AudioJobBucket, key: string, filePath: string): Promise<void> {
  const object = await bucket.getExact(key)
  if (!object) throw new Error(`Stored file is missing: ${key.split('/').slice(-2).join('/')}`)
  await pipeline(Readable.fromWeb(object.body as unknown as WebReadableStream), createWriteStream(filePath))
}

async function fileDigest(filePath: string): Promise<{sha256: string; byteSize: number}> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(filePath), hash)
  return {sha256: hash.digest('hex'), byteSize: (await stat(filePath)).size}
}

type StoredOutput = {key: string; sha256: string; byteSize: number; durationMs: number; bitRate: number | null; fileName: string}

/**
 * Uploads a finished file, then downloads it back from storage and compares checksum and size, so
 * "succeeded" means the exact bytes a buyer would receive are in the bucket.
 */
async function storeVerified(bucket: AudioJobBucket, localPath: string, key: string, workDir: string): Promise<{sha256: string; byteSize: number}> {
  const local = await fileDigest(localPath)
  await bucket.putFile(key, localPath, 'audio/mpeg')
  const roundTrip = join(workDir, `verify-${randomUUID()}.mp3`)
  await downloadTo(bucket, key, roundTrip)
  const remote = await fileDigest(roundTrip)
  if (remote.sha256 !== local.sha256 || remote.byteSize !== local.byteSize) {
    throw new Error('Stored file does not match what was uploaded')
  }
  return local
}

async function upsertDerivedAsset(db: Database, job: AudioJob, kind: 'audio_delivery' | 'audio_preview', output: StoredOutput, extra: Record<string, unknown> = {}): Promise<string> {
  const row = await db.prepare(
    `INSERT INTO marketplace_assets (id, provider_profile_id, track_id, kind, storage_key, mime_type, byte_size, sha256, processing_status, metadata)
     VALUES (?1, ?2, ?3, ?4, ?5, 'audio/mpeg', ?6, ?7, 'ready', ?8::jsonb)
     ON CONFLICT (storage_key) DO UPDATE SET byte_size = EXCLUDED.byte_size, sha256 = EXCLUDED.sha256,
       processing_status = 'ready', metadata = EXCLUDED.metadata
     RETURNING id`,
  ).bind(
    randomUUID(), job.provider_profile_id, job.track_id, kind, output.key, output.byteSize, output.sha256,
    // previewSetting is the artist's start choice (null = automatic) and previewLengthMs their length; the store's freshness check compares against both.
    JSON.stringify({fileName: output.fileName, sourceAssetId: job.source_asset_id, jobId: job.id, durationMs: output.durationMs, bitRate: output.bitRate, ...extra}),
  ).first<{id: string}>()
  return row!.id
}

/** Runs one claimed job end to end. Never modifies the source master. */
export async function processAudioJob(deps: AudioJobDeps, job: AudioJob): Promise<AudioJobStatus> {
  const leaseMs = deps.leaseMs ?? DEFAULT_LEASE_MS
  const log = deps.log ?? (() => undefined)
  let leaseLost = false
  const heartbeat = setInterval(() => {
    renewLease(deps.db, job, leaseMs).then((owned) => { if (!owned) leaseLost = true }).catch(() => undefined)
  }, deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS)
  heartbeat.unref()
  const ensureOwned = () => { if (leaseLost) throw new LeaseLostError('Lease lost to another run') }
  const workDir = await mkdtemp(join(deps.tmpRoot ?? tmpdir(), 'mejay-audio-'))
  const startedAt = Date.now()
  try {
    log('audio job started', {jobId: job.id, attempt: job.attempts})
    const source = await deps.db.prepare(
      `SELECT storage_key FROM marketplace_assets WHERE id = ?1 AND kind = 'audio' AND processing_status = 'ready'`,
    ).bind(job.source_asset_id).first<{storage_key: string}>()
    if (!source) throw new Error('The uploaded master is no longer available')
    const tags = await loadTrackTagData(deps.db, job.track_id)
    if (!tags) throw new Error('The track no longer exists')

    const sourcePath = join(workDir, 'source')
    await downloadTo(deps.bucket, source.storage_key, sourcePath)
    ensureOwned()
    const probe = await probeAudio(sourcePath)

    const warnings: string[] = []
    let coverPath: string | null = null
    if (tags.artwork) {
      try {
        const artworkPath = join(workDir, 'artwork')
        await downloadTo(deps.bucket, tags.artwork.storageKey, artworkPath)
        coverPath = join(workDir, 'cover.jpg')
        await runFfmpeg(coverArgs(artworkPath, coverPath), {timeoutMs: 2 * 60_000})
      } catch (error) {
        coverPath = null
        warnings.push(`Cover art could not be embedded: ${summarizeToolError(error)}`)
      }
    } else {
      warnings.push('The release has no artwork yet, so no cover was embedded')
    }
    ensureOwned()

    const deliveryPath = join(workDir, 'delivery.mp3')
    await runFfmpeg(deliveryArgs({sourcePath, coverPath, outputPath: deliveryPath, tags, probe}))
    const deliveryProbe = await verifyMp3(deliveryPath, {durationMs: probe.durationMs, title: tags.title, artist: tags.artist, album: tags.album, coverArt: Boolean(coverPath)})
    ensureOwned()

    const previewPath = join(workDir, 'preview.mp3')
    const requestedStartMs = job.preview_start_ms ?? null
    const lengthMs = job.preview_length_ms ?? LEGACY_PREVIEW_LENGTH_MS
    const window = previewWindow(probe.durationMs, requestedStartMs, lengthMs)
    const previewTitle = `${tags.title} (Preview)`
    await runFfmpeg(previewArgs({sourcePath, coverPath, outputPath: previewPath, tags, probe, requestedStartMs, lengthMs}))
    const previewProbe = await verifyMp3(previewPath, {durationMs: window.lengthSeconds * 1000, title: previewTitle, artist: tags.artist, album: tags.album, coverArt: Boolean(coverPath)})
    ensureOwned()

    const deliveryKey = outputKey(job, 'audio_delivery')
    const previewKey = outputKey(job, 'audio_preview')
    const deliveryStored = await storeVerified(deps.bucket, deliveryPath, deliveryKey, workDir)
    const previewStored = await storeVerified(deps.bucket, previewPath, previewKey, workDir)
    ensureOwned()

    const delivery: StoredOutput = {key: deliveryKey, ...deliveryStored, durationMs: deliveryProbe.durationMs, bitRate: deliveryProbe.bitRate, fileName: deliveryFileName(tags.artist, tags.title)}
    const preview: StoredOutput = {key: previewKey, ...previewStored, durationMs: previewProbe.durationMs, bitRate: previewProbe.bitRate, fileName: deliveryFileName(tags.artist, tags.title, ' (Preview)')}

    const finished = await deps.db.transaction(async (db) => {
      // Re-check ownership under a row lock so a run that lost its lease cannot overwrite a newer one.
      const owned = await db.prepare(
        `SELECT id FROM audio_processing_jobs WHERE id = ?1 AND status = 'processing' AND attempts = ?2 FOR UPDATE`,
      ).bind(job.id, job.attempts).first()
      if (!owned) return false
      const deliveryAssetId = await upsertDerivedAsset(db, job, 'audio_delivery', delivery)
      const previewAssetId = await upsertDerivedAsset(db, job, 'audio_preview', preview, {previewSetting: requestedStartMs, previewLengthMs: lengthMs, startMs: Math.round(window.startSeconds * 1000)})
      const outputs = {
        source: {container: probe.container, codec: probe.codec, durationMs: probe.durationMs, sampleRate: probe.sampleRate, bitDepth: probe.bitDepth, channels: probe.channels, bitRate: probe.bitRate},
        delivery: {assetId: deliveryAssetId, fileName: delivery.fileName, byteSize: delivery.byteSize, sha256: delivery.sha256, durationMs: delivery.durationMs, bitRate: delivery.bitRate},
        preview: {assetId: previewAssetId, fileName: preview.fileName, byteSize: preview.byteSize, sha256: preview.sha256, durationMs: preview.durationMs, startSeconds: window.startSeconds},
        coverEmbedded: Boolean(coverPath),
        warnings,
        processingMs: Date.now() - startedAt,
      }
      await db.prepare(
        `UPDATE audio_processing_jobs SET status = 'succeeded', outputs = ?2::jsonb, last_error = NULL, lease_expires_at = NULL,
           finished_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?1`,
      ).bind(job.id, JSON.stringify(outputs)).run()
      return true
    })
    if (!finished) throw new LeaseLostError('Lease lost before the result could be saved')
    log('audio job succeeded', {jobId: job.id, ms: Date.now() - startedAt})
    return 'succeeded'
  } catch (error) {
    if (error instanceof LeaseLostError) {
      log('audio job abandoned (lease lost)', {jobId: job.id})
      return 'processing'
    }
    const message = summarizeToolError(error)
    const status = await failOrRetry(deps.db, job, message)
    log(status === 'failed' ? 'audio job failed' : 'audio job will retry', {jobId: job.id, attempt: job.attempts, error: message})
    return status
  } finally {
    clearInterval(heartbeat)
    await rm(workDir, {recursive: true, force: true}).catch(() => undefined)
  }
}

/**
 * Processes jobs one at a time. `kick()` is safe to call repeatedly (triggers, timers, boot): only one
 * drain loop ever runs per process, which together with SKIP LOCKED gives a concurrency of one.
 */
export function createAudioJobRunner(deps: AudioJobDeps) {
  let running: Promise<number> | null = null
  const drain = async (): Promise<number> => {
    let processed = 0
    for (;;) {
      const job = await claimNextAudioJob(deps.db, deps.leaseMs ?? DEFAULT_LEASE_MS)
      if (!job) return processed
      await processAudioJob(deps, job)
      processed += 1
    }
  }
  return {
    kick(): Promise<number> {
      if (!running) {
        running = drain()
          .catch((error) => { (deps.log ?? (() => undefined))('audio runner error', {error: summarizeToolError(error)}); return 0 })
          .finally(() => { running = null })
      }
      return running
    },
    get busy() {
      return running !== null
    },
  }
}
