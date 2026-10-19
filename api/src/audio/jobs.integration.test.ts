import {copyFile, mkdtemp, rm, writeFile} from 'node:fs/promises'
import {createReadStream, existsSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Readable} from 'node:stream'
import {Pool} from 'pg'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'

import {Database} from '../db/client'
import {runMigrations} from '../db/migrations'
import {MarketplaceService} from '../marketplace/service'
import {runFfmpeg} from './ffmpeg'
import {claimNextAudioJob, createAudioJobRunner, enqueueAudioJob, getAudioJob, outputKey, processAudioJob, type AudioJobBucket} from './jobs'
import {probeAudio} from './probe'

const connectionString = process.env.TEST_DATABASE_URL
const describeWithDatabase = connectionString ? describe : describe.skip

/** Filesystem stand-in for the private R2 bucket. */
function fileBucket(root: string): AudioJobBucket & {path: (key: string) => string} {
  const path = (key: string) => join(root, key.replaceAll('/', '__'))
  return {
    path,
    async getExact(key: string) {
      if (!existsSync(path(key))) return null
      return {body: Readable.toWeb(createReadStream(path(key))) as unknown as ReadableStream}
    },
    async putFile(key: string, filePath: string) {
      await copyFile(filePath, path(key))
    },
  }
}

