import {Pool} from 'pg'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Database} from '../db/client'
import {runMigrations} from '../db/migrations'
import {MarketplaceService} from './service'

const connectionString = process.env.TEST_DATABASE_URL
const describeWithDatabase = connectionString ? describe : describe.skip

describeWithDatabase('marketplace PostgreSQL flow', () => {
  const schema = `marketplace_test_${crypto.randomUUID().replaceAll('-', '')}`
  let pool: Pool
  let service: MarketplaceService
  const providerUserId = crypto.randomUUID()
  const reviewerUserId = crypto.randomUUID()

  beforeAll(async () => {
    pool = new Pool({connectionString, max: 1, ssl: connectionString?.includes('localhost') ? false : {rejectUnauthorized: false}})
    await pool.query(`CREATE SCHEMA "${schema}"`)
    await pool.query(`SET search_path TO "${schema}"`)

    const client = await pool.connect()
    try {
      await runMigrations(client)
    } finally {
      client.release()
    }

    service = new MarketplaceService(new Database(connectionString!, pool) as never)
    await pool.query(
      `INSERT INTO users (id, email, account_intent) VALUES
        ($1, 'provider@example.test', 'provider'),
        ($2, 'reviewer@example.test', 'consumer')`,
      [providerUserId, reviewerUserId],
    )
    await pool.query(`INSERT INTO marketplace_staff (user_id, role) VALUES ($1, 'reviewer')`, [reviewerUserId])
  })

  afterAll(async () => {
    if (!pool) return
    await pool.query('SET search_path TO public')
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await pool.end()
  })

  it('creates the complete catalog and advances it to live', async () => {
    const provider = await service.completeProvider(providerUserId, {
      displayName: 'Integration Records',
      slug: `integration-records-${crypto.randomUUID().slice(0, 8)}`,
      contactEmail: 'provider@example.test',
      countryCode: 'US',
    }) as {id: string}
    const artist = await service.createArtist(providerUserId, {
      name: 'Integration Artist',
      countryCode: 'US',
      metadata: {},
    }) as {id: string}
    const release = await service.createRelease(providerUserId, {
      title: 'Integration Release',
      releaseType: 'single',
      primaryArtistId: artist.id,
    }) as {id: string; version: number}
    const track = await service.createTrack(providerUserId, release.id, {
      title: 'Integration Track',
      primaryArtistId: artist.id,
      discNumber: 1,
      trackNumber: 1,
      durationMs: 180_000,
      explicit: false,
      metadata: {},
    }) as {id: string}

    await service.createAsset(providerUserId, {
      releaseId: release.id,
      kind: 'artwork',
      storageKey: `${schema}/artwork.jpg`,
      mimeType: 'image/jpeg',
      byteSize: 120_000,
      processingStatus: 'ready',
      metadata: {},
    })
    await service.createAsset(providerUserId, {
      trackId: track.id,
      kind: 'audio',
      storageKey: `${schema}/track.wav`,
      mimeType: 'audio/wav',
      byteSize: 24_000_000,
      processingStatus: 'ready',
      metadata: {},
    })
    await service.createRightsDeclaration(providerUserId, {
      releaseId: release.id,
      declarationType: 'distribution',
      rightsHolder: 'Integration Records',
      ownershipBps: 10_000,
      territories: ['WORLD'],
    })
    for (const declarationType of ['master', 'composition'] as const) {
      await service.createRightsDeclaration(providerUserId, {
        trackId: track.id,
        declarationType,
        rightsHolder: 'Integration Records',
        ownershipBps: 10_000,
        territories: ['WORLD'],
      })
    }
    await service.assignIsrc(providerUserId, track.id, {isrc: 'USABC2612345', source: 'provider'})
    const product = await service.createProduct(providerUserId, {
      releaseId: release.id,
      name: 'Integration Release Download',
    }) as {id: string}
    await service.createPrice(providerUserId, product.id, {amountMinor: 999, currency: 'USD'})
    await service.replaceRevenueSplits(providerUserId, track.id, {
      entries: [
        {payeeName: 'Artist', shareBps: 7000},
        {payeeName: 'Label', shareBps: 3000},
      ],
    })

    let version = release.version
    for (const targetStatus of ['METADATA_COMPLETE', 'RIGHTS_COMPLETE', 'ISRC_COMPLETE', 'PRICING_COMPLETE', 'SUBMITTED'] as const) {
      const transitioned = await service.transitionRelease(providerUserId, release.id, {targetStatus, expectedVersion: version}) as {version: number}
      version = transitioned.version
    }
    await expect(service.createTrack(providerUserId, release.id, {
      title: 'Late Track',
      primaryArtistId: artist.id,
      discNumber: 1,
      trackNumber: 2,
      explicit: false,
      metadata: {},
    })).rejects.toMatchObject({status: 409, code: 'release_locked'})
    for (const targetStatus of ['UNDER_REVIEW', 'APPROVED', 'LIVE'] as const) {
      const transitioned = await service.transitionRelease(reviewerUserId, release.id, {targetStatus, expectedVersion: version}) as {version: number; status: string}
      version = transitioned.version
      expect(transitioned.status).toBe(targetStatus)
    }

    const counts = await pool.query<{
      providers: number
      artists: number
      releases: number
      tracks: number
      assets: number
      rights: number
      isrcs: number
      products: number
      prices: number
      splits: number
      audits: number
    }>(`SELECT
      (SELECT COUNT(*)::integer FROM provider_profiles) AS providers,
      (SELECT COUNT(*)::integer FROM artists) AS artists,
      (SELECT COUNT(*)::integer FROM releases WHERE status = 'LIVE') AS releases,
      (SELECT COUNT(*)::integer FROM tracks) AS tracks,
      (SELECT COUNT(*)::integer FROM marketplace_assets) AS assets,
      (SELECT COUNT(*)::integer FROM rights_declarations) AS rights,
      (SELECT COUNT(*)::integer FROM isrc_assignments) AS isrcs,
      (SELECT COUNT(*)::integer FROM products) AS products,
      (SELECT COUNT(*)::integer FROM prices) AS prices,
      (SELECT COUNT(*)::integer FROM revenue_split_sets) AS splits,
      (SELECT COUNT(*)::integer FROM marketplace_audit_events) AS audits`)

    expect(counts.rows[0]).toMatchObject({
      providers: 1,
      artists: 1,
      releases: 1,
      tracks: 1,
      assets: 2,
      rights: 3,
      isrcs: 1,
      products: 1,
      prices: 1,
      splits: 1,
    })
    expect(counts.rows[0].audits).toBeGreaterThanOrEqual(17)
    expect(provider.id).toBeTruthy()
  })
})