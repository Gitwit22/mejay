import {Pool} from 'pg'
import {afterAll, beforeAll, describe, expect, it} from 'vitest'
import {Database} from '../db/client'
import {runMigrations} from '../db/migrations'
import {AccountDeletionService} from '../account/deletion'
import {MarketplaceAdminService} from './admin-service'
import {MarketplaceService} from './service'

const connectionString = process.env.TEST_DATABASE_URL
const describeWithDatabase = connectionString ? describe : describe.skip

describeWithDatabase('marketplace PostgreSQL flow', () => {
  const schema = `marketplace_test_${crypto.randomUUID().replaceAll('-', '')}`
  const currentYear = new Date().getUTCFullYear() % 100
  let pool: Pool
  let service: MarketplaceService
  const adminUserId = crypto.randomUUID()
  const reviewerUserId = crypto.randomUUID()

  beforeAll(async () => {
    pool = new Pool({connectionString, max: 4, ssl: connectionString?.includes('localhost') ? false : {rejectUnauthorized: false}})
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
        ($1, 'admin@example.test', 'consumer'),
        ($2, 'reviewer@example.test', 'consumer')`,
      [adminUserId, reviewerUserId],
    )
    await pool.query(`INSERT INTO marketplace_staff (user_id, role) VALUES ($1, 'admin'), ($2, 'reviewer')`, [adminUserId, reviewerUserId])
  })

  afterAll(async () => {
    if (!pool) return
    await pool.query('SET search_path TO public')
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await pool.end()
  })

  async function resetIsrcState() {
    await pool.query('TRUNCATE isrc_assignments, isrc_registry, isrc_sequences, isrc_counters, isrc_rights_certifications CASCADE')
  }

  async function createProviderFixture(label: string) {
    const userId = crypto.randomUUID()
    await pool.query(
      `INSERT INTO users (id, email, account_intent) VALUES ($1, $2, 'provider')`,
      [userId, `${label}-${userId.slice(0, 8)}@example.test`],
    )
    await pool.query(
      `INSERT INTO entitlements (user_id, access_type, has_full_access, stripe_subscription_id, subscription_status)
       VALUES ($1, 'pro', 1, $2, 'active')`,
      [userId, `sub_${label}_${userId.slice(0, 8)}`],
    )
    const provider = await service.completeProvider(userId, {
      displayName: `${label} Records`,
      slug: `${label.toLowerCase()}-${userId.slice(0, 8)}`,
      contactEmail: `${label}-${userId.slice(0, 8)}@example.test`,
      countryCode: 'US',
    }) as {id: string}
    const artist = await service.createArtist(userId, {
      name: `${label} Artist`,
      countryCode: 'US',
      metadata: {},
    }) as {id: string}
    const release = await service.createRelease(userId, {
      title: `${label} Release`,
      releaseType: 'single',
      primaryArtistId: artist.id,
    }) as {id: string; version: number}
    const track = await service.createTrack(userId, release.id, {
      title: `${label} Track`,
      primaryArtistId: artist.id,
      discNumber: 1,
      trackNumber: 1,
      durationMs: 180_000,
      explicit: false,
      metadata: {},
    }) as {id: string}
    return {userId, provider, artist, release, track}
  }

  async function prepareLiveRelease(label: string) {
    const fixture = await createProviderFixture(label)
    await service.createAsset(fixture.userId, {
      releaseId: fixture.release.id,
      kind: 'artwork',
      storageKey: `${schema}/${label}-artwork.jpg`,
      mimeType: 'image/jpeg',
      byteSize: 120_000,
      processingStatus: 'ready',
      metadata: {},
    })
    await service.createAsset(fixture.userId, {
      trackId: fixture.track.id,
      kind: 'audio',
      storageKey: `${schema}/${label}-track.wav`,
      mimeType: 'audio/wav',
      byteSize: 24_000_000,
      processingStatus: 'ready',
      metadata: {},
    })
    await service.createRightsDeclaration(fixture.userId, {
      releaseId: fixture.release.id,
      declarationType: 'distribution',
      rightsHolder: `${label} Records`,
      ownershipBps: 10_000,
      territories: ['WORLD'],
    })
    for (const declarationType of ['master', 'composition'] as const) {
      await service.createRightsDeclaration(fixture.userId, {
        trackId: fixture.track.id,
        declarationType,
        rightsHolder: `${label} Records`,
        ownershipBps: 10_000,
        territories: ['WORLD'],
      })
    }
    await service.assignGeneratedIsrc(fixture.userId, fixture.track.id, {
      controlsRecording: true,
      neverAssignedIsrc: true,
      authorizeAssignment: true,
    }, {prefix: 'QTA3L', countryCode: 'QT', registrantCode: 'A3L'})
    const product = await service.createProduct(fixture.userId, {
      releaseId: fixture.release.id,
      name: `${label} Download`,
    }) as {id: string}
    await service.createPrice(fixture.userId, product.id, {amountMinor: 999, currency: 'USD'})
    await service.replaceRevenueSplits(fixture.userId, fixture.track.id, {
      entries: [
        {payeeName: 'Artist', shareBps: 7000},
        {payeeName: 'Label', shareBps: 3000},
      ],
    })
    let version = fixture.release.version
    for (const targetStatus of ['METADATA_COMPLETE', 'RIGHTS_COMPLETE', 'ISRC_COMPLETE', 'PRICING_COMPLETE', 'SUBMITTED'] as const) {
      const transitioned = await service.transitionRelease(fixture.userId, fixture.release.id, {targetStatus, expectedVersion: version}) as {version: number}
      version = transitioned.version
    }
    for (const targetStatus of ['UNDER_REVIEW', 'APPROVED', 'LIVE'] as const) {
      const transitioned = await service.transitionRelease(reviewerUserId, fixture.release.id, {targetStatus, expectedVersion: version}) as {version: number}
      version = transitioned.version
    }
    return {...fixture, version}
  }

  it('registers an existing external ISRC', async () => {
    await resetIsrcState()
    const {userId, track} = await createProviderFixture('External')

    const assignment = await service.assignIsrc(userId, track.id, {isrc: 'USABC2612345', source: 'provider'}) as {id: string; isrc: string}
    const registry = await pool.query<{assignment_type: string; status: string; track_id: string; rights_certification_id: string | null}>(
      `SELECT assignment_type, status, track_id, rights_certification_id
       FROM isrc_registry WHERE id = $1`,
      [assignment.id],
    )

    expect(assignment.isrc).toBe('USABC2612345')
    expect(registry.rows[0]).toEqual({
      assignment_type: 'EXTERNAL',
      status: 'REGISTERED',
      track_id: track.id,
      rights_certification_id: null,
    })
  })

  it('generates the first MEJay code from the registry sequence', async () => {
    await resetIsrcState()
    const {userId, track} = await createProviderFixture('Generated')

    const assignment = await service.assignGeneratedIsrc(userId, track.id, {
      controlsRecording: true,
      neverAssignedIsrc: true,
      authorizeAssignment: true,
    }, {prefix: 'QTA3L', countryCode: 'QT', registrantCode: 'A3L'}) as {isrc: string}
    const sequence = await pool.query<{next_number: number}>(
      'SELECT next_number FROM isrc_sequences WHERE prefix = $1 AND assignment_year = $2',
      ['QTA3L', currentYear],
    )

    expect(assignment.isrc).toBe(`QTA3L${String(currentYear).padStart(2, '0')}00001`)
    expect(sequence.rows[0]?.next_number).toBe(2)
  })

  it('prevents duplicate generation under concurrent requests', async () => {
    await resetIsrcState()
    const fixture = await createProviderFixture('Concurrent')
    const trackTwo = await service.createTrack(fixture.userId, fixture.release.id, {
      title: 'Concurrent Track 2',
      primaryArtistId: fixture.artist.id,
      discNumber: 1,
      trackNumber: 2,
      durationMs: 181_000,
      explicit: false,
      metadata: {},
    }) as {id: string}

    const [first, second] = await Promise.all([
      service.assignGeneratedIsrc(fixture.userId, fixture.track.id, {
        controlsRecording: true,
        neverAssignedIsrc: true,
        authorizeAssignment: true,
      }, {prefix: 'QTA3L', countryCode: 'QT', registrantCode: 'A3L'}) as Promise<{isrc: string}>,
      service.assignGeneratedIsrc(fixture.userId, trackTwo.id, {
        controlsRecording: true,
        neverAssignedIsrc: true,
        authorizeAssignment: true,
      }, {prefix: 'QTA3L', countryCode: 'QT', registrantCode: 'A3L'}) as Promise<{isrc: string}>,
    ])
    const registry = await pool.query<{count: number; distinct_count: number}>(
      `SELECT COUNT(*)::integer AS count, COUNT(DISTINCT isrc)::integer AS distinct_count
       FROM isrc_registry WHERE prefix = 'QTA3L' AND assignment_year = $1`,
      [currentYear],
    )

    expect([first.isrc, second.isrc].sort()).toEqual([
      `QTA3L${String(currentYear).padStart(2, '0')}00001`,
      `QTA3L${String(currentYear).padStart(2, '0')}00002`,
    ])
    expect(registry.rows[0]).toEqual({count: 2, distinct_count: 2})
  })

  it('creates the complete catalog and advances it to live', async () => {
    await resetIsrcState()
    const {userId: providerUserId, provider, artist, release, track, version: liveVersion} = await prepareLiveRelease('Retention')

    await expect(service.createTrack(providerUserId, release.id, {
      title: 'Late Track',
      primaryArtistId: artist.id,
      discNumber: 1,
      trackNumber: 2,
      explicit: false,
      metadata: {},
    })).rejects.toMatchObject({status: 409, code: 'release_locked'})

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
      (SELECT COUNT(*)::integer FROM provider_profiles WHERE id = $1) AS providers,
      (SELECT COUNT(*)::integer FROM artists WHERE provider_profile_id = $1) AS artists,
      (SELECT COUNT(*)::integer FROM releases WHERE id = $2 AND status = 'LIVE') AS releases,
      (SELECT COUNT(*)::integer FROM tracks WHERE release_id = $2) AS tracks,
      (SELECT COUNT(*)::integer FROM marketplace_assets WHERE release_id = $2 OR track_id = $3) AS assets,
      (SELECT COUNT(*)::integer FROM rights_declarations WHERE release_id = $2 OR track_id = $3) AS rights,
      (SELECT COUNT(*)::integer FROM isrc_assignments WHERE track_id = $3) AS isrcs,
      (SELECT COUNT(*)::integer FROM products WHERE release_id = $2) AS products,
      (SELECT COUNT(*)::integer FROM prices WHERE product_id IN (SELECT id FROM products WHERE release_id = $2)) AS prices,
      (SELECT COUNT(*)::integer FROM revenue_split_sets WHERE track_id = $3) AS splits,
      (SELECT COUNT(*)::integer FROM marketplace_audit_events WHERE provider_profile_id = $1) AS audits`,
      [provider.id, release.id, track.id],
    )

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

    await new MarketplaceAdminService(new Database(connectionString!, pool) as never).commandRelease(adminUserId, release.id, {
      action: 'takedown',
      expectedVersion: liveVersion,
      note: 'Retention verification',
    })
    const takedownRetention = await pool.query<{release_status: string; registry_rows: number}>(
      `SELECT
        (SELECT status FROM releases WHERE id = $1) AS release_status,
        (SELECT COUNT(*)::integer FROM isrc_registry WHERE track_id = $2) AS registry_rows`,
      [release.id, track.id],
    )
    expect(takedownRetention.rows[0]).toEqual({release_status: 'TAKEN_DOWN', registry_rows: 1})

    await new AccountDeletionService(new Database(connectionString!, pool) as never).deleteCurrentUser({
      userId: providerUserId,
      email: `retention-${providerUserId.slice(0, 8)}@example.test`,
      forfeitFullProgram: false,
    })

    const deletion = await pool.query<{
      users: number
      providers: number
      releases: number
      identified_audits: number
      snapshot_audits: number
      registry_rows: number
      identified_registry_rows: number
    }>(`SELECT
      (SELECT COUNT(*)::integer FROM users WHERE id = $1) AS users,
      (SELECT COUNT(*)::integer FROM provider_profiles WHERE id = $2) AS providers,
      (SELECT COUNT(*)::integer FROM releases WHERE provider_profile_id = $2) AS releases,
      (SELECT COUNT(*)::integer FROM marketplace_audit_events
        WHERE provider_profile_id = $2 OR actor_user_id = $1) AS identified_audits,
      (SELECT COUNT(*)::integer FROM marketplace_audit_events
        WHERE entity_id IN ($2, $3, $4) AND (before_data IS NOT NULL OR after_data IS NOT NULL OR anonymized_at IS NULL)) AS snapshot_audits,
      (SELECT COUNT(*)::integer FROM isrc_registry WHERE original_track_id = $4) AS registry_rows,
      (SELECT COUNT(*)::integer FROM isrc_registry WHERE provider_profile_id = $2 OR assigned_by_user_id = $1) AS identified_registry_rows`,
      [providerUserId, provider.id, release.id, track.id],
    )
    expect(deletion.rows[0]).toEqual({users: 0, providers: 0, releases: 0, identified_audits: 0, snapshot_audits: 0, registry_rows: 1, identified_registry_rows: 0})
  })
})