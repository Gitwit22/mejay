import 'dotenv/config'
import {createHash, timingSafeEqual} from 'node:crypto'
import express, {type NextFunction, type Request, type Response} from 'express'

import {AudioJobError, createAudioJobRunner, enqueueAudioJob, getAudioJob, outputKey, type AudioJob} from './audio/jobs'
import {Database} from './db/client'
import type {Database as ServiceDatabase} from './marketplace/service'
import {createDownloadsBucket} from './services/r2'

/**
 * Standalone audio converter (proof of concept). Runs as its own Render service so conversions never
 * share CPU or memory with the main API. Needs only the database, the private bucket and a trigger
 * secret; it does not load the API's Stripe/session configuration.
 */
const databaseUrl = process.env.DATABASE_URL
const triggerSecret = process.env.CONVERTER_TRIGGER_SECRET ?? ''
if (!databaseUrl) throw new Error('DATABASE_URL is required')
if (triggerSecret.length < 32) throw new Error('CONVERTER_TRIGGER_SECRET must be at least 32 characters')
const bucket = createDownloadsBucket(process.env)
if (!bucket) throw new Error('R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY and R2_BUCKET_NAME are required')

const database = new Database(databaseUrl)
const db = database as unknown as ServiceDatabase
const log = (message: string, details: Record<string, unknown> = {}) => console.log(JSON.stringify({at: new Date().toISOString(), message, ...details}))
const runner = createAudioJobRunner({db, bucket, log})

const digest = (value: string) => createHash('sha256').update(value).digest()
const expectedToken = digest(triggerSecret)

/** Constant-time bearer check; every route except /health requires it. */
function requireTrigger(request: Request, response: Response, next: NextFunction) {
  const header = request.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token || !timingSafeEqual(digest(token), expectedToken)) {
    response.status(401).json({ok: false, error: 'unauthorized'})
    return
  }
  next()
}

const ID_PATTERN = /^[0-9a-f-]{36}$/i

async function describe(job: AudioJob) {
  const outputs = job.outputs as {delivery?: {fileName?: string}; preview?: {fileName?: string}}
  const downloads = job.status === 'succeeded'
    ? {
        mp3: await bucket!.createDownloadUrl(outputKey(job, 'audio_delivery'), outputs.delivery?.fileName ?? 'track.mp3', 600),
        preview: await bucket!.createDownloadUrl(outputKey(job, 'audio_preview'), outputs.preview?.fileName ?? 'preview.mp3', 600),
        expiresInSeconds: 600,
      }
    : null
  return {
    id: job.id, status: job.status, attempts: job.attempts, maxAttempts: job.max_attempts,
    lastError: job.last_error, outputs: job.outputs, trackId: job.track_id, sourceAssetId: job.source_asset_id,
    createdAt: job.created_at, updatedAt: job.updated_at, downloads,
  }
}

const app = express()
app.disable('x-powered-by')
app.use(express.json({limit: '10kb'}))

app.get('/health', (_request, response) => {
  response.json({ok: true, service: 'mejay-converter', busy: runner.busy})
})

app.post('/jobs', requireTrigger, async (request, response, next) => {
  try {
    const sourceAssetId = typeof request.body?.sourceAssetId === 'string' ? request.body.sourceAssetId.trim() : ''
    if (!ID_PATTERN.test(sourceAssetId)) {
      response.status(400).json({ok: false, error: 'invalid_source_asset_id'})
      return
    }
    const job = await enqueueAudioJob(db, sourceAssetId)
    void runner.kick()
    response.status(202).json({ok: true, data: await describe(job)})
  } catch (error) {
    next(error)
  }
})

app.post('/jobs/run', requireTrigger, (_request, response) => {
  void runner.kick()
  response.status(202).json({ok: true, busy: true})
})

app.get('/jobs/:jobId', requireTrigger, async (request, response, next) => {
  try {
    const jobId = String(request.params.jobId)
    if (!ID_PATTERN.test(jobId)) {
      response.status(400).json({ok: false, error: 'invalid_job_id'})
      return
    }
    const job = await getAudioJob(db, jobId)
    if (!job) {
      response.status(404).json({ok: false, error: 'not_found'})
      return
    }
    response.json({ok: true, data: await describe(job)})
  } catch (error) {
    next(error)
  }
})

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof AudioJobError) {
    response.status(error.status).json({ok: false, error: error.code, message: error.message})
    return
  }
  log('converter request failed', {error: error instanceof Error ? error.message : 'unknown'})
  response.status(500).json({ok: false, error: 'server_error'})
})

const port = Number(process.env.PORT || 10001)
const server = app.listen(port, () => {
  log('mejay-converter listening', {port})
  // Pick up anything queued or interrupted (e.g. the instance slept mid-job), then keep polling while awake.
  void runner.kick()
  setInterval(() => { void runner.kick() }, 60_000).unref()
})

const shutdown = () => {
  log('mejay-converter shutting down')
  server.close(() => { void database.close().finally(() => process.exit(0)) })
  // An interrupted job's lease expires and it is retried on the next boot.
  setTimeout(() => process.exit(0), 10_000).unref()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