describeWithDatabase('audio processing jobs (PostgreSQL + real ffmpeg)', () => {
  const schema = `audio_jobs_test_${crypto.randomUUID().replaceAll('-', '')}`
  let pool: Pool
  let db: Database
  let service: MarketplaceService
  let workDir: string
  let bucket: ReturnType<typeof fileBucket>

  beforeAll(async () => {
    pool = new Pool({connectionString, max: 4, options: `-c search_path=${schema}`, ssl: false})
    await pool.query(`CREATE SCHEMA "${schema}"`)
    const client = await pool.connect()
    try {
      await runMigrations(client)
    } finally {
      client.release()
    }
    db = new Database(connectionString!, pool)
    service = new MarketplaceService(db as never)
    workDir = await mkdtemp(join(tmpdir(), 'mejay-audio-test-'))
    bucket = fileBucket(workDir)
    // A 100 s 96 kHz/24-bit master and 3000 px artwork, generated so the test needs no fixtures.
    await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=100', '-ar', '96000', '-c:a', 'pcm_s24le', join(workDir, 'master.wav')])
    await runFfmpeg(['-f', 'lavfi', '-i', 'color=c=red:s=3000x3000', '-frames:v', '1', join(workDir, 'art.png')])
  }, 120_000)

  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await pool.end()
    }
    if (workDir) await rm(workDir, {recursive: true, force: true})
  })

  async function fixture(label: string, {source = 'master.wav', artwork = true} = {}) {
    const userId = crypto.randomUUID()
    await pool.query(`INSERT INTO users (id, email, account_intent) VALUES ($1, $2, 'provider')`, [userId, `${label}-${userId.slice(0, 8)}@example.test`])
    await pool.query(
      `INSERT INTO entitlements (user_id, access_type, has_full_access, stripe_subscription_id, subscription_status) VALUES ($1, 'pro', 1, $2, 'active')`,
      [userId, `sub_${label}_${userId.slice(0, 8)}`],
    )
    const provider = await service.completeProvider(userId, {displayName: `${label} Records`, slug: `${label.toLowerCase()}-${userId.slice(0, 8)}`, contactEmail: `${label}-${userId.slice(0, 8)}@example.test`, countryCode: 'US'}) as {id: string}
    const artist = await service.createArtist(userId, {name: 'John Blaze', countryCode: 'US', metadata: {}}) as {id: string}
    const release = await service.createRelease(userId, {title: 'Woodward EP', releaseType: 'single', primaryArtistId: artist.id}) as {id: string}
    const track = await service.createTrack(userId, release.id, {title: 'Night Drive', primaryArtistId: artist.id, discNumber: 1, trackNumber: 1, durationMs: 100_000, explicit: false, metadata: {}}) as {id: string}
    const audioId = crypto.randomUUID()
    const audioKey = `mejay-artist/${provider.id}/audio/${track.id}/${audioId}.wav`
    await copyFile(join(workDir, source), bucket.path(audioKey))
    await pool.query(
      `INSERT INTO marketplace_assets (id, provider_profile_id, track_id, kind, storage_key, mime_type, byte_size, processing_status)
       VALUES ($1, $2, $3, 'audio', $4, 'audio/wav', 1000, 'ready')`,
      [audioId, provider.id, track.id, audioKey],
    )
    if (artwork) {
      const artId = crypto.randomUUID()
      const artKey = `mejay-artist/${provider.id}/artwork/${release.id}/${artId}.png`
      await copyFile(join(workDir, 'art.png'), bucket.path(artKey))
      await pool.query(
        `INSERT INTO marketplace_assets (id, provider_profile_id, release_id, kind, storage_key, mime_type, byte_size, processing_status)
         VALUES ($1, $2, $3, 'artwork', $4, 'image/png', 1000, 'ready')`,
        [artId, provider.id, release.id, artKey],
      )
    }
    return {userId, provider, release, track, audioId}
  }

  const deps = () => ({db: db as never, bucket, tmpRoot: workDir, heartbeatMs: 50})

  it('turns a WAV upload into a verified, tagged MP3 with cover art and a preview', async () => {
    const owner = await fixture('Happy')
    const job = await enqueueAudioJob(db as never, owner.audioId)
    expect((await enqueueAudioJob(db as never, owner.audioId)).id).toBe(job.id)

    const processed = await createAudioJobRunner(deps()).kick()
    expect(processed).toBe(1)
    const done = await getAudioJob(db as never, job.id)
    expect(done).toMatchObject({status: 'succeeded', attempts: 1, last_error: null})
    const outputs = done!.outputs as {source: {sampleRate: number; bitDepth: number}; delivery: {fileName: string; bitRate: number}; preview: {durationMs: number}; coverEmbedded: boolean}
    expect(outputs.source).toMatchObject({sampleRate: 96000, bitDepth: 24})
    expect(outputs.delivery).toMatchObject({fileName: 'John Blaze - Night Drive.mp3', bitRate: 320000})
    expect(outputs.coverEmbedded).toBe(true)

    const mp3 = await probeAudio(bucket.path(outputKey(done!, 'audio_delivery')))
    expect(mp3).toMatchObject({codec: 'mp3', hasCoverArt: true, sampleRate: 48000})
    expect(mp3.tags).toMatchObject({title: 'Night Drive', artist: 'John Blaze', album: 'Woodward EP', track: '1/1'})
    expect(Math.abs(mp3.durationMs - 100_000)).toBeLessThan(500)
    const preview = await probeAudio(bucket.path(outputKey(done!, 'audio_preview')))
    expect(Math.abs(preview.durationMs - 30_000)).toBeLessThan(500)
    expect(preview.tags.title).toBe('Night Drive (Preview)')

    const {rows} = await pool.query(`SELECT kind, mime_type, sha256 FROM marketplace_assets WHERE track_id = $1 ORDER BY kind`, [owner.track.id])
    expect(rows.map((row) => row.kind)).toEqual(['audio', 'audio_delivery', 'audio_preview'])
    expect(rows[1].sha256).toMatch(/^[0-9a-f]{64}$/)
    // Generated files stay out of the artist's draft view.
    const detail = await service.getRelease(owner.userId, owner.release.id) as {assets: Array<{kind: string}>}
    expect(detail.assets.map((asset) => asset.kind)).toEqual(['audio', 'artwork'])
  }, 120_000)

  it('lets only one runner claim a job', async () => {
    const owner = await fixture('Race')
    await enqueueAudioJob(db as never, owner.audioId)
    const [first, second] = await Promise.all([claimNextAudioJob(db as never), claimNextAudioJob(db as never)])
    expect([first, second].filter(Boolean)).toHaveLength(1)
    await pool.query(`UPDATE audio_processing_jobs SET status = 'failed' WHERE source_asset_id = $1`, [owner.audioId])
  })

  it('recovers an interrupted run and overwrites the same output files', async () => {
    const owner = await fixture('Crash')
    const job = await enqueueAudioJob(db as never, owner.audioId)
    const crashed = await claimNextAudioJob(db as never)
    expect(crashed).toMatchObject({id: job.id, attempts: 1, status: 'processing'})
    // The instance dies mid-job: nothing renews the lease.
    await pool.query(`UPDATE audio_processing_jobs SET lease_expires_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = $1`, [job.id])
    const reclaimed = await claimNextAudioJob(db as never)
    expect(reclaimed).toMatchObject({id: job.id, attempts: 2})
    // The crashed run comes back to life: its stale attempt number no longer owns the job.
    expect(await processAudioJob(deps(), crashed!)).toBe('processing')
    expect(await processAudioJob(deps(), reclaimed!)).toBe('succeeded')
    const {rows} = await pool.query(`SELECT COUNT(*)::integer AS count FROM marketplace_assets WHERE track_id = $1 AND kind IN ('audio_delivery', 'audio_preview')`, [owner.track.id])
    expect(rows[0].count).toBe(2)
  }, 120_000)

  it('retries a broken upload with backoff, then fails it without touching the master', async () => {
    await writeFile(join(workDir, 'broken.wav'), Buffer.from('RIFF....WAVEnot really audio'))
    const owner = await fixture('Broken', {source: 'broken.wav', artwork: false})
    const job = await enqueueAudioJob(db as never, owner.audioId)
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await pool.query(`UPDATE audio_processing_jobs SET run_after = CURRENT_TIMESTAMP WHERE id = $1`, [job.id])
      const claimed = await claimNextAudioJob(db as never)
      expect(claimed).toMatchObject({id: job.id, attempts: attempt})
      expect(await processAudioJob(deps(), claimed!)).toBe(attempt < 3 ? 'queued' : 'failed')
    }
    const failed = await getAudioJob(db as never, job.id)
    expect(failed).toMatchObject({status: 'failed', attempts: 3})
    expect(failed!.last_error).toBeTruthy()
    expect(await claimNextAudioJob(db as never)).toBeNull()
    const {rows} = await pool.query(`SELECT kind, processing_status FROM marketplace_assets WHERE track_id = $1`, [owner.track.id])
    expect(rows).toEqual([{kind: 'audio', processing_status: 'ready'}])
    // A failed job does not block a fresh attempt after the artist replaces or retries.
    const again = await enqueueAudioJob(db as never, owner.audioId)
    expect(again.id).not.toBe(job.id)
  }, 120_000)

  it('refuses to queue anything but a ready audio upload', async () => {
    await expect(enqueueAudioJob(db as never, crypto.randomUUID())).rejects.toMatchObject({code: 'source_not_found'})
  })
})
