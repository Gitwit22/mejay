import {Pool} from 'pg'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {Database} from '../db/client'
import {runMigrations} from '../db/migrations'
import {AccountDeletionService} from '../account/deletion'
import {MarketplaceAdminService} from './admin-service'
import {CommerceService} from './commerce-service'
import {ConnectService} from './connect-service'
import {MarketplaceFinanceService} from './finance-service'
import {MarketplaceReportingService} from './reporting-service'
import {StoreService} from './store-service'
import {ReleaseSubmissionService} from './release-submission-service'
import {ArtistProfileService} from './artist-profile-service'
import {CERTIFICATION_VERSION} from './release-certification'
import {claimStripeWebhookEvent} from './webhook-events'
import {MarketplaceService} from './service'
import {providerSettingsSchema, releaseDraftSchema} from './schemas'
import {ProviderIsrcService} from './provider-isrc-service'
import {sendOrderConfirmation} from './order-email'
import {onRequest as stripeWebhook} from '../routes/stripe-webhook'
import {createHash, createHmac} from 'node:crypto'
import {processEmailJobs, retryFailedConfirmations, sendAccessRecovery} from './email-jobs'
import {exchangeEmailLink, issueEmailLink, resolveSessionDownload} from './guest-access'
import {claimGuestPurchases} from './commerce-service'
import {claimStorePurchases, downloadGuestFile, recoverGuestAccess} from '../routes/store/commerce'
import {signVerifiedToken} from '../routes/_auth'
import {ensurePreviewJobs, wakeConverterIfQueued} from './preview-jobs'
import {getCatalogAsset} from '../routes/store'
import {ReleaseChangeRequestService} from './change-request-service'
import {EditorialStoryService} from '../editorial/story-service'
import {mediaUploadSchema} from '../editorial/schemas'
import {recordStoryView} from '../routes/stories'
import {DiscoveryService} from './discovery-service'

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
    pool = new Pool({connectionString, max: 4, options: `-c search_path=${schema}`, ssl: connectionString?.includes('localhost') ? false : {rejectUnauthorized: false}})
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

  function adminService() {
    return new MarketplaceAdminService(new Database(connectionString!, pool) as never)
  }

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
    await adminService().commandProvider(adminUserId, provider.id, {action: 'approve'})
    await pool.query(
      `UPDATE provider_profiles SET stripe_account_id = $2, stripe_details_submitted = TRUE,
        stripe_payouts_enabled = TRUE, stripe_transfers_status = 'active' WHERE id = $1`,
      [provider.id, `acct_${label.toLowerCase()}_${userId.slice(0, 8)}`],
    )
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

  async function certifyRelease(userId: string, releaseId: string, thirdPartyMaterial: 'none' | 'licensed' | 'unsure' = 'none') {
    await new ReleaseSubmissionService(new Database(connectionString!, pool) as never).saveCertification(userId, releaseId, {
      version: CERTIFICATION_VERSION,
      thirdPartyMaterial,
      accepted: ['original_recording', 'beat_rights', 'distribution_rights', 'collaborators_authorized', 'information_accurate', 'platform_authorization', 'no_prior_isrc'],
    })
  }

  async function prepareLiveRelease(label: string, options: {songPriceMinor?: number; skipIsrc?: boolean; stage?: 'pricing' | 'live'} = {}) {
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
    if (!options.skipIsrc) {
      await service.assignGeneratedIsrc(fixture.userId, fixture.track.id, {
        controlsRecording: true,
        neverAssignedIsrc: true,
        authorizeAssignment: true,
      }, {prefix: 'QTA3L', countryCode: 'QT', registrantCode: 'A3L'})
    }
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
    if (options.songPriceMinor !== undefined) {
      await service.setTrackPrice(fixture.userId, fixture.track.id, {amountMinor: options.songPriceMinor})
    }
    let version = fixture.release.version
    for (const targetStatus of ['METADATA_COMPLETE', 'RIGHTS_COMPLETE', 'ISRC_COMPLETE', 'PRICING_COMPLETE'] as const) {
      const transitioned = await service.transitionRelease(fixture.userId, fixture.release.id, {targetStatus, expectedVersion: version}) as {version: number}
      version = transitioned.version
    }
    if (options.stage === 'pricing') return {...fixture, version}
    await certifyRelease(fixture.userId, fixture.release.id)
    const submitted = await service.transitionRelease(fixture.userId, fixture.release.id, {targetStatus: 'SUBMITTED', expectedVersion: version}) as {version: number}
    version = submitted.version
    for (const [actor, action] of [[reviewerUserId, 'start_review'], [reviewerUserId, 'approve'], [adminUserId, 'publish_now']] as const) {
      const commanded = await adminService().commandRelease(actor, fixture.release.id, {action, expectedVersion: version}) as {version: number}
      version = commanded.version
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

  it('issues sequential, unique designations and keeps ISRC operations owner-scoped', async () => {
    await resetIsrcState()
    const owner = await createProviderFixture('IsrcOwner')
    const trackTwo = await service.createTrack(owner.userId, owner.release.id, {
      title: 'Sequential Track 2', primaryArtistId: owner.artist.id, discNumber: 1, trackNumber: 2,
      durationMs: 181_000, explicit: false, metadata: {},
    }) as {id: string}
    const config = {prefix: 'QTA3L', countryCode: 'QT', registrantCode: 'A3L'} as const
    const certification = {controlsRecording: true, neverAssignedIsrc: true, authorizeAssignment: true} as const
    const year = String(currentYear).padStart(2, '0')

    const first = await service.assignGeneratedIsrc(owner.userId, owner.track.id, certification, config) as {isrc: string}
    const second = await service.assignGeneratedIsrc(owner.userId, trackTwo.id, certification, config) as {isrc: string}
    expect([first.isrc, second.isrc]).toEqual([`QTA3L${year}00001`, `QTA3L${year}00002`])

    // A different provider can neither generate nor register a code on someone else's track.
    const intruder = await createProviderFixture('IsrcIntruder')
    const otherTrack = await service.createTrack(owner.userId, owner.release.id, {
      title: 'Unassigned Track', primaryArtistId: owner.artist.id, discNumber: 1, trackNumber: 3,
      durationMs: 181_000, explicit: false, metadata: {},
    }) as {id: string}
    await expect(service.assignGeneratedIsrc(intruder.userId, otherTrack.id, certification, config)).rejects.toMatchObject({status: 404})
    await expect(service.assignIsrc(intruder.userId, otherTrack.id, {isrc: 'USABC2600001', source: 'provider'})).rejects.toMatchObject({status: 404})
    const untouched = await pool.query('SELECT COUNT(*)::integer AS count FROM isrc_registry WHERE track_id = $1', [otherTrack.id])
    expect(untouched.rows[0].count).toBe(0)

    // The registry is staff-only; providers cannot list it.
    await expect(adminService().listIsrcRegistry(owner.userId)).rejects.toMatchObject({status: 403})
    const registry = await adminService().listIsrcRegistry(adminUserId, {year: currentYear}) as Array<{isrc: string}>
    expect(new Set(registry.map((row) => row.isrc)).size).toBe(registry.length)
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
    const registry = await pool.query<{count: number; distinct_count: number; certifications: number}>(
      `SELECT
         COUNT(*)::integer AS count,
         COUNT(DISTINCT isrc)::integer AS distinct_count,
         COUNT(rights_certification_id)::integer AS certifications
       FROM isrc_registry WHERE prefix = 'QTA3L' AND assignment_year = $1`,
      [currentYear],
    )

    expect([first.isrc, second.isrc].sort()).toEqual([
      `QTA3L${String(currentYear).padStart(2, '0')}00001`,
      `QTA3L${String(currentYear).padStart(2, '0')}00002`,
    ])
    expect(registry.rows[0]).toEqual({count: 2, distinct_count: 2, certifications: 2})
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

    // Deletion requires the account to be back on the free tier.
    await pool.query(
      `UPDATE entitlements SET access_type = 'free', has_full_access = 0, stripe_subscription_id = NULL,
        subscription_status = 'canceled' WHERE user_id = $1`,
      [providerUserId],
    )
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

  it('requires provider approval before a release can be submitted', async () => {
    const userId = crypto.randomUUID()
    await pool.query(`INSERT INTO users (id, email, account_intent) VALUES ($1, $2, 'provider')`, [userId, `pending-${userId.slice(0, 8)}@example.test`])
    await pool.query(
      `INSERT INTO entitlements (user_id, access_type, has_full_access, stripe_subscription_id, subscription_status)
       VALUES ($1, 'pro', 1, $2, 'active')`,
      [userId, `sub_pending_${userId.slice(0, 8)}`],
    )
    const provider = await service.completeProvider(userId, {
      displayName: 'Pending Records',
      slug: `pending-${userId.slice(0, 8)}`,
      contactEmail: `pending-${userId.slice(0, 8)}@example.test`,
      countryCode: 'US',
    }) as {id: string; status: string}
    expect(provider.status).toBe('pending_review')
    const artist = await service.createArtist(userId, {name: 'Pending Artist', countryCode: 'US', metadata: {}}) as {id: string}
    const release = await service.createRelease(userId, {title: 'Pending Release', releaseType: 'single', primaryArtistId: artist.id}) as {id: string; version: number}
    await pool.query(`UPDATE releases SET status = 'PRICING_COMPLETE' WHERE id = $1`, [release.id])
    await expect(service.transitionRelease(userId, release.id, {targetStatus: 'SUBMITTED', expectedVersion: release.version}))
      .rejects.toMatchObject({code: 'provider_not_approved'})
    // The wizard must not report the release as ready while the account gate would refuse it.
    const pendingDetail = await service.getRelease(userId, release.id) as {prerequisites: string[]}
    expect(pendingDetail.prerequisites).toContain('artist account approved by MEJay (your application is still in review)')

    await expect(adminService().commandProvider(reviewerUserId, provider.id, {action: 'approve'}))
      .rejects.toMatchObject({code: 'marketplace_admin_required'})
    const approved = await adminService().commandProvider(adminUserId, provider.id, {action: 'approve'}) as {status: string}
    expect(approved.status).toBe('approved')
    const approvedDetail = await service.getRelease(userId, release.id) as {prerequisites: string[]}
    expect(approvedDetail.prerequisites.some((item) => item.startsWith('artist account'))).toBe(false)
  })

  it('does not let staff publish through the provider transition endpoint', async () => {
    const {release} = await createProviderFixture('Bypass')
    await pool.query(`UPDATE releases SET status = 'APPROVED' WHERE id = $1`, [release.id])
    await expect(service.transitionRelease(adminUserId, release.id, {targetStatus: 'LIVE', expectedVersion: release.version}))
      .rejects.toMatchObject({code: 'marketplace_review_required'})
  })

  it('rejects external ISRCs under the MEJay prefix and skips already-registered designations', async () => {
    await resetIsrcState()
    const fixture = await createProviderFixture('Jam')
    await expect(service.assignIsrc(fixture.userId, fixture.track.id, {isrc: `QTA3L${String(currentYear).padStart(2, '0')}00001`, source: 'provider'}))
      .rejects.toMatchObject({code: 'isrc_not_allowed'})

    const first = await service.assignGeneratedIsrc(fixture.userId, fixture.track.id, {
      controlsRecording: true, neverAssignedIsrc: true, authorizeAssignment: true,
    }, {prefix: 'QTA3L', countryCode: 'QT', registrantCode: 'A3L'}) as {isrc: string}
    // Simulate a counter that fell behind the registry (legacy import / manual fix).
    await pool.query('UPDATE isrc_sequences SET next_number = 1 WHERE prefix = $1 AND assignment_year = $2', ['QTA3L', currentYear])
    const trackTwo = await service.createTrack(fixture.userId, fixture.release.id, {
      title: 'Jam Track 2', primaryArtistId: fixture.artist.id, discNumber: 1, trackNumber: 2, durationMs: 120_000, explicit: false, metadata: {},
    }) as {id: string}
    const second = await service.assignGeneratedIsrc(fixture.userId, trackTwo.id, {
      controlsRecording: true, neverAssignedIsrc: true, authorizeAssignment: true,
    }, {prefix: 'QTA3L', countryCode: 'QT', registrantCode: 'A3L'}) as {isrc: string}
    expect(first.isrc.endsWith('00001')).toBe(true)
    expect(second.isrc.endsWith('00002')).toBe(true)
  })

  it('runs the purchase status and purchased-music queries', async () => {
    const commerce = new CommerceService(new Database(connectionString!, pool) as never, 'sk_test_unused')
    await expect(commerce.listPurchases(crypto.randomUUID())).resolves.toEqual([])
    await expect(commerce.getOrderStatus(crypto.randomUUID(), 'cs_test_missing')).rejects.toMatchObject({code: 'checkout_not_found'})
    await expect(commerce.retryPendingTransfers({providerId: crypto.randomUUID()})).resolves.toEqual({attempted: 0, transferred: 0, failed: 0})
  })

  describe('marketplace money flow', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    function stubStripe(stripeFee: number) {
      const calls: Array<{url: string; body: URLSearchParams | null}> = []
      vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input)
        const body = init?.body instanceof URLSearchParams ? init.body : null
        calls.push({url, body})
        const reply = (data: unknown) => new Response(JSON.stringify(data), {status: 200})
        if (url.includes('/v1/checkout/sessions')) return reply({id: `cs_${crypto.randomUUID()}`, url: 'https://checkout.stripe.test'})
        if (url.includes('/v1/payment_intents/')) {
          return reply({id: url.split('/v1/payment_intents/')[1].split('?')[0], status: 'succeeded', latest_charge: {id: `ch_${crypto.randomUUID()}`, balance_transaction: {id: 'txn_1', fee: stripeFee}}})
        }
        if (url.includes('/reversals')) return reply({id: `trr_${crypto.randomUUID()}`})
        if (url.endsWith('/v1/transfers')) return reply({id: `tr_${crypto.randomUUID()}`})
        throw new Error(`Unexpected Stripe call ${url}`)
      }))
      return calls
    }

    async function startCheckout(label: string, stripeFee: number, amountMinor = 999) {
      await resetIsrcState()
      const fixture = await prepareLiveRelease(label)
      const product = await pool.query<{id: string}>('SELECT id FROM products WHERE release_id = $1', [fixture.release.id])
      if (amountMinor !== 999) await pool.query('UPDATE prices SET amount_minor = $1 WHERE product_id = $2', [amountMinor, product.rows[0].id])
      const buyerId = crypto.randomUUID()
      await pool.query(`INSERT INTO users (id, email, account_intent) VALUES ($1, $2, 'consumer')`, [buyerId, `buyer-${buyerId.slice(0, 8)}@example.test`])
      const calls = stubStripe(stripeFee)
      const commerce = new CommerceService(new Database(connectionString!, pool) as never, 'sk_test', 1000)
      const checkout = await commerce.createCheckout(buyerId, product.rows[0].id, 'https://app.test')
      const attempt = await pool.query<{id: string}>('SELECT id FROM marketplace_checkout_attempts WHERE stripe_checkout_session_id = $1', [checkout.sessionId])
      const session = {
        id: checkout.sessionId,
        payment_status: 'paid',
        payment_intent: `pi_${crypto.randomUUID()}`,
        amount_total: amountMinor,
        currency: 'usd',
        livemode: false,
        metadata: {kind: 'marketplace_purchase', attemptId: attempt.rows[0].id, userId: buyerId, productId: product.rows[0].id},
      }
      return {fixture, commerce, calls, buyerId, session, productId: product.rows[0].id}
    }

    async function buyLiveRelease(label: string, stripeFee: number) {
      const started = await startCheckout(label, stripeFee)
      const {orderId} = await started.commerce.fulfillPaidSession(started.session)
      const order = await pool.query('SELECT * FROM marketplace_orders WHERE id = $1', [orderId])
      return {...started, order: order.rows[0]}
    }

    it('charges the Stripe fee to the provider and reverses the provider share of partial refunds', async () => {
      const {commerce, calls, order, buyerId} = await buyLiveRelease('Money', 59)
      // $9.99: 100¢ commission + 59¢ Stripe fee retained; provider receives 840¢.
      expect(order).toMatchObject({gross_amount_minor: 999, platform_fee_minor: 159, provider_proceeds_minor: 840, transfer_status: 'transferred'})
      const transfer = calls.find((call) => call.url.endsWith('/v1/transfers'))
      expect(transfer?.body?.get('amount')).toBe('840')

      await commerce.handleRefund({id: order.stripe_charge_id, amount: 999, amount_refunded: 500})
      const reversal = calls.filter((call) => call.url.includes('/reversals'))
      // Platform keeps floor(500 * 159 / 999) = 79¢ of its share; provider returns 421¢.
      expect(reversal.map((call) => call.body?.get('amount'))).toEqual(['421'])
      const partial = await pool.query('SELECT transfer_reversed_minor, transfer_status, payment_status FROM marketplace_orders WHERE id = $1', [order.id])
      expect(partial.rows[0]).toEqual({transfer_reversed_minor: 421, transfer_status: 'transferred', payment_status: 'partially_refunded'})

      const eventId = `evt_${crypto.randomUUID()}`
      await claimStripeWebhookEvent(new Database(connectionString!, pool) as never, {id: eventId, type: 'charge.dispute.closed', createdAt: new Date().toISOString()})
      await commerce.handleDispute({id: 'dp_1', charge: order.stripe_charge_id, status: 'lost'}, false, eventId)
      const afterDispute = calls.filter((call) => call.url.includes('/reversals')).map((call) => call.body?.get('amount'))
      expect(afterDispute).toEqual(['421', '419'])
      const final = await pool.query('SELECT transfer_reversed_minor, transfer_status FROM marketplace_orders WHERE id = $1', [order.id])
      expect(final.rows[0]).toEqual({transfer_reversed_minor: 840, transfer_status: 'reversed'})
      const purchases = await commerce.listPurchases(buyerId) as Array<{entitlement_status: string}>
      expect(purchases[0].entitlement_status).toBe('revoked')
    })

    it('takes exactly 10% commission on a $10.00 sale and refunds at the same rate', async () => {
      const {commerce, calls, session} = await startCheckout('TenDollar', 59, 1000)
      expect(calls.find((call) => call.url.endsWith('/v1/checkout/sessions'))?.body?.get('line_items[0][price_data][unit_amount]')).toBe('1000')
      const {orderId} = await commerce.fulfillPaidSession(session)
      const order = (await pool.query('SELECT * FROM marketplace_orders WHERE id = $1', [orderId])).rows[0]
      // 100¢ commission (10% of 1000) + 59¢ recovered Stripe fee; artist receives 841¢.
      expect(order).toMatchObject({gross_amount_minor: 1000, platform_fee_bps: 1000, stripe_fee_minor: 59, platform_fee_minor: 159, provider_proceeds_minor: 841})
      expect(order.platform_fee_minor - order.stripe_fee_minor).toBe(100)
      expect(calls.find((call) => call.url.endsWith('/v1/transfers'))?.body?.get('amount')).toBe('841')

      await commerce.handleRefund({id: order.stripe_charge_id, amount: 1000, amount_refunded: 1000})
      expect(calls.filter((call) => call.url.includes('/reversals')).map((call) => call.body?.get('amount'))).toEqual(['841'])
      const refundEntries = await pool.query<{account_code: string; debit: number; credit: number}>(
        `SELECT entry.account_code, SUM(entry.debit_minor)::integer AS debit, SUM(entry.credit_minor)::integer AS credit
         FROM marketplace_ledger_entries entry JOIN marketplace_ledger_transactions txn ON txn.id = entry.transaction_id
         WHERE txn.order_id = $1 AND txn.transaction_type = 'refund' GROUP BY entry.account_code ORDER BY entry.account_code`,
        [orderId],
      )
      expect(refundEntries.rows).toEqual([
        {account_code: 'platform_revenue', debit: 159, credit: 0},
        {account_code: 'provider_payable', debit: 841, credit: 0},
        {account_code: 'stripe_clearing', debit: 0, credit: 1000},
      ])
    })

    describe('purchase confirmation email', () => {
      const webhookSecret = 'whsec_integration_platform'
      const emailEnv = {RESEND_API_KEY: 're_test_key', RESEND_FROM: 'MeJay <orders@example.test>', FRONTEND_URL: 'https://app.test'}

      function signedEvent(event: Record<string, unknown>): Request {
        const payload = JSON.stringify(event)
        const timestamp = Math.floor(Date.now() / 1000)
        const signature = createHmac('sha256', webhookSecret).update(`${timestamp}.${payload}`).digest('hex')
        return new Request('https://api.test/api/stripe-webhook', {method: 'POST', headers: {'stripe-signature': `t=${timestamp},v1=${signature}`}, body: payload})
      }

      /** Stripe stub plus a Resend endpoint whose responses the test controls. */
      function stubStripeAndResend(resendStatuses: number[]) {
        const stripeCalls = stubStripe(59)
        const stripeFetch = globalThis.fetch
        const resendCalls: Array<{headers: Record<string, string>; body: Record<string, unknown>}> = []
        vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
          if (String(input) === 'https://api.resend.com/emails') {
            resendCalls.push({headers: init?.headers as Record<string, string>, body: JSON.parse(String(init?.body))})
            return new Response('{}', {status: resendStatuses.shift() ?? 200})
          }
          return stripeFetch(input, init)
        }))
        return {stripeCalls, resendCalls}
      }

      async function deliver(env: Record<string, unknown>, event: Record<string, unknown>) {
        const response = await stripeWebhook({request: signedEvent(event), env: env as never})
        return {status: response.status, body: await response.json() as Record<string, unknown>}
      }

      it('sends exactly one confirmation across duplicate and follow-up webhook deliveries', async () => {
        const {session, buyerId} = await startCheckout('EmailOnce', 59)
        const {resendCalls} = stubStripeAndResend([])
        const env = {DB: new Database(connectionString!, pool), STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: webhookSecret, STRIPE_PRICE_PRO: 'p', STRIPE_PRICE_YEARLY: 'y', MARKETPLACE_PLATFORM_FEE_BPS: '1000', ...emailEnv}
        const completed = {id: `evt_${crypto.randomUUID()}`, type: 'checkout.session.completed', livemode: false, data: {object: session}}

        const first = await deliver(env, completed)
        expect(first.status).toBe(200)
        const orderId = first.body.orderId as string
        expect(await deliver(env, completed)).toMatchObject({status: 200, body: {duplicate: true}})
        expect(await deliver(env, {id: `evt_${crypto.randomUUID()}`, type: 'checkout.session.async_payment_succeeded', livemode: false, data: {object: session}}))
          .toMatchObject({status: 200, body: {orderId}})
        await expect(sendOrderConfirmation(env.DB as never, env, orderId)).resolves.toBe('already_handled')

        expect(resendCalls).toHaveLength(1)
        const [sent] = resendCalls
        const buyer = await pool.query('SELECT email FROM users WHERE id = $1', [buyerId])
        expect(sent.body.to).toBe(buyer.rows[0].email)
        expect(sent.headers['idempotency-key']).toBe(`mejay-order-confirmation/${orderId}`)
        expect(sent.body).not.toHaveProperty('attachments')
        const content = `${sent.body.text}\n${sent.body.html}`
        expect(content).toContain('$9.99')
        expect(content).toContain(orderId)
        expect(content).toContain('https://app.test/app/purchased')
        // The only links are the tokenized download page (secret in the fragment) and Purchases:
        // never an API download route, storage key or asset URL.
        const links = [...new Set(content.match(/https?:\/\/[^\s"<]+/g))]
        expect(links).toHaveLength(2)
        expect(links).toContain('https://app.test/app/purchased')
        const downloadLink = links.find((link) => link.startsWith('https://app.test/download#token='))!
        expect(downloadLink).toMatch(/^https:\/\/app\.test\/download#token=[A-Za-z0-9_-]{43}$/)
        expect(content).toContain('Download your music')
        expect(content).not.toMatch(/\/api\/|\/files\/|\.wav|r2|storage/i)
        // Only the token's hash is stored, scoped to this purchase, valid for 7 days.
        const token = downloadLink.split('#token=')[1]
        const stored = await pool.query(
          `SELECT token_hash, kind, issued_for, expires_at - created_at > INTERVAL '6 days 23 hours' AS seven_days FROM marketplace_guest_access_tokens WHERE order_id = $1`,
          [orderId],
        )
        expect(stored.rows).toEqual([{token_hash: expect.not.stringContaining(token), kind: 'email_link', issued_for: 'purchase', seven_days: true}])
        const row = await pool.query('SELECT status, attempts, sent_at IS NOT NULL AS sent FROM marketplace_order_notifications WHERE order_id = $1', [orderId])
        expect(row.rows).toEqual([{status: 'sent', attempts: 1, sent: true}])
      })

      it('never fails or rolls back the order when the email provider fails', async () => {
        const {session} = await startCheckout('EmailFails', 59)
        const {resendCalls} = stubStripeAndResend([500])
        const env = {DB: new Database(connectionString!, pool), STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: webhookSecret, STRIPE_PRICE_PRO: 'p', STRIPE_PRICE_YEARLY: 'y', MARKETPLACE_PLATFORM_FEE_BPS: '1000', ...emailEnv}
        const eventId = `evt_${crypto.randomUUID()}`
        const delivered = await deliver(env, {id: eventId, type: 'checkout.session.completed', livemode: false, data: {object: session}})
        expect(delivered.status).toBe(200)
        const orderId = delivered.body.orderId as string
        const state = await pool.query(
          `SELECT purchase_order.payment_status, entitlement.status AS entitlement, notification.status AS email, notification.last_error, event.status AS event
           FROM marketplace_orders purchase_order
           JOIN download_entitlements entitlement ON entitlement.order_id = purchase_order.id
           JOIN marketplace_order_notifications notification ON notification.order_id = purchase_order.id
           JOIN stripe_webhook_events event ON event.stripe_event_id = $2
           WHERE purchase_order.id = $1`,
          [orderId, eventId],
        )
        expect(state.rows[0]).toEqual({payment_status: 'paid', entitlement: 'active', email: 'failed', last_error: 'http_500', event: 'processed'})

        // A later event for the same order retries the failed confirmation once more.
        await expect(sendOrderConfirmation(env.DB as never, env, orderId)).resolves.toBe('sent')
        await expect(sendOrderConfirmation(env.DB as never, env, orderId)).resolves.toBe('already_handled')
        expect(resendCalls).toHaveLength(2)
      })

      it('records a skipped confirmation when email is not configured', async () => {
        const {commerce, session} = await startCheckout('EmailOff', 59)
        const {orderId} = await commerce.fulfillPaidSession(session)
        const fetchSpy = vi.fn()
        vi.stubGlobal('fetch', fetchSpy)
        await expect(sendOrderConfirmation(new Database(connectionString!, pool) as never, {FRONTEND_URL: 'https://app.test'}, orderId)).resolves.toBe('skipped')
        expect(fetchSpy).not.toHaveBeenCalled()
      })
    })

    it('fulfills a verified paid session exactly once, snapshotting commission and mode', async () => {
      const {commerce, calls, order, buyerId, session} = await buyLiveRelease('Once', 59)
      expect(order).toMatchObject({platform_fee_bps: 1000, livemode: false, payment_status: 'paid'})
      const checkoutCall = calls.find((call) => call.url.endsWith('/v1/checkout/sessions'))
      expect(checkoutCall?.body?.get('metadata[marketplace]')).toBe('mejay')
      expect(checkoutCall?.body?.get('payment_intent_data[metadata][attemptId]')).toBe(session.metadata.attemptId)
      expect(checkoutCall?.body?.get('line_items[0][price_data][unit_amount]')).toBe('999')

      // A duplicate webhook delivery (or the async-success event after completion) must not
      // create a second order, entitlement, ledger posting, or transfer.
      const again = await commerce.fulfillPaidSession(session)
      expect(again.orderId).toBe(order.id)
      const counts = await pool.query<{orders: number; entitlements: number; sales: number}>(
        `SELECT (SELECT COUNT(*)::integer FROM marketplace_orders WHERE stripe_checkout_session_id = $1) AS orders,
          (SELECT COUNT(*)::integer FROM download_entitlements WHERE order_id = $2) AS entitlements,
          (SELECT COUNT(*)::integer FROM marketplace_ledger_transactions WHERE order_id = $2 AND transaction_type = 'sale') AS sales`,
        [session.id, order.id],
      )
      expect(counts.rows[0]).toEqual({orders: 1, entitlements: 1, sales: 1})
      expect(calls.filter((call) => call.url.endsWith('/v1/transfers'))).toHaveLength(1)
      const purchases = await commerce.listPurchases(buyerId) as Array<{entitlement_status: string}>
      expect(purchases.map((purchase) => purchase.entitlement_status)).toEqual(['active'])
    })

    it('grants nothing from the success redirect, an unpaid session, or a failed payment', async () => {
      const {commerce, buyerId, session} = await startCheckout('Unpaid', 59)
      // The success_url only polls status; no order exists until a verified webhook fulfills it.
      const status = await commerce.getOrderStatus(buyerId, session.id) as {order_id: string | null; status: string}
      expect(status.order_id).toBeNull()
      await expect(commerce.listPurchases(buyerId)).resolves.toEqual([])

      await expect(commerce.fulfillPaidSession({...session, payment_status: 'unpaid'})).rejects.toMatchObject({code: 'payment_not_paid'})
      await commerce.closeCheckoutAttempt(session, 'payment_failed')
      const attempt = await pool.query<{status: string}>('SELECT status FROM marketplace_checkout_attempts WHERE id = $1', [session.metadata.attemptId])
      expect(attempt.rows[0].status).toBe('payment_failed')
      await expect(commerce.listPurchases(buyerId)).resolves.toEqual([])
    })

    it('rejects a paid session whose amount differs from the server-priced snapshot', async () => {
      const {commerce, buyerId, session} = await startCheckout('Tamper', 59)
      await expect(commerce.fulfillPaidSession({...session, amount_total: 1})).rejects.toMatchObject({code: 'checkout_amount_mismatch'})
      await expect(commerce.listPurchases(buyerId)).resolves.toEqual([])
    })

    it('keeps the sale-time commission when the configured rate changes later', async () => {
      const {order} = await buyLiveRelease('Rate', 59)
      const laterRate = new CommerceService(new Database(connectionString!, pool) as never, 'sk_test', 3000)
      await laterRate.handleRefund({id: order.stripe_charge_id, amount: 999, amount_refunded: 999})
      const after = await pool.query('SELECT gross_amount_minor, platform_fee_minor, provider_proceeds_minor, platform_fee_bps, payment_status FROM marketplace_orders WHERE id = $1', [order.id])
      expect(after.rows[0]).toEqual({gross_amount_minor: 999, platform_fee_minor: 159, provider_proceeds_minor: 840, platform_fee_bps: 1000, payment_status: 'refunded'})
      const ledger = await pool.query<{transaction_type: string}>('SELECT transaction_type FROM marketplace_ledger_transactions WHERE order_id = $1 ORDER BY occurred_at, transaction_type', [order.id])
      expect(ledger.rows.map((row) => row.transaction_type)).toEqual(expect.arrayContaining(['sale', 'provider_transfer', 'refund', 'transfer_reversal']))
    })

    it('records a transfer Stripe rejects, still fulfills the buyer, and pays it on retry', async () => {
      await resetIsrcState()
      const fixture = await prepareLiveRelease('Reject')
      const product = await pool.query<{id: string}>('SELECT id FROM products WHERE release_id = $1', [fixture.release.id])
      const buyerId = crypto.randomUUID()
      await pool.query(`INSERT INTO users (id, email, account_intent) VALUES ($1, $2, 'consumer')`, [buyerId, `reject-${buyerId.slice(0, 8)}@example.test`])
      let rejectTransfers = true
      let transferCalls = 0
      vi.stubGlobal('fetch', vi.fn(async (input: string) => {
        const url = String(input)
        const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status})
        if (url.includes('/v1/checkout/sessions')) return reply({id: `cs_${crypto.randomUUID()}`, url: 'https://checkout.stripe.test'})
        if (url.includes('/v1/payment_intents/')) return reply({id: 'pi_reject', status: 'succeeded', latest_charge: {id: `ch_${crypto.randomUUID()}`, balance_transaction: {id: 'txn_1', fee: 59}}})
        if (url.endsWith('/v1/transfers')) {
          transferCalls += 1
          return rejectTransfers
            ? reply({error: {message: 'Insufficient capabilities for transfer', code: 'insufficient_capabilities_for_transfer'}}, 400)
            : reply({id: `tr_${crypto.randomUUID()}`})
        }
        throw new Error(`Unexpected Stripe call ${url}`)
      }))
      const commerce = new CommerceService(new Database(connectionString!, pool) as never, 'sk_test', 1000)
      const checkout = await commerce.createCheckout(buyerId, product.rows[0].id, 'https://app.test')
      const attempt = await pool.query<{id: string}>('SELECT id FROM marketplace_checkout_attempts WHERE stripe_checkout_session_id = $1', [checkout.sessionId])
      const {orderId} = await commerce.fulfillPaidSession({
        id: checkout.sessionId, payment_status: 'paid', payment_intent: 'pi_reject', amount_total: 999, currency: 'usd',
        metadata: {kind: 'marketplace_purchase', attemptId: attempt.rows[0].id, userId: buyerId, productId: product.rows[0].id},
      })
      const failed = await pool.query<{transfer_status: string}>('SELECT transfer_status FROM marketplace_orders WHERE id = $1', [orderId])
      expect(failed.rows[0].transfer_status).toBe('failed')
      const incidents = await pool.query<{details: {code: string}}>(`SELECT details FROM marketplace_operational_incidents WHERE order_id = $1 AND incident_type = 'transfer_failed'`, [orderId])
      expect(incidents.rows).toHaveLength(1)
      expect(incidents.rows[0].details.code).toBe('insufficient_capabilities_for_transfer')
      const purchases = await commerce.listPurchases(buyerId) as Array<{entitlement_status: string}>
      expect(purchases[0].entitlement_status).toBe('active')

      // A second failing retry does not duplicate the incident; a successful one pays out.
      await commerce.retryPendingTransfers({providerId: fixture.provider.id})
      rejectTransfers = false
      const retry = await commerce.retryPendingTransfers({providerId: fixture.provider.id})
      expect(retry).toEqual({attempted: 1, transferred: 1, failed: 0})
      const paid = await pool.query<{transfer_status: string}>('SELECT transfer_status FROM marketplace_orders WHERE id = $1', [orderId])
      expect(paid.rows[0].transfer_status).toBe('transferred')
      const incidentCount = await pool.query<{count: number}>(`SELECT COUNT(*)::integer AS count FROM marketplace_operational_incidents WHERE order_id = $1`, [orderId])
      expect(incidentCount.rows[0].count).toBe(1)
      expect(transferCalls).toBe(3)
    })

    it('blocks checkout while the artist Stripe account cannot receive transfers', async () => {
      await resetIsrcState()
      const fixture = await prepareLiveRelease('Restricted')
      const product = await pool.query<{id: string}>('SELECT id FROM products WHERE release_id = $1', [fixture.release.id])
      const buyerId = crypto.randomUUID()
      await pool.query(`INSERT INTO users (id, email, account_intent) VALUES ($1, $2, 'consumer')`, [buyerId, `restricted-${buyerId.slice(0, 8)}@example.test`])
      await pool.query(`UPDATE provider_profiles SET stripe_payouts_enabled = FALSE, stripe_transfers_status = 'inactive' WHERE id = $1`, [fixture.provider.id])
      const calls = stubStripe(59)
      const commerce = new CommerceService(new Database(connectionString!, pool) as never, 'sk_test', 1000)
      await expect(commerce.createCheckout(buyerId, product.rows[0].id, 'https://app.test')).rejects.toMatchObject({code: 'provider_payout_not_ready'})
      expect(calls).toHaveLength(0)
    })

    it('authorizes downloads only for the owner of an active purchase', async () => {
      const {commerce, order, buyerId} = await buyLiveRelease('Download', 59)
      const [purchase] = await commerce.listPurchases(buyerId) as Array<{entitlement_id: string; files: Array<{id: string}>}>
      const fileId = purchase.files[0].id
      await expect(commerce.getDownload(buyerId, purchase.entitlement_id, fileId)).resolves.toMatchObject({mimeType: 'audio/wav'})
      await expect(commerce.getDownload(crypto.randomUUID(), purchase.entitlement_id, fileId)).rejects.toMatchObject({code: 'download_not_found'})
      await commerce.handleRefund({id: order.stripe_charge_id, amount: 999, amount_refunded: 999})
      await expect(commerce.getDownload(buyerId, purchase.entitlement_id, fileId)).rejects.toMatchObject({code: 'download_not_found'})
    })

    it('reports reconciled marketplace finances to admins only', async () => {
      const {order, fixture} = await buyLiveRelease('Finance', 59)
      const finance = new MarketplaceFinanceService(new Database(connectionString!, pool) as never)
      await expect(finance.getSummary(reviewerUserId, {})).rejects.toMatchObject({code: 'marketplace_admin_required'})
      const summary = await finance.getSummary(adminUserId, {providerId: fixture.provider.id})
      expect(summary.totals).toMatchObject({
        orders: 1, grossSalesMinor: 999, platformCommissionMinor: 100, processingFeesRecoveredMinor: 59,
        artistAllocationMinor: 840, stripeFeesMinor: 59, netPlatformRevenueMinor: 100, refundsMinor: 0,
      })
      expect(summary.transactions[0]).toMatchObject({orderId: order.id, grossMinor: 999, platformCommissionMinor: 100})
      const today = new Date().toISOString().slice(0, 10)
      const filtered = await finance.getSummary(adminUserId, {providerId: fixture.provider.id, from: '2000-01-01', to: '2000-01-02'})
      expect(filtered.totals.orders).toBe(0)
      const dated = await finance.getSummary(adminUserId, {providerId: fixture.provider.id, from: today, to: today, paymentStatus: 'paid'})
      expect(dated.totals.orders).toBe(1)
      expect(summary.byProvider).toEqual([expect.objectContaining({providerId: fixture.provider.id, orders: 1, grossMinor: 999, artistEarningsMinor: 840})])
      expect(summary.transactions[0]).toMatchObject({providerId: fixture.provider.id})
    })

    it('opens one order with everything recorded about it, and exports orders, for admins only', async () => {
      const {order, fixture, commerce, buyerId} = await buyLiveRelease('FinanceDetail', 59)
      const finance = new MarketplaceFinanceService(new Database(connectionString!, pool) as never)
      const [purchase] = await commerce.listPurchases(buyerId) as Array<{entitlement_id: string; files: Array<{id: string}>}>
      await commerce.getDownload(buyerId, purchase.entitlement_id, purchase.files[0].id)
      await pool.query(
        `INSERT INTO marketplace_download_events (id, entitlement_id, entitlement_file_id, buyer_user_id) VALUES ($1, $2, $3, $4)`,
        [crypto.randomUUID(), purchase.entitlement_id, purchase.files[0].id, buyerId],
      )

      await expect(finance.getOrderDetail(reviewerUserId, order.id)).rejects.toMatchObject({code: 'marketplace_admin_required'})
      await expect(finance.getOrderDetail(adminUserId, crypto.randomUUID())).rejects.toMatchObject({code: 'order_not_found'})
      const detail = await finance.getOrderDetail(adminUserId, order.id)
      expect(detail.order).toMatchObject({
        id: order.id, provider_profile_id: fixture.provider.id, gross_amount_minor: 999, platform_commission_minor: 100,
        processing_fees_recovered_minor: 59, artist_earnings_minor: 840, payment_status: 'paid', guest_checkout: false,
        buyer_user_id: buyerId, buyer_account_email: expect.stringContaining('@'), stripe_charge_id: order.stripe_charge_id,
      })
      expect(detail.items).toEqual([expect.objectContaining({release_id: fixture.release.id, unit_amount_minor: 999})])
      expect(detail.entitlements).toEqual([expect.objectContaining({id: purchase.entitlement_id, status: 'active', file_count: 1, download_count: expect.any(Number)})])
      expect(Number(detail.entitlements[0].download_count)).toBeGreaterThanOrEqual(1)
      expect(detail.ledger.map((transaction) => transaction.transaction_type)).toContain('sale')
      const sale = detail.ledger.find((transaction) => transaction.transaction_type === 'sale') as {entries: Array<{account: string; debitMinor: number; creditMinor: number}>}
      // The sale's double entry balances.
      expect(sale.entries.reduce((sum, entry) => sum + entry.debitMinor - entry.creditMinor, 0)).toBe(0)

      await expect(finance.exportCsv(reviewerUserId, {})).rejects.toMatchObject({code: 'marketplace_admin_required'})
      const csv = await finance.exportCsv(adminUserId, {providerId: fixture.provider.id})
      expect(csv.fileName).toMatch(/^mejay-sales-.*\.csv$/)
      const lines = csv.data.trimEnd().split('\n')
      expect(lines[0]).toMatch(/^order_id,paid_at_utc,artist_account/)
      expect(lines.slice(1).some((line) => line.startsWith(`${order.id},`) && line.includes(',9.99,1.00,0.59,8.40,8.40,'))).toBe(true)
    })

    it('sells a single song end to end: price, store, checkout, fulfillment, payout, reporting, takedown', async () => {
      await resetIsrcState()
      const fixture = await prepareLiveRelease('Song', {songPriceMinor: 349})
      const songProduct = await pool.query<{id: string; active: boolean}>('SELECT id, active FROM products WHERE track_id = $1', [fixture.track.id])
      expect(songProduct.rows[0].active).toBe(true)

      // Artist can no longer change the song price once the release is live.
      await expect(service.setTrackPrice(fixture.userId, fixture.track.id, {amountMinor: 399})).rejects.toMatchObject({code: 'release_locked'})

      // Store shows the song offer next to the release offer.
      const store = new StoreService(new Database(connectionString!, pool) as never)
      const detail = await store.getRelease(fixture.release.id) as {release: {amount_minor: number}; tracks: Array<{id: string; product_id: string | null; amount_minor: number | null}>}
      expect(detail.release.amount_minor).toBe(999)
      expect(detail.tracks[0]).toMatchObject({id: fixture.track.id, product_id: songProduct.rows[0].id, amount_minor: 349})

      const buyerId = crypto.randomUUID()
      await pool.query(`INSERT INTO users (id, email, account_intent) VALUES ($1, $2, 'consumer')`, [buyerId, `song-${buyerId.slice(0, 8)}@example.test`])
      const calls = stubStripe(40)
      const commerce = new CommerceService(new Database(connectionString!, pool) as never, 'sk_test', 1000)
      const checkout = await commerce.createCheckout(buyerId, songProduct.rows[0].id, 'https://app.test')
      const sessionCall = calls.find((call) => call.url.endsWith('/v1/checkout/sessions'))
      expect(sessionCall?.body?.get('line_items[0][price_data][unit_amount]')).toBe('349')
      expect(sessionCall?.body?.get('line_items[0][price_data][product_data][name]')).toBe('Song Track')
      expect(sessionCall?.body?.get('metadata[trackId]')).toBe(fixture.track.id)

      const attempt = await pool.query<{id: string; release_id: string}>('SELECT id, release_id FROM marketplace_checkout_attempts WHERE stripe_checkout_session_id = $1', [checkout.sessionId])
      expect(attempt.rows[0].release_id).toBe(fixture.release.id)
      const {orderId} = await commerce.fulfillPaidSession({
        id: checkout.sessionId, payment_status: 'paid', payment_intent: `pi_${crypto.randomUUID()}`, amount_total: 349, currency: 'usd', livemode: false,
        metadata: {kind: 'marketplace_purchase', attemptId: attempt.rows[0].id, userId: buyerId, productId: songProduct.rows[0].id},
      })
      // $3.49 at 10%: 35¢ commission + 40¢ Stripe fee retained; artist receives 274¢.
      const order = await pool.query('SELECT gross_amount_minor, platform_fee_minor, provider_proceeds_minor, transfer_status FROM marketplace_orders WHERE id = $1', [orderId])
      expect(order.rows[0]).toEqual({gross_amount_minor: 349, platform_fee_minor: 75, provider_proceeds_minor: 274, transfer_status: 'transferred'})
      expect(calls.find((call) => call.url.endsWith('/v1/transfers'))?.body?.get('amount')).toBe('274')
      const allocations = await pool.query<{track_id: string; amount_minor: number}>('SELECT track_id, amount_minor FROM marketplace_split_allocations WHERE order_id = $1 ORDER BY amount_minor DESC', [orderId])
      expect(allocations.rows.map((row) => row.amount_minor).reduce((sum, value) => sum + value, 0)).toBe(274)
      expect(new Set(allocations.rows.map((row) => row.track_id))).toEqual(new Set([fixture.track.id]))

      const [purchase] = await commerce.listPurchases(buyerId) as Array<{entitlement_id: string; track_id: string | null; product_name: string; files: Array<{id: string; trackId: string}>}>
      expect(purchase).toMatchObject({track_id: fixture.track.id, product_name: 'Song Track'})
      expect(purchase.files.map((file) => file.trackId)).toEqual([fixture.track.id])
      await expect(commerce.getDownload(buyerId, purchase.entitlement_id, purchase.files[0].id)).resolves.toMatchObject({mimeType: 'audio/wav'})

      // Already owned: the song again is refused; a buyer who owns the release cannot buy the song.
      await expect(commerce.createCheckout(buyerId, songProduct.rows[0].id, 'https://app.test')).rejects.toMatchObject({code: 'already_owned'})

      const report = await new MarketplaceReportingService(new Database(connectionString!, pool) as never).getProviderReport(fixture.userId, 'all')
      expect(report.transactions.find((row) => row.orderId === orderId)).toMatchObject({songTitle: 'Song Track', releaseTitle: 'Song Release', priceMinor: 349, earningsMinor: 274})
      const finance = await new MarketplaceFinanceService(new Database(connectionString!, pool) as never).getSummary(adminUserId, {providerId: fixture.provider.id})
      expect(finance.transactions[0]).toMatchObject({orderId, songTitle: 'Song Track', grossMinor: 349})

      // Taking the release down stops song sales too.
      await adminService().commandRelease(adminUserId, fixture.release.id, {action: 'takedown', expectedVersion: fixture.version, note: 'Rights claim'})
      const afterTakedown = await pool.query<{active: boolean}>('SELECT active FROM products WHERE track_id = $1', [fixture.track.id])
      expect(afterTakedown.rows[0].active).toBe(false)
      const otherBuyer = crypto.randomUUID()
      await pool.query(`INSERT INTO users (id, email, account_intent) VALUES ($1, $2, 'consumer')`, [otherBuyer, `song2-${otherBuyer.slice(0, 8)}@example.test`])
      await expect(commerce.createCheckout(otherBuyer, songProduct.rows[0].id, 'https://app.test')).rejects.toMatchObject({code: 'product_not_found'})
    })

    it('refuses a song checkout to a buyer who already owns the release', async () => {
      const {commerce, buyerId, fixture} = await buyLiveRelease('Owner', 59)
      // Song products can only be priced before submission, so add one directly for this check.
      const productId = crypto.randomUUID()
      await pool.query(`INSERT INTO products (id, provider_profile_id, track_id, name) VALUES ($1, $2, $3, 'Owner Track')`, [productId, fixture.provider.id, fixture.track.id])
      await pool.query(`INSERT INTO prices (id, product_id, amount_minor, currency) VALUES ($1, $2, 349, 'USD')`, [crypto.randomUUID(), productId])
      await expect(commerce.createCheckout(buyerId, productId, 'https://app.test')).rejects.toMatchObject({code: 'already_owned'})
    })

    it('lets the artist set and remove a song price while the release is a draft', async () => {
      const {userId, track} = await createProviderFixture('Draft')
      await service.setTrackPrice(userId, track.id, {amountMinor: 300})
      await service.setTrackPrice(userId, track.id, {amountMinor: 450})
      const active = await pool.query<{amount_minor: number}>(
        `SELECT price.amount_minor FROM prices price JOIN products product ON product.id = price.product_id
         WHERE product.track_id = $1 AND price.active = TRUE`, [track.id])
      expect(active.rows).toEqual([{amount_minor: 450}])
      await expect(service.clearTrackPrice(userId, track.id)).resolves.toEqual({cleared: true})
      const none = await pool.query<{count: number}>(
        `SELECT COUNT(*)::integer AS count FROM prices price JOIN products product ON product.id = price.product_id
         WHERE product.track_id = $1 AND price.active = TRUE`, [track.id])
      expect(none.rows[0].count).toBe(0)
      await expect(service.setTrackPrice(crypto.randomUUID(), track.id, {amountMinor: 300})).rejects.toBeTruthy()
    })

    it('pays out held transfers once a suspended provider is reinstated', async () => {
      const {commerce, order} = await buyLiveRelease('Held', 59)
      await pool.query(`UPDATE marketplace_orders SET transfer_status = 'pending', stripe_transfer_id = NULL WHERE id = $1`, [order.id])
      const result = await commerce.retryPendingTransfers({providerId: order.provider_profile_id})
      expect(result).toEqual({attempted: 1, transferred: 1, failed: 0})
      const updated = await pool.query('SELECT transfer_status FROM marketplace_orders WHERE id = $1', [order.id])
      expect(updated.rows[0].transfer_status).toBe('transferred')
    })
  })

  describe('follow-up store flows', () => {
    afterEach(() => {
      vi.unstubAllGlobals()
    })

    it('sets and replaces a release price atomically', async () => {
      const {userId, release} = await createProviderFixture('Pricing')
      await service.setReleasePrice(userId, release.id, {name: 'Pricing Download', amountMinor: 399})
      await service.setReleasePrice(userId, release.id, {name: 'Pricing Download', amountMinor: 499})
      const rows = await pool.query<{products: number; active_prices: number; amount: number}>(
        `SELECT COUNT(DISTINCT product.id)::integer AS products,
          COUNT(price.id) FILTER (WHERE price.active)::integer AS active_prices,
          MAX(price.amount_minor) FILTER (WHERE price.active) AS amount
         FROM products product LEFT JOIN prices price ON price.product_id = product.id
         WHERE product.release_id = $1`,
        [release.id],
      )
      expect(rows.rows[0]).toEqual({products: 1, active_prices: 1, amount: 499})
    })

    it('publishes due scheduled releases and restores takedowns to approved', async () => {
      await resetIsrcState()
      const fixture = await prepareLiveRelease('Schedule')
      const admin = adminService()
      const unpublished = await admin.commandRelease(adminUserId, fixture.release.id, {action: 'unpublish', expectedVersion: fixture.version}) as {version: number}
      const scheduled = await admin.commandRelease(adminUserId, fixture.release.id, {
        action: 'schedule', expectedVersion: unpublished.version, scheduledReleaseAt: new Date(Date.now() + 60_000).toISOString(),
      }) as {version: number}
      await pool.query(`UPDATE releases SET scheduled_release_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE id = $1`, [fixture.release.id])
      const result = await admin.publishDueReleases()
      expect(result.published).toContain(fixture.release.id)
      const live = await pool.query<{status: string; version: number}>('SELECT status, version FROM releases WHERE id = $1', [fixture.release.id])
      expect(live.rows[0].status).toBe('LIVE')
      expect(live.rows[0].version).toBeGreaterThan(scheduled.version)

      const takenDown = await admin.commandRelease(adminUserId, fixture.release.id, {action: 'takedown', expectedVersion: live.rows[0].version, note: 'Rights claim'}) as {version: number}
      const restored = await admin.commandRelease(adminUserId, fixture.release.id, {action: 'restore', expectedVersion: takenDown.version, note: 'Claim withdrawn'}) as {status: string}
      expect(restored.status).toBe('APPROVED')
      const takedown = await pool.query<{restored_at: string | null}>('SELECT restored_at FROM release_takedowns WHERE release_id = $1', [fixture.release.id])
      expect(takedown.rows[0].restored_at).not.toBeNull()
    })

    it('reuses an open checkout session instead of creating a second one', async () => {
      await resetIsrcState()
      const fixture = await prepareLiveRelease('Reuse')
      const product = await pool.query<{id: string}>('SELECT id FROM products WHERE release_id = $1', [fixture.release.id])
      const buyerId = crypto.randomUUID()
      await pool.query(`INSERT INTO users (id, email, account_intent) VALUES ($1, $2, 'consumer')`, [buyerId, `reuse-${buyerId.slice(0, 8)}@example.test`])
      let created = 0
      vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input)
        if (url.includes('/v1/checkout/sessions') && init?.method === 'POST') {
          created += 1
          return new Response(JSON.stringify({id: `cs_reuse_${created}`, url: 'https://checkout.stripe.test/1'}), {status: 200})
        }
        if (url.includes('/v1/checkout/sessions/')) {
          return new Response(JSON.stringify({id: 'cs_reuse_1', url: 'https://checkout.stripe.test/1', status: 'open'}), {status: 200})
        }
        throw new Error(`Unexpected Stripe call ${url}`)
      }))
      const commerce = new CommerceService(new Database(connectionString!, pool) as never, 'sk_test', 1000)
      const first = await commerce.createCheckout(buyerId, product.rows[0].id, 'https://app.test')
      const second = await commerce.createCheckout(buyerId, product.rows[0].id, 'https://app.test')
      expect(second.sessionId).toBe(first.sessionId)
      expect(created).toBe(1)
    })

    it('creates Connect accounts with controller properties for the signed-in artist only', async () => {
      const {userId, provider} = await createProviderFixture('Onboard')
      await pool.query(`UPDATE provider_profiles SET stripe_account_id = NULL, stripe_details_submitted = FALSE,
        stripe_payouts_enabled = FALSE, stripe_transfers_status = 'inactive' WHERE id = $1`, [provider.id])
      const bodies: URLSearchParams[] = []
      vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input)
        if (init?.body instanceof URLSearchParams) bodies.push(init.body)
        if (url.endsWith('/v1/accounts')) return new Response(JSON.stringify({id: `acct_new_${provider.id.slice(0, 8)}`, details_submitted: false, capabilities: {transfers: 'inactive'}}), {status: 200})
        if (url.endsWith('/v1/account_links')) return new Response(JSON.stringify({url: 'https://connect.stripe.test/onboarding'}), {status: 200})
        throw new Error(`Unexpected Stripe call ${url}`)
      }))
      const connect = new ConnectService(new Database(connectionString!, pool) as never, 'sk_test')
      const result = await connect.createOnboardingLink(userId, 'https://app.test')
      expect(result.url).toBe('https://connect.stripe.test/onboarding')
      expect(result.status.onboardingStatus).toBe('onboarding_required')
      const account = bodies[0]
      expect(account.get('type')).toBeNull()
      expect(account.get('controller[stripe_dashboard][type]')).toBe('express')
      expect(account.get('controller[losses][payments]')).toBe('application')
      expect(account.get('capabilities[transfers][requested]')).toBe('true')
      expect(bodies[1].get('return_url')).toBe('https://app.test/app/artist?section=payout&connect=return')
      const audits = await pool.query<{action: string}>(`SELECT action FROM marketplace_audit_events WHERE provider_profile_id = $1 AND entity_type = 'stripe_account' ORDER BY occurred_at`, [provider.id])
      expect(audits.rows.map((row) => row.action)).toEqual(expect.arrayContaining(['stripe_account.created', 'stripe_account.onboarding_started']))

      // A viewer on the artist account cannot start onboarding; a user with no artist account has
      // nothing to connect (no request can name another artist's account).
      const viewerId = crypto.randomUUID()
      await pool.query(`INSERT INTO users (id, email, account_intent) VALUES ($1, $2, 'provider')`, [viewerId, `viewer-${viewerId.slice(0, 8)}@example.test`])
      await pool.query(`INSERT INTO provider_members (provider_profile_id, user_id, role) VALUES ($1, $2, 'viewer')`, [provider.id, viewerId])
      await expect(connect.createOnboardingLink(viewerId, 'https://app.test')).rejects.toMatchObject({code: 'provider_admin_required'})
      await expect(connect.createOnboardingLink(crypto.randomUUID(), 'https://app.test')).rejects.toMatchObject({code: 'provider_not_found'})
    })

    it('deletes a provider that only has abandoned checkouts', async () => {
      await resetIsrcState()
      const fixture = await prepareLiveRelease('Leaver')
      const product = await pool.query<{id: string}>('SELECT id FROM products WHERE release_id = $1', [fixture.release.id])
      await pool.query(
        `INSERT INTO marketplace_checkout_attempts
          (id, buyer_user_id, provider_profile_id, product_id, release_id, amount_minor, currency, platform_fee_bps,
           stripe_idempotency_key, transfer_group, snapshot, expires_at)
         VALUES ($1, NULL, $2, $3, $4, 999, 'USD', 1000, $5, $6, '{}'::jsonb, CURRENT_TIMESTAMP)`,
        [crypto.randomUUID(), fixture.provider.id, product.rows[0].id, fixture.release.id, `idem-${crypto.randomUUID()}`, `tg-${crypto.randomUUID()}`],
      )
      await pool.query(
        `UPDATE entitlements SET access_type = 'free', has_full_access = 0, stripe_subscription_id = NULL, subscription_status = 'canceled' WHERE user_id = $1`,
        [fixture.userId],
      )
      const {storageKeys} = await new AccountDeletionService(new Database(connectionString!, pool) as never).deleteCurrentUser({
        userId: fixture.userId,
        email: `leaver-${fixture.userId.slice(0, 8)}@example.test`,
        forfeitFullProgram: false,
      })
      expect(Array.isArray(storageKeys)).toBe(true)
      const remaining = await pool.query<{count: number}>('SELECT COUNT(*)::integer AS count FROM provider_profiles WHERE id = $1', [fixture.provider.id])
      expect(remaining.rows[0].count).toBe(0)
    })
  })
  describe('artist profiles and release certification', () => {
    it('lists and exports only the signed-in account\'s own ISRCs', async () => {
      await resetIsrcState()
      const mine = await prepareLiveRelease('IsrcMine')
      const theirs = await prepareLiveRelease('IsrcTheirs')
      const isrcs = new ProviderIsrcService(new Database(connectionString!, pool) as never)
      const rows = await isrcs.list(mine.userId)
      expect(rows).toHaveLength(1)
      expect(rows[0]).toMatchObject({track_title: 'IsrcMine Track', release_id: mine.release.id, release_title: 'IsrcMine Release', assignment_type: 'MEJAY_ASSIGNED'})
      expect(rows[0].isrc).toMatch(/^QT-A3L-\d{2}-\d{5}$/)
      const theirRows = await isrcs.list(theirs.userId)
      expect(theirRows).toHaveLength(1)
      expect(theirRows[0].isrc).not.toBe(rows[0].isrc)

      const csv = await isrcs.exportCsv(mine.userId)
      expect(csv.fileName).toMatch(/^mejay-isrcs-\d{4}-\d{2}-\d{2}\.csv$/)
      const lines = csv.data.trim().split('\n')
      expect(lines[0]).toBe('ISRC,Track,Artist,Release,Source,Status,Assigned')
      expect(lines).toHaveLength(2)
      expect(lines[1]).toContain(rows[0].isrc)
      expect(lines[1]).toContain('Issued by MeJay')
      expect(csv.data).not.toContain(theirRows[0].isrc)
      // No artist account: refused rather than returning anything.
      await expect(isrcs.list(crypto.randomUUID())).rejects.toMatchObject({status: 403})
    })

    it('saves account settings for owners only, without touching review status or the page address', async () => {
      const fixture = await createProviderFixture('Settings')
      const before = await pool.query<{slug: string; status: string}>('SELECT slug, status FROM provider_profiles WHERE id = $1', [fixture.provider.id])
      // Parsed with the route's schema, exactly as the API applies it.
      const saved = await service.updateProviderSettings(fixture.userId, providerSettingsSchema.parse({
        displayName: 'Settings Music', legalName: 'Settings Music LLC', contactEmail: 'Team@Example.TEST', countryCode: 'ca', bio: '',
      })) as Record<string, unknown>
      expect(() => providerSettingsSchema.parse({displayName: 'X', legalName: null, contactEmail: 'x@example.test', countryCode: 'US', bio: null, slug: 'taken'})).toThrow()
      expect(saved).toMatchObject({display_name: 'Settings Music', legal_name: 'Settings Music LLC', contact_email: 'team@example.test', country_code: 'CA', bio: null, role: 'owner'})
      const after = await pool.query<{slug: string; status: string}>('SELECT slug, status FROM provider_profiles WHERE id = $1', [fixture.provider.id])
      expect(after.rows[0]).toEqual(before.rows[0])
      const audits = await pool.query(`SELECT 1 FROM marketplace_audit_events WHERE provider_profile_id = $1 AND action = 'provider.settings_updated'`, [fixture.provider.id])
      expect(audits.rowCount).toBe(1)

      // A viewer on the account cannot change them; a user with no account gets nothing.
      await pool.query(`UPDATE provider_members SET role = 'viewer' WHERE user_id = $1`, [fixture.userId])
      await expect(service.updateProviderSettings(fixture.userId, {displayName: 'Hijack', legalName: null, contactEmail: 'x@example.test', countryCode: 'US', bio: null}))
        .rejects.toMatchObject({code: 'provider_write_forbidden'})
      await pool.query(`UPDATE provider_members SET role = 'editor' WHERE user_id = $1`, [fixture.userId])
      await expect(service.updateProviderSettings(fixture.userId, {displayName: 'Hijack', legalName: null, contactEmail: 'x@example.test', countryCode: 'US', bio: null}))
        .rejects.toMatchObject({code: 'provider_settings_forbidden'})
      await expect(service.updateProviderSettings(crypto.randomUUID(), {displayName: 'Nobody', legalName: null, contactEmail: 'x@example.test', countryCode: 'US', bio: null}))
        .rejects.toMatchObject({status: 403})
      expect((await pool.query('SELECT display_name FROM provider_profiles WHERE id = $1', [fixture.provider.id])).rows[0].display_name).toBe('Settings Music')
    })

    afterEach(() => {
      vi.unstubAllGlobals()
    })

    const submission = () => new ReleaseSubmissionService(new Database(connectionString!, pool) as never)
    const profiles = () => new ArtistProfileService(new Database(connectionString!, pool) as never)
    const isrcConfig = {prefix: 'QTA3L', countryCode: 'QT', registrantCode: 'A3L'} as const
    const CORE_KEYS = ['original_recording', 'beat_rights', 'distribution_rights', 'collaborators_authorized', 'information_accurate', 'platform_authorization'] as const

    async function review(releaseId: string, version: number) {
      return adminService().commandRelease(reviewerUserId, releaseId, {action: 'start_review', expectedVersion: version}) as Promise<{version: number}>
    }

    it('blocks submission until every certification is accepted, then snapshots it immutably', async () => {
      await resetIsrcState()
      const fixture = await prepareLiveRelease('Cert', {stage: 'pricing'})
      await expect(service.submitRelease(fixture.userId, fixture.release.id, {expectedVersion: fixture.version}))
        .rejects.toMatchObject({code: 'release_prerequisites_unmet', details: expect.arrayContaining(['rights certification'])})
      await expect(submission().saveCertification(fixture.userId, fixture.release.id, {version: CERTIFICATION_VERSION, thirdPartyMaterial: 'none', accepted: ['original_recording', 'beat_rights']}))
        .rejects.toMatchObject({code: 'certification_incomplete'})

      await certifyRelease(fixture.userId, fixture.release.id)
      const submitted = await service.submitRelease(fixture.userId, fixture.release.id, {expectedVersion: fixture.version}, {ipHash: 'hash', userAgent: 'vitest'}) as {status: string; certification_id: string}
      expect(submitted.status).toBe('SUBMITTED')
      const certification = await pool.query('SELECT * FROM release_certifications WHERE id = $1', [submitted.certification_id])
      expect(certification.rows[0]).toMatchObject({
        certification_version: CERTIFICATION_VERSION, third_party_material: 'none', rights_status: 'CERTIFIED_ORIGINAL',
        certified_by_user_id: fixture.userId, primary_artist_id: fixture.artist.id, ip_hash: 'hash', user_agent: 'vitest',
      })
      // The track already has an ISRC, so the ISRC statement is not part of this certification.
      expect(certification.rows[0].accepted_certifications.map((statement: {key: string}) => statement.key)).toEqual([...CORE_KEYS])
      expect(certification.rows[0].accepted_certifications[0].text).toContain('no unauthorized samples')
      expect(certification.rows[0].release_snapshot.primaryArtist.name).toBe('Cert Artist')
      const release = await pool.query('SELECT rights_status, certification_draft FROM releases WHERE id = $1', [fixture.release.id])
      expect(release.rows[0]).toEqual({rights_status: 'CERTIFIED_ORIGINAL', certification_draft: null})

      await expect(pool.query(`UPDATE release_certifications SET rights_status = 'RIGHTS_CLEARED' WHERE id = $1`, [submitted.certification_id])).rejects.toThrow(/immutable/)
      await expect(pool.query('DELETE FROM release_certifications WHERE id = $1', [submitted.certification_id])).rejects.toThrow(/immutable/)
      // Later profile edits never rewrite the historical snapshot.
      await profiles().updateProfile(fixture.userId, fixture.artist.id, {name: 'Renamed Artist', genres: [], links: {}})
      const unchanged = await pool.query('SELECT release_snapshot FROM release_certifications WHERE id = $1', [submitted.certification_id])
      expect(unchanged.rows[0].release_snapshot.primaryArtist.name).toBe('Cert Artist')
    })

    it('requires an explicit rights decision before approving licensed material without documents', async () => {
      await resetIsrcState()
      const fixture = await prepareLiveRelease('Licensed', {stage: 'pricing'})
      await expect(certifyRelease(fixture.userId, fixture.release.id, 'licensed')).rejects.toMatchObject({code: 'certification_incomplete'})
      await submission().addRightsMaterial(fixture.userId, fixture.release.id, {
        materialType: 'leased_beat', licensorName: 'Beat Co', description: 'Non-exclusive lease of the instrumental', licenseType: 'non_exclusive_lease',
      })
      await certifyRelease(fixture.userId, fixture.release.id, 'licensed')
      const submitted = await service.submitRelease(fixture.userId, fixture.release.id, {expectedVersion: fixture.version}) as {version: number; rights_status: string}
      const rights = await pool.query('SELECT rights_status FROM releases WHERE id = $1', [fixture.release.id])
      expect(rights.rows[0].rights_status).toBe('RIGHTS_REVIEW_REQUIRED')

      const reviewing = await review(fixture.release.id, submitted.version)
      await expect(adminService().commandRelease(reviewerUserId, fixture.release.id, {action: 'approve', expectedVersion: reviewing.version}))
        .rejects.toMatchObject({code: 'rights_review_required'})
      const cleared = await adminService().commandRelease(reviewerUserId, fixture.release.id, {action: 'clear_rights', expectedVersion: reviewing.version, note: 'Lease agreement reviewed'}) as {version: number; status: string; rights_status: string}
      expect(cleared).toMatchObject({status: 'UNDER_REVIEW', rights_status: 'RIGHTS_CLEARED'})
      const approved = await adminService().commandRelease(reviewerUserId, fixture.release.id, {action: 'approve', expectedVersion: cleared.version}) as {status: string}
      expect(approved.status).toBe('APPROVED')
      const events = await pool.query<{decision: string}>('SELECT decision FROM release_review_events WHERE release_id = $1 ORDER BY created_at', [fixture.release.id])
      expect(events.rows.map((row) => row.decision)).toEqual(['review_started', 'rights_cleared', 'approved'])
    })

    it('returns flagged rights to the artist and requires a fresh certification', async () => {
      await resetIsrcState()
      const fixture = await prepareLiveRelease('Unsure', {stage: 'pricing'})
      await certifyRelease(fixture.userId, fixture.release.id, 'unsure')
      const submitted = await service.submitRelease(fixture.userId, fixture.release.id, {expectedVersion: fixture.version}) as {version: number}
      const reviewing = await review(fixture.release.id, submitted.version)
      const flagged = await adminService().commandRelease(reviewerUserId, fixture.release.id, {action: 'flag_rights', expectedVersion: reviewing.version, note: 'The hook samples a commercial recording'}) as {version: number; status: string; rights_status: string}
      expect(flagged).toMatchObject({status: 'CHANGES_REQUESTED', rights_status: 'RIGHTS_ISSUE_FLAGGED'})

      await expect(service.submitRelease(fixture.userId, fixture.release.id, {expectedVersion: flagged.version}))
        .rejects.toMatchObject({code: 'release_prerequisites_unmet', details: expect.arrayContaining(['rights certification'])})
      await certifyRelease(fixture.userId, fixture.release.id, 'none')
      await service.submitRelease(fixture.userId, fixture.release.id, {expectedVersion: flagged.version})
      const history = await pool.query<{third_party_material: string; rights_status: string}>(
        'SELECT third_party_material, rights_status FROM release_certifications WHERE release_id = $1 ORDER BY certified_at', [fixture.release.id])
      expect(history.rows).toEqual([
        {third_party_material: 'unsure', rights_status: 'RIGHTS_REVIEW_REQUIRED'},
        {third_party_material: 'none', rights_status: 'CERTIFIED_ORIGINAL'},
      ])
    })

    it('assigns MEJay ISRCs at approval for tracks submitted without one', async () => {
      await resetIsrcState()
      const fixture = await prepareLiveRelease('NoIsrc', {stage: 'pricing', skipIsrc: true})
      await expect(submission().saveCertification(fixture.userId, fixture.release.id, {version: CERTIFICATION_VERSION, thirdPartyMaterial: 'none', accepted: [...CORE_KEYS]}))
        .rejects.toMatchObject({code: 'certification_incomplete'})
      await certifyRelease(fixture.userId, fixture.release.id)
      const submitted = await service.submitRelease(fixture.userId, fixture.release.id, {expectedVersion: fixture.version}) as {version: number}
      const reviewing = await review(fixture.release.id, submitted.version)
      await expect(adminService().commandRelease(reviewerUserId, fixture.release.id, {action: 'approve', expectedVersion: reviewing.version}, {isrcConfig: null}))
        .rejects.toMatchObject({code: 'isrc_generation_unavailable'})
      const approved = await adminService().commandRelease(reviewerUserId, fixture.release.id, {action: 'approve', expectedVersion: reviewing.version}, {isrcConfig}) as {status: string}
      expect(approved.status).toBe('APPROVED')
      const assignment = await pool.query<{isrc: string; source: string; assigned_by_user_id: string; attested_by_user_id: string}>(
        `SELECT assignment.isrc, assignment.source, assignment.assigned_by_user_id, attestation.attested_by_user_id
         FROM isrc_assignments assignment
         JOIN isrc_registry registry ON registry.id = assignment.registry_id
         JOIN isrc_rights_certifications attestation ON attestation.id = registry.rights_certification_id
         WHERE assignment.track_id = $1 AND assignment.revoked_at IS NULL`, [fixture.track.id])
      expect(assignment.rows[0]).toMatchObject({source: 'agency', assigned_by_user_id: reviewerUserId, attested_by_user_id: fixture.userId})
      expect(assignment.rows[0].isrc).toMatch(/^QTA3L\d{7}$/)
    })

    it('never lets one artist account touch another account\'s profile, release, credits, or uploads', async () => {
      const owner = await createProviderFixture('OwnerA')
      const intruder = await createProviderFixture('OwnerB')
      const profileInput = {name: 'Hijacked', genres: [], links: {}}
      await expect(profiles().getProfile(intruder.userId, owner.artist.id)).rejects.toMatchObject({code: 'not_found'})
      await expect(profiles().updateProfile(intruder.userId, owner.artist.id, profileInput)).rejects.toMatchObject({code: 'not_found'})
      await expect(submission().saveCertification(intruder.userId, owner.release.id, {version: CERTIFICATION_VERSION, thirdPartyMaterial: 'none', accepted: [...CORE_KEYS, 'no_prior_isrc']}))
        .rejects.toMatchObject({code: 'not_found'})
      await expect(submission().addRightsMaterial(intruder.userId, owner.release.id, {materialType: 'sample', licensorName: 'X', description: 'Y', licenseType: 'sample_clearance'}))
        .rejects.toMatchObject({code: 'not_found'})
      await expect(submission().replaceTrackCredits(intruder.userId, owner.track.id, {featuredArtistIds: [], contributors: []})).rejects.toMatchObject({code: 'not_found'})
      // Linking another account's artist as a featured artist is refused too.
      await expect(submission().replaceTrackCredits(owner.userId, owner.track.id, {featuredArtistIds: [intruder.artist.id], contributors: []})).rejects.toMatchObject({code: 'not_found'})
      const bucket = {createUploadUrl: async () => 'https://upload.test', head: async () => null, getExact: async () => null}
      await expect(service.initiateUpload(intruder.userId, {kind: 'artist_photo', artistId: owner.artist.id, fileName: 'me.jpg', byteSize: 1000, mimeType: 'image/jpeg', width: 800, height: 800}, bucket as never))
        .rejects.toMatchObject({code: 'not_found'})
      // A ready photo that belongs to the owner cannot be attached to the intruder's artist.
      const photoId = crypto.randomUUID()
      await pool.query(
        `INSERT INTO marketplace_assets (id, provider_profile_id, artist_id, kind, storage_key, mime_type, byte_size, processing_status)
         VALUES ($1, $2, $3, 'artist_photo', $4, 'image/jpeg', 1000, 'ready')`,
        [photoId, owner.provider.id, owner.artist.id, `marketplace/${owner.provider.id}/artist_photo/${photoId}.jpg`],
      )
      await expect(profiles().updateProfile(intruder.userId, intruder.artist.id, {...profileInput, profilePhotoAssetId: photoId}))
        .rejects.toMatchObject({code: 'invalid_profile_image'})
      const ownerSlug = await pool.query<{slug: string}>('SELECT slug FROM artists WHERE id = $1', [owner.artist.id])
      await expect(profiles().updateProfile(intruder.userId, intruder.artist.id, {...profileInput, slug: ownerSlug.rows[0].slug}))
        .rejects.toMatchObject({code: 'slug_taken'})

      // The owner can do all of it.
      await submission().replaceTrackCredits(owner.userId, owner.track.id, {featuredArtistIds: [], contributors: [{name: 'Pen Writer', role: 'writer', publisherName: 'Pen Publishing'}]})
      const updated = await profiles().updateProfile(owner.userId, owner.artist.id, {name: 'OwnerA Artist', tagline: 'Hello', genres: ['House'], links: {instagram: 'https://instagram.com/ownera'}, profilePhotoAssetId: photoId})
      expect(updated).toMatchObject({tagline: 'Hello', profile_photo_asset_id: photoId, links: {instagram: 'https://instagram.com/ownera'}})
    })

    it('shows a public artist page while the artist has LIVE music or Stripe payouts, and never exposes rights documents', async () => {
      await resetIsrcState()
      const draft = await prepareLiveRelease('Hidden', {stage: 'pricing'})
      const hiddenSlug = (await pool.query<{slug: string}>('SELECT slug FROM artists WHERE id = $1', [draft.artist.id])).rows[0].slug
      const setPayouts = (providerId: string, ready: boolean) => pool.query(
        `UPDATE provider_profiles SET stripe_payouts_enabled = $2, stripe_transfers_status = $3 WHERE id = $1`,
        [providerId, ready, ready ? 'active' : 'inactive'],
      )
      // No LIVE music and no Stripe payouts: not public.
      await setPayouts(draft.provider.id, false)
      await expect(profiles().getPublicArtist(hiddenSlug)).rejects.toMatchObject({code: 'not_found'})
      // Connecting Stripe makes the page public before any music is live; the draft is not listed.
      await setPayouts(draft.provider.id, true)
      expect((await profiles().getPublicArtist(hiddenSlug)).releases).toEqual([])
      // Suspension hides it again whatever else is true.
      await pool.query('UPDATE provider_profiles SET suspended_at = CURRENT_TIMESTAMP WHERE id = $1', [draft.provider.id])
      await expect(profiles().getPublicArtist(hiddenSlug)).rejects.toMatchObject({code: 'not_found'})
      await pool.query('UPDATE provider_profiles SET suspended_at = NULL WHERE id = $1', [draft.provider.id])

      const live = await prepareLiveRelease('Shown')
      const slug = (await pool.query<{slug: string}>('SELECT slug FROM artists WHERE id = $1', [live.artist.id])).rows[0].slug
      await profiles().updateProfile(live.userId, live.artist.id, {name: 'Shown Artist', tagline: 'Live now', bio: 'Full biography', location: 'Detroit', genres: ['House'], links: {instagram: 'https://instagram.com/shown'}})
      // A second, unpublished release of the same artist must not appear.
      await service.createRelease(live.userId, {title: 'Unreleased Draft', releaseType: 'single', primaryArtistId: live.artist.id})
      const page = await profiles().getPublicArtist(slug)
      expect(page.artist).toMatchObject({name: 'Shown Artist', tagline: 'Live now', verified: true, links: {instagram: 'https://instagram.com/shown'}})
      expect(page.artist).not.toHaveProperty('provider_profile_id')
      expect((page.releases as Array<{id: string; artist_slug: string}>).map((release) => release.id)).toEqual([live.release.id])
      expect((page.releases as Array<{artist_slug: string}>)[0].artist_slug).toBe(slug)

      const store = new StoreService(new Database(connectionString!, pool) as never)
      const documentId = crypto.randomUUID()
      await pool.query(
        `INSERT INTO marketplace_assets (id, provider_profile_id, release_id, kind, storage_key, mime_type, byte_size, processing_status)
         VALUES ($1, $2, $3, 'rights_document', $4, 'application/pdf', 1000, 'ready')`,
        [documentId, live.provider.id, live.release.id, `marketplace/${live.provider.id}/rights_document/${documentId}.pdf`],
      )
      await expect(store.getAsset(documentId)).rejects.toMatchObject({code: 'not_found'})
      const photoId = crypto.randomUUID()
      await pool.query(
        `INSERT INTO marketplace_assets (id, provider_profile_id, artist_id, kind, storage_key, mime_type, byte_size, processing_status)
         VALUES ($1, $2, $3, 'artist_photo', $4, 'image/jpeg', 1000, 'ready')`,
        [photoId, live.provider.id, live.artist.id, `marketplace/${live.provider.id}/artist_photo/${photoId}.jpg`],
      )
      await expect(store.getAsset(photoId)).resolves.toMatchObject({mimeType: 'image/jpeg'})

      // With Stripe payouts off, the LIVE release alone keeps the page up...
      await setPayouts(live.provider.id, false)
      await expect(profiles().getPublicArtist(slug)).resolves.toMatchObject({artist: {name: 'Shown Artist'}})
      // ...and taking it down removes the page and its imagery.
      await adminService().commandRelease(adminUserId, live.release.id, {action: 'takedown', expectedVersion: live.version, note: 'Rights claim'})
      await expect(profiles().getPublicArtist(slug)).rejects.toMatchObject({code: 'not_found'})
      await expect(store.getAsset(photoId)).rejects.toMatchObject({code: 'not_found'})

      // The owner can still preview the hidden page and its imagery, and is told why it is hidden.
      const preview = await profiles().getOwnerPreview(live.userId, live.artist.id)
      expect(preview.artist).toMatchObject({name: 'Shown Artist'})
      expect(preview.artist).not.toHaveProperty('provider_profile_id')
      expect(preview.visibility).toEqual({public: false, suspended: false, payoutsReady: false, hasLiveRelease: false})
      await expect(profiles().getOwnedProfileImage(live.userId, live.artist.id, photoId)).resolves.toMatchObject({mimeType: 'image/jpeg'})
      // Rights documents are never served as profile images, even to the owner.
      await expect(profiles().getOwnedProfileImage(live.userId, live.artist.id, documentId)).rejects.toMatchObject({code: 'not_found'})
      // Another account can neither preview the page nor read its images.
      await expect(profiles().getOwnerPreview(draft.userId, live.artist.id)).rejects.toMatchObject({code: 'not_found'})
      await expect(profiles().getOwnedProfileImage(draft.userId, live.artist.id, photoId)).rejects.toMatchObject({code: 'not_found'})
      await setPayouts(live.provider.id, true)
      expect((await profiles().getOwnerPreview(live.userId, live.artist.id)).visibility).toEqual({public: true, suspended: false, payoutsReady: true, hasLiveRelease: false})
      await expect(store.getAsset(photoId)).resolves.toMatchObject({mimeType: 'image/jpeg'})
    })

    it('saves release-page fields and galleries for the owning artist only, exposing them only while the page is public', async () => {
      await resetIsrcState()
      const live = await prepareLiveRelease('PageOwner')
      const other = await prepareLiveRelease('PageIntruder')
      const draftRelease = await service.createRelease(live.userId, {title: 'Not Live', releaseType: 'single', primaryArtistId: live.artist.id}) as {id: string}
      const asset = async (owner: typeof live, kind: string, status = 'ready') => {
        const assetId = crypto.randomUUID()
        await pool.query(
          `INSERT INTO marketplace_assets (id, provider_profile_id, artist_id, kind, storage_key, mime_type, byte_size, processing_status)
           VALUES ($1, $2, $3, $4, $5, 'image/png', 1000, $6)`,
          [assetId, owner.provider.id, owner.artist.id, kind, `marketplace/${owner.provider.id}/${kind}/${assetId}.png`, status],
        )
        return assetId
      }
      const cutout = await asset(live, 'artist_cutout')
      const story = await asset(live, 'artist_photo')
      const galleryA = await asset(live, 'artist_gallery')
      const galleryB = await asset(live, 'artist_gallery')
      const pendingGallery = await asset(live, 'artist_gallery', 'pending')
      const foreignCutout = await asset(other, 'artist_cutout')
      const base = {name: 'Page Owner', genres: [], links: {booking: 'mailto:booking@example.test'}}

      const saved = await profiles().updateProfile(live.userId, live.artist.id, {
        ...base, cutoutAssetId: cutout, storyPhotoAssetId: story, featuredReleaseId: live.release.id,
        accentColor: '#ff3366', highlightQuote: 'Detroit made.',
      })
      expect(saved).toMatchObject({cutout_asset_id: cutout, story_photo_asset_id: story, featured_release_id: live.release.id, accent_color: '#ff3366', highlight_quote: 'Detroit made.'})

      // Wrong kind, another artist's upload, and a featured release that is not LIVE are refused.
      await expect(profiles().updateProfile(live.userId, live.artist.id, {...base, cutoutAssetId: story})).rejects.toMatchObject({code: 'invalid_profile_image'})
      await expect(profiles().updateProfile(live.userId, live.artist.id, {...base, cutoutAssetId: foreignCutout})).rejects.toMatchObject({code: 'invalid_profile_image'})
      await expect(profiles().updateProfile(live.userId, live.artist.id, {...base, featuredReleaseId: draftRelease.id})).rejects.toMatchObject({code: 'invalid_featured_release'})
      await expect(profiles().updateProfile(live.userId, live.artist.id, {...base, featuredReleaseId: other.release.id})).rejects.toMatchObject({code: 'invalid_featured_release'})
      // Omitted fields keep their values.
      const kept = await profiles().updateProfile(live.userId, live.artist.id, base)
      expect(kept).toMatchObject({cutout_asset_id: cutout, accent_color: '#ff3366', highlight_quote: 'Detroit made.'})

      // Galleries: owner-only, ready gallery uploads only, replaced atomically in the given order.
      await expect(profiles().replaceGallery(other.userId, live.artist.id, {items: [{assetId: galleryA, caption: null}]})).rejects.toMatchObject({code: 'not_found'})
      await expect(profiles().replaceGallery(live.userId, live.artist.id, {items: [{assetId: pendingGallery, caption: null}]})).rejects.toMatchObject({code: 'invalid_gallery_image'})
      await expect(profiles().replaceGallery(live.userId, live.artist.id, {items: [{assetId: cutout, caption: null}]})).rejects.toMatchObject({code: 'invalid_gallery_image'})
      expect(await profiles().replaceGallery(live.userId, live.artist.id, {items: [{assetId: galleryB, caption: 'Backstage'}, {assetId: galleryA, caption: null}]}))
        .toEqual([{asset_id: galleryB, caption: 'Backstage', position: 0}, {asset_id: galleryA, caption: null, position: 1}])
      await expect(profiles().replaceGallery(live.userId, live.artist.id, {items: [{assetId: galleryA, caption: null}, {assetId: foreignCutout, caption: null}]})).rejects.toMatchObject({code: 'invalid_gallery_image'})
      expect((await profiles().getProfile(live.userId, live.artist.id)).gallery.map((image) => image.asset_id)).toEqual([galleryB, galleryA])

      const slug = (await pool.query<{slug: string}>('SELECT slug FROM artists WHERE id = $1', [live.artist.id])).rows[0].slug
      const page = await profiles().getPublicArtist(slug)
      expect(page.artist).toMatchObject({accent_color: '#ff3366', cutout_asset_id: cutout, featured_release_id: live.release.id, links: {booking: 'mailto:booking@example.test'}})
      expect(page.artist.gallery.map((image) => image.asset_id)).toEqual([galleryB, galleryA])
      const store = new StoreService(new Database(connectionString!, pool) as never)
      await expect(store.getAsset(cutout)).resolves.toMatchObject({mimeType: 'image/png'})
      await expect(store.getAsset(galleryA)).resolves.toMatchObject({mimeType: 'image/png'})

      // Without Stripe payouts, the page (and its imagery) lasts only as long as the LIVE release.
      await pool.query(`UPDATE provider_profiles SET stripe_payouts_enabled = FALSE, stripe_transfers_status = 'inactive' WHERE id = $1`, [live.provider.id])
      await adminService().commandRelease(adminUserId, live.release.id, {action: 'takedown', expectedVersion: live.version, note: 'Rights claim'})
      await expect(store.getAsset(cutout)).rejects.toMatchObject({code: 'not_found'})
      await expect(store.getAsset(galleryA)).rejects.toMatchObject({code: 'not_found'})
    })
  })

  describe('release draft deletion', () => {
    it('deletes an owned draft with its tracks and uploads, and records the deletion', async () => {
      const fixture = await createProviderFixture('Deleter')
      const storageKey = `marketplace/${fixture.provider.id}/audio/${crypto.randomUUID()}.wav`
      await service.createAsset(fixture.userId, {trackId: fixture.track.id, kind: 'audio', storageKey, mimeType: 'audio/wav', byteSize: 1000, processingStatus: 'ready', metadata: {}})

      // Another account cannot see it, and a viewer on the owning account cannot delete it.
      const intruder = await createProviderFixture('DeleteIntruder')
      await expect(service.deleteReleaseDraft(intruder.userId, fixture.release.id)).rejects.toMatchObject({code: 'not_found'})
      await pool.query(`UPDATE provider_members SET role = 'viewer' WHERE user_id = $1`, [fixture.userId])
      await expect(service.deleteReleaseDraft(fixture.userId, fixture.release.id)).rejects.toMatchObject({code: 'provider_write_forbidden'})
      await pool.query(`UPDATE provider_members SET role = 'owner' WHERE user_id = $1`, [fixture.userId])

      await expect(service.deleteReleaseDraft(fixture.userId, fixture.release.id)).resolves.toEqual({deleted: true, storageKeys: [storageKey]})
      const remaining = await pool.query<{releases: number; tracks: number; assets: number; audits: number}>(
        `SELECT
          (SELECT COUNT(*)::integer FROM releases WHERE id = $1) AS releases,
          (SELECT COUNT(*)::integer FROM tracks WHERE id = $2) AS tracks,
          (SELECT COUNT(*)::integer FROM marketplace_assets WHERE storage_key = $3) AS assets,
          (SELECT COUNT(*)::integer FROM marketplace_audit_events WHERE entity_id = $1 AND action = 'release.deleted') AS audits`,
        [fixture.release.id, fixture.track.id, storageKey],
      )
      expect(remaining.rows[0]).toEqual({releases: 0, tracks: 0, assets: 0, audits: 1})
      // The intruder's own draft is untouched.
      expect((await pool.query('SELECT 1 FROM releases WHERE id = $1', [intruder.release.id])).rowCount).toBe(1)
      await expect(service.deleteReleaseDraft(fixture.userId, fixture.release.id)).rejects.toMatchObject({code: 'not_found'})
    })

    it('keeps live releases, drafts with an ISRC, and drafts with checkout history', async () => {
      await resetIsrcState()
      const live = await prepareLiveRelease('DeleteLive')
      await expect(service.deleteReleaseDraft(live.userId, live.release.id)).rejects.toMatchObject({status: 409, code: 'release_not_deletable'})

      const withIsrc = await createProviderFixture('DeleteIsrc')
      await service.assignGeneratedIsrc(withIsrc.userId, withIsrc.track.id, {controlsRecording: true, neverAssignedIsrc: true, authorizeAssignment: true}, {prefix: 'QTA3L', countryCode: 'QT', registrantCode: 'A3L'})
      await expect(service.deleteReleaseDraft(withIsrc.userId, withIsrc.release.id)).rejects.toMatchObject({status: 409, code: 'release_has_isrc'})

      const withCheckout = await prepareLiveRelease('DeleteCheckout', {skipIsrc: true, stage: 'pricing'})
      const product = await pool.query<{id: string}>('SELECT id FROM products WHERE release_id = $1', [withCheckout.release.id])
      await pool.query(
        `INSERT INTO marketplace_checkout_attempts
          (id, buyer_user_id, provider_profile_id, product_id, release_id, amount_minor, currency, platform_fee_bps,
           stripe_idempotency_key, transfer_group, snapshot, expires_at)
         VALUES ($1, NULL, $2, $3, $4, 999, 'USD', 1000, $5, $6, '{}'::jsonb, CURRENT_TIMESTAMP)`,
        [crypto.randomUUID(), withCheckout.provider.id, product.rows[0].id, withCheckout.release.id, `idem-${crypto.randomUUID()}`, `tg-${crypto.randomUUID()}`],
      )
      await expect(service.deleteReleaseDraft(withCheckout.userId, withCheckout.release.id)).rejects.toMatchObject({status: 409, code: 'release_has_orders'})

      const kept = await pool.query('SELECT 1 FROM releases WHERE id = ANY($1::text[])', [[live.release.id, withIsrc.release.id, withCheckout.release.id]])
      expect(kept.rowCount).toBe(3)
    })
  })

  describe('release scheduling, pre-orders and guest delivery', () => {
    const DAY = 24 * 60 * 60 * 1000
    const emailEnv = {RESEND_API_KEY: 're_test_key', RESEND_FROM: 'MeJay <orders@example.test>', FRONTEND_URL: 'https://app.test'}
    afterEach(() => {
      vi.unstubAllGlobals()
    })
    const db = () => new Database(connectionString!, pool)

    /** Stripe + Resend stub. `resend` is the queue of Resend HTTP statuses (default 200). */
    function stubServices(options: {resend?: number[]; refundFails?: boolean} = {}) {
      const calls: Array<{url: string; body: URLSearchParams | null; idempotencyKey: string | null}> = []
      const emails: Array<Record<string, unknown>> = []
      const resend = options.resend ?? []
      vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
        const url = String(input)
        const headers = (init?.headers ?? {}) as Record<string, string>
        if (url === 'https://api.resend.com/emails') {
          emails.push(JSON.parse(String(init?.body)))
          return new Response('{}', {status: resend.shift() ?? 200})
        }
        const body = init?.body instanceof URLSearchParams ? init.body : null
        calls.push({url, body, idempotencyKey: headers['idempotency-key'] ?? null})
        const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), {status})
        if (url.includes('/v1/checkout/sessions')) return reply({id: `cs_${crypto.randomUUID().replaceAll('-', '')}`, url: 'https://checkout.stripe.test'})
        if (url.includes('/v1/payment_intents/')) {
          return reply({id: url.split('/v1/payment_intents/')[1].split('?')[0], status: 'succeeded', latest_charge: {id: `ch_${crypto.randomUUID()}`, balance_transaction: {id: 'txn_1', fee: 59}}})
        }
        if (url.endsWith('/v1/refunds')) return options.refundFails ? reply({error: {message: 'refund unavailable'}}, 500) : reply({id: `re_${crypto.randomUUID()}`})
        if (url.endsWith('/v1/transfers')) return reply({id: `tr_${crypto.randomUUID()}`})
        throw new Error(`Unexpected call ${url}`)
      }))
      return {calls, emails}
    }

    /** A priced release submitted with an artist-chosen date, then reviewed. */
    async function submitWithDate(label: string, releaseInMs: number, options: {preorders?: boolean} = {}) {
      await resetIsrcState()
      const fixture = await prepareLiveRelease(label, {stage: 'pricing'})
      await pool.query(
        `UPDATE releases SET requested_release_at = $2, release_timezone = 'America/Detroit', preorders_enabled = $3 WHERE id = $1`,
        [fixture.release.id, new Date(Date.now() + releaseInMs).toISOString(), options.preorders ?? true],
      )
      await certifyRelease(fixture.userId, fixture.release.id)
      const submitted = await service.transitionRelease(fixture.userId, fixture.release.id, {targetStatus: 'SUBMITTED', expectedVersion: fixture.version}) as {version: number}
      const reviewing = await adminService().commandRelease(reviewerUserId, fixture.release.id, {action: 'start_review', expectedVersion: submitted.version}) as {version: number}
      return {...fixture, version: reviewing.version}
    }

    async function scheduledPreorder(label: string) {
      const fixture = await submitWithDate(label, 8 * DAY)
      const approved = await adminService().commandRelease(reviewerUserId, fixture.release.id, {action: 'approve', expectedVersion: fixture.version}) as {version: number; status: string}
      expect(approved.status).toBe('SCHEDULED')
      const product = await pool.query<{id: string}>('SELECT id FROM products WHERE release_id = $1', [fixture.release.id])
      return {...fixture, version: approved.version, productId: product.rows[0].id}
    }

    /** Guest pre-order checkout and its paid webhook session. */
    async function guestPreorder(label: string, email = `fan-${crypto.randomUUID().slice(0, 8)}@example.test`) {
      const release = await scheduledPreorder(label)
      const stubs = stubServices()
      const commerce = new CommerceService(db() as never, 'sk_test', 1000)
      const checkout = await commerce.createCheckout(null, release.productId, 'https://app.test')
      const attempt = await pool.query<{id: string}>('SELECT id FROM marketplace_checkout_attempts WHERE stripe_checkout_session_id = $1', [checkout.sessionId])
      const session = {
        id: checkout.sessionId, payment_status: 'paid', payment_intent: `pi_${crypto.randomUUID()}`, amount_total: 999, currency: 'usd', livemode: false,
        customer_details: {email: email.toUpperCase()},
        metadata: {kind: 'marketplace_purchase', attemptId: attempt.rows[0].id, buyer: 'guest', productId: release.productId},
      }
      const fulfilled = await commerce.fulfillPaidSession(session)
      const entitlement = await pool.query('SELECT * FROM download_entitlements WHERE order_id = $1', [fulfilled.orderId])
      return {release, commerce, checkout, session, orderId: fulfilled.orderId, held: fulfilled.held, entitlement: entitlement.rows[0], email, ...stubs}
    }

    async function makeReleaseDue(releaseId: string) {
      await pool.query(`UPDATE releases SET scheduled_release_at = CURRENT_TIMESTAMP - INTERVAL '1 minute' WHERE id = $1`, [releaseId])
    }

    it('requires a requested release date at least 7 days after submission, measured at submission time', async () => {
      await expect(submitWithDate('LeadShort', 7 * DAY - 60_000)).rejects.toMatchObject({
        code: 'release_prerequisites_unmet',
        details: expect.arrayContaining(['Choose a release date at least 7 days from today to allow time for review and release preparation.']),
      })
      await expect(submitWithDate('LeadExact', 7 * DAY + 5_000)).resolves.toMatchObject({version: expect.any(Number)})
    })

    it('schedules on approval before the chosen date, and never silently publishes after it', async () => {
      const early = await submitWithDate('ApproveEarly', 8 * DAY)
      const requested = (await pool.query('SELECT requested_release_at FROM releases WHERE id = $1', [early.release.id])).rows[0].requested_release_at
      const scheduled = await adminService().commandRelease(reviewerUserId, early.release.id, {action: 'approve', expectedVersion: early.version}) as {status: string; scheduled_release_at: Date; approved_at: Date | null}
      expect(scheduled.status).toBe('SCHEDULED')
      expect(new Date(scheduled.scheduled_release_at).toISOString()).toBe(new Date(requested).toISOString())
      expect(scheduled.approved_at).not.toBeNull()

      const late = await submitWithDate('ApproveLate', 8 * DAY)
      // The chosen date passes while the release waits in review.
      await pool.query(`UPDATE releases SET requested_release_at = CURRENT_TIMESTAMP - INTERVAL '1 hour' WHERE id = $1`, [late.release.id])
      const approved = await adminService().commandRelease(reviewerUserId, late.release.id, {action: 'approve', expectedVersion: late.version}) as {status: string; release_date_needed: boolean; published_at: Date | null}
      expect(approved).toMatchObject({status: 'APPROVED', release_date_needed: true, published_at: null})
      const products = await pool.query<{active: boolean}>('SELECT active FROM products WHERE release_id = $1', [late.release.id])
      expect((await pool.query('SELECT status FROM releases WHERE id = $1', [late.release.id])).rows[0].status).toBe('APPROVED')
      expect(products.rows.length).toBeGreaterThan(0)
    })

    it('lists approved pre-orders with artwork but no audio, and only when the artist enabled them', async () => {
      const release = await scheduledPreorder('Listed')
      const store = new StoreService(db() as never)
      const listed = (await store.listCatalog() as Array<{id: string; availability: string; preview_asset_id: string | null; release_at: Date; release_timezone: string; artwork_asset_id: string}>)
        .find((row) => row.id === release.release.id)!
      expect(listed).toMatchObject({availability: 'preorder', preview_asset_id: null, release_timezone: 'America/Detroit'})
      expect(listed.release_at).not.toBeNull()
      const detail = await store.getRelease(release.release.id) as {tracks: Array<{preview_asset_id: string | null}>}
      expect(detail.tracks.every((track) => track.preview_asset_id === null)).toBe(true)
      await pool.query(`UPDATE marketplace_assets SET storage_key = $2 WHERE id = $1`, [listed.artwork_asset_id, `marketplace/${release.provider.id}/artwork/${listed.artwork_asset_id}.jpg`])
      await expect(store.getAsset(listed.artwork_asset_id)).resolves.toMatchObject({mimeType: 'image/jpeg'})
      const audio = await pool.query<{id: string}>(`SELECT id FROM marketplace_assets WHERE track_id = $1 AND kind = 'audio'`, [release.track.id])
      await expect(store.getAsset(audio.rows[0].id)).rejects.toMatchObject({code: 'not_found'})

      await pool.query('UPDATE releases SET preorders_enabled = FALSE WHERE id = $1', [release.release.id])
      expect((await store.listCatalog() as Array<{id: string}>).some((row) => row.id === release.release.id)).toBe(false)
      stubServices()
      await expect(new CommerceService(db() as never, 'sk_test', 1000).createCheckout(null, release.productId, 'https://app.test')).rejects.toMatchObject({code: 'product_not_found'})
    })

    it('charges a guest pre-order today, holds downloads and payout, and keeps payment separate from delivery', async () => {
      const {calls, orderId, held, entitlement, email, commerce, session} = await guestPreorder('GuestHold')
      const checkout = calls.find((call) => call.url.endsWith('/v1/checkout/sessions'))!.body!
      expect(checkout.get('customer_email')).toBeNull()
      expect(checkout.get('metadata[buyer]')).toBe('guest')
      expect(checkout.get('metadata[userId]')).toBeNull()
      expect(checkout.get('custom_text[submit][message]')).toContain("You'll be charged today. Downloads become available on release day.")
      expect(checkout.get('custom_text[submit][message]')).toMatch(/Pre-order · releases .+ (EST|EDT)/)
      expect(checkout.get('success_url')).toBe('https://app.test/purchase/complete?session_id={CHECKOUT_SESSION_ID}')

      expect(held).toBe(true)
      expect(entitlement).toMatchObject({buyer_user_id: null, buyer_email: email, status: 'active', delivery_status: 'held', delivery_available_at: null})
      const order = (await pool.query('SELECT payment_status, purchase_type, transfer_status, buyer_user_id FROM marketplace_orders WHERE id = $1', [orderId])).rows[0]
      expect(order).toEqual({payment_status: 'paid', purchase_type: 'preorder', transfer_status: 'pending', buyer_user_id: null})
      expect(calls.filter((call) => call.url.endsWith('/v1/transfers'))).toHaveLength(0)
      // The transfer retry job also leaves held pre-orders alone.
      await commerce.retryPendingTransfers()
      expect(calls.filter((call) => call.url.endsWith('/v1/transfers'))).toHaveLength(0)
      // Snapshot pins the bought audio and formats.
      const item = (await pool.query(`SELECT catalog_snapshot FROM marketplace_order_items WHERE order_id = $1`, [orderId])).rows[0].catalog_snapshot
      expect(item).toMatchObject({purchase_type: 'preorder', formats: ['wav'], release_timezone: 'America/Detroit'})
      const files = await pool.query('SELECT storage_key, mime_type FROM download_entitlement_files WHERE entitlement_id = $1', [entitlement.id])
      expect(files.rows).toEqual([{storage_key: expect.stringContaining('GuestHold-track.wav'), mime_type: 'audio/wav'}])

      // Guest status page: paid, held, masked email only.
      await expect(commerce.getGuestOrderStatus(session.id)).resolves.toMatchObject({paid: true, purchaseType: 'preorder', deliveryStatus: 'held', maskedEmail: expect.stringMatching(/^f•••@example\.test$/)})

      // Every download path is held: an emailed link returns only the release date.
      const {token} = await issueEmailLink(db() as never, {entitlementId: entitlement.id, orderId, recipientEmail: email, purpose: 'purchase'})
      await expect(exchangeEmailLink(db() as never, token)).resolves.toMatchObject({state: 'held', purchase: {deliveryStatus: 'held', releaseTimezone: 'America/Detroit'}})
      const sessions = await pool.query(`SELECT 1 FROM marketplace_guest_access_tokens WHERE entitlement_id = $1 AND kind = 'download_session'`, [entitlement.id])
      expect(sessions.rowCount).toBe(0)
      // Claimed into an account it is still held there.
      const userId = crypto.randomUUID()
      await pool.query(`INSERT INTO users (id, email, account_intent) VALUES ($1, $2, 'consumer')`, [userId, email])
      expect(await claimGuestPurchases(db() as never, userId, email)).toBe(1)
      const fileId = (await pool.query('SELECT id FROM download_entitlement_files WHERE entitlement_id = $1', [entitlement.id])).rows[0].id
      await expect(commerce.getDownload(userId, entitlement.id, fileId)).rejects.toMatchObject({code: 'download_not_found'})
    })

    it('unlocks pre-orders and queues one release-day email per purchase, however often the scheduler runs', async () => {
      const {release, entitlement, orderId, email, commerce} = await guestPreorder('ReleaseDay')
      await makeReleaseDue(release.release.id)
      const admin = adminService()
      expect((await admin.publishDueReleases()).published).toEqual([release.release.id])
      await admin.publishDueReleases()
      const state = await pool.query(
        `SELECT entitlement.delivery_status, entitlement.delivery_available_at IS NOT NULL AS unlocked_at,
           (SELECT COUNT(*)::integer FROM marketplace_email_jobs WHERE entitlement_id = entitlement.id AND kind = 'release_day') AS jobs
         FROM download_entitlements entitlement WHERE entitlement.id = $1`,
        [entitlement.id],
      )
      expect(state.rows[0]).toEqual({delivery_status: 'available', unlocked_at: true, jobs: 1})

      // The email is sent once, to the purchase email, with a working download link.
      const {emails} = stubServices()
      expect(await processEmailJobs(db() as never, emailEnv)).toMatchObject({sent: 1})
      expect(await processEmailJobs(db() as never, emailEnv)).toMatchObject({sent: 0})
      expect(emails).toHaveLength(1)
      expect(emails[0].to).toBe(email)
      expect(String(emails[0].html)).toContain('Download your music')
      const token = /download#token=([A-Za-z0-9_-]{43})/.exec(String(emails[0].text))![1]

      // Downloading is an explicit, repeatable action within the link's validity.
      const first = await exchangeEmailLink(db() as never, token)
      const second = await exchangeEmailLink(db() as never, token)
      if (first.state !== 'available' || second.state !== 'available') throw new Error('expected available')
      expect(first.files).toHaveLength(1)
      const fileId = first.files[0].id
      await expect(resolveSessionDownload(db() as never, first.accessToken, fileId)).resolves.toMatchObject({fileName: expect.stringContaining('.wav')})
      await expect(resolveSessionDownload(db() as never, second.accessToken, fileId)).resolves.toMatchObject({fileId})
      const uses = await pool.query(`SELECT use_count FROM marketplace_guest_access_tokens WHERE entitlement_id = $1 AND kind = 'email_link'`, [entitlement.id])
      expect(uses.rows[0].use_count).toBe(2)

      // Interrupted downloads resume with a byte range through the guest route.
      const ranges: Array<string | undefined> = []
      const bucket = {getExact: vi.fn(async (_key: string, range?: string) => {
        ranges.push(range)
        return {body: new Response('abc').body!, contentLength: 3, contentRange: range ? 'bytes 100-102/2000' : undefined}
      })}
      const response = await downloadGuestFile({
        request: new Request(`https://api.test/api/store/guest-downloads/files/${fileId}?access=${first.accessToken}`, {headers: {range: 'bytes=100-'}}),
        env: {DB: db(), DOWNLOADS: bucket as never},
        params: {fileId},
      })
      expect(response.status).toBe(206)
      expect(response.headers.get('content-range')).toBe('bytes 100-102/2000')
      expect(ranges).toEqual(['bytes=100-'])

      // A session never reaches another purchase's file.
      const other = await guestPreorder('ReleaseDayOther')
      const otherFile = (await pool.query('SELECT id FROM download_entitlement_files WHERE entitlement_id = $1', [other.entitlement.id])).rows[0].id
      await expect(resolveSessionDownload(db() as never, first.accessToken, otherFile)).rejects.toMatchObject({code: 'download_not_found'})

      // Payout follows release day through the existing transfer retry job.
      stubServices()
      await commerce.retryPendingTransfers()
      expect((await pool.query('SELECT transfer_status FROM marketplace_orders WHERE id = $1', [orderId])).rows[0].transfer_status).toBe('transferred')
    })

    it('expires email links after 7 days and recovers access only through the purchase email', async () => {
      const {release, entitlement, orderId, email} = await guestPreorder('Recovery')
      await makeReleaseDue(release.release.id)
      await adminService().publishDueReleases()
      const {token} = await issueEmailLink(db() as never, {entitlementId: entitlement.id, orderId, recipientEmail: email, purpose: 'purchase', now: Date.now() - 7 * DAY - 1000})
      await expect(exchangeEmailLink(db() as never, token)).rejects.toMatchObject({status: 410, code: 'link_expired'})
      await expect(exchangeEmailLink(db() as never, 'x'.repeat(43))).rejects.toMatchObject({code: 'link_invalid'})

      const {emails} = stubServices()
      const answer = async (address: string) => {
        const response = await recoverGuestAccess({
          request: new Request('https://api.test/api/store/guest-access/recover', {method: 'POST', headers: {'x-forwarded-for': `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`}, body: JSON.stringify({email: address})}),
          env: {DB: db(), ...emailEnv},
        })
        return {status: response.status, body: await response.json()}
      }
      const unknown = await answer('nobody-here@example.test')
      const known = await answer(` ${email.toUpperCase()} `)
      // Same answer either way; mail goes only to the stored purchase email.
      expect(unknown).toEqual(known)
      expect(emails).toHaveLength(1)
      expect(emails[0].to).toBe(email)
      const fresh = /download#token=([A-Za-z0-9_-]{43})/.exec(String(emails[0].text))![1]
      await expect(exchangeEmailLink(db() as never, fresh)).resolves.toMatchObject({state: 'available'})
      await expect(sendAccessRecovery(db() as never, emailEnv, 'nobody-here@example.test')).resolves.toBe('none')
    })

    it('retries failed release-day emails with backoff and marks them failed after the last attempt', async () => {
      const {release, entitlement} = await guestPreorder('EmailRetry')
      // Drain jobs left by earlier tests so the counts below are this purchase's alone.
      stubServices()
      await processEmailJobs(db() as never, emailEnv, 500)
      await makeReleaseDue(release.release.id)
      await adminService().publishDueReleases()
      stubServices({resend: [500]})
      expect(await processEmailJobs(db() as never, emailEnv)).toMatchObject({sent: 0, retried: 1})
      const job = await pool.query(`SELECT status, attempts, last_error, next_attempt_at > CURRENT_TIMESTAMP AS backed_off FROM marketplace_email_jobs WHERE entitlement_id = $1`, [entitlement.id])
      expect(job.rows[0]).toEqual({status: 'pending', attempts: 1, last_error: 'http_500', backed_off: true})
      // Not due yet: nothing is sent early.
      expect(await processEmailJobs(db() as never, emailEnv)).toMatchObject({sent: 0, retried: 0})
      await pool.query(`UPDATE marketplace_email_jobs SET next_attempt_at = CURRENT_TIMESTAMP, attempts = 5 WHERE entitlement_id = $1`, [entitlement.id])
      stubServices({resend: [500]})
      await processEmailJobs(db() as never, emailEnv)
      expect((await pool.query(`SELECT status, attempts FROM marketplace_email_jobs WHERE entitlement_id = $1`, [entitlement.id])).rows[0]).toEqual({status: 'failed', attempts: 6})
    })

    it('tells buyers about a new release date once per change and keeps downloads held until then', async () => {
      const {release, entitlement} = await guestPreorder('Reschedule')
      const newDate = new Date(Date.now() + 20 * DAY).toISOString()
      const moved = await adminService().commandRelease(adminUserId, release.release.id, {action: 'reschedule', expectedVersion: release.version, scheduledReleaseAt: newDate}) as {version: number; status: string}
      expect(moved.status).toBe('SCHEDULED')
      await expect(adminService().commandRelease(adminUserId, release.release.id, {action: 'reschedule', expectedVersion: moved.version, scheduledReleaseAt: new Date(Date.now() - 1000).toISOString()}))
        .rejects.toMatchObject({code: 'schedule_must_be_future'})
      const jobs = await pool.query(`SELECT payload FROM marketplace_email_jobs WHERE entitlement_id = $1 AND kind = 'release_date_changed'`, [entitlement.id])
      expect(jobs.rows).toEqual([{payload: expect.objectContaining({releaseAt: newDate, releaseTimezone: 'America/Detroit'})}])
      const {emails} = stubServices()
      await processEmailJobs(db() as never, emailEnv)
      expect(emails).toHaveLength(1)
      expect(String(emails[0].text)).toMatch(/New release date: .+ (EST|EDT)/)
      await adminService().publishDueReleases()
      expect((await pool.query('SELECT delivery_status FROM download_entitlements WHERE id = $1', [entitlement.id])).rows[0].delivery_status).toBe('held')
    })

    it('cancels pre-orders with idempotent refunds and never deletes or quietly takes down a release with paid pre-orders', async () => {
      const {release, orderId, entitlement, commerce} = await guestPreorder('Cancel')
      await expect(adminService().commandRelease(adminUserId, release.release.id, {action: 'takedown', expectedVersion: release.version, note: 'Pulled'}))
        .rejects.toMatchObject({code: 'release_has_preorders'})
      await expect(service.deleteReleaseDraft(release.userId, release.release.id)).rejects.toMatchObject({code: 'release_not_deletable'})

      const canceled = await adminService().commandRelease(adminUserId, release.release.id, {action: 'cancel_preorders', expectedVersion: release.version, note: 'Artist withdrew the release'}) as {status: string; preorders_canceled: number}
      expect(canceled).toMatchObject({status: 'TAKEN_DOWN', preorders_canceled: 1})
      const failing = stubServices({refundFails: true})
      expect(await commerce.processPreorderRefunds()).toEqual({requested: 0, failed: 1})
      expect(failing.calls.filter((call) => call.url.endsWith('/v1/refunds'))).toHaveLength(1)
      await pool.query(`UPDATE marketplace_preorder_cancellations SET updated_at = CURRENT_TIMESTAMP - INTERVAL '1 hour' WHERE order_id = $1`, [orderId])
      const {calls} = stubServices()
      expect(await commerce.processPreorderRefunds()).toEqual({requested: 1, failed: 0})
      expect(await commerce.processPreorderRefunds()).toEqual({requested: 0, failed: 0})
      const refunds = [...failing.calls, ...calls].filter((call) => call.url.endsWith('/v1/refunds'))
      // Every attempt reuses the same idempotency key, so Stripe never refunds twice.
      expect(new Set(refunds.map((call) => call.idempotencyKey))).toEqual(new Set([`marketplace-preorder-refund-${orderId}`]))
      expect(refunds[0].body?.get('metadata[kind]')).toBe('preorder_cancellation')

      // The refund webhook revokes the download; nothing was paid out, so nothing is reversed.
      const order = (await pool.query('SELECT stripe_charge_id FROM marketplace_orders WHERE id = $1', [orderId])).rows[0]
      await commerce.handleRefund({id: order.stripe_charge_id, amount: 999, amount_refunded: 999})
      const after = await pool.query(`SELECT purchase_order.payment_status, entitlement.status FROM marketplace_orders purchase_order JOIN download_entitlements entitlement ON entitlement.order_id = purchase_order.id WHERE purchase_order.id = $1`, [orderId])
      expect(after.rows[0]).toEqual({payment_status: 'refunded', status: 'revoked'})
      expect(calls.filter((call) => call.url.includes('/reversals'))).toHaveLength(0)
      const {emails} = stubServices()
      await processEmailJobs(db() as never, emailEnv)
      expect(emails.map((mail) => mail.subject)).toEqual([expect.stringContaining('Pre-order cancelled')])
      void entitlement
    })

    it('claims guest purchases only for a verified email that matches the signed-in account', async () => {
      const email = `claim-${crypto.randomUUID().slice(0, 8)}@example.test`
      const {entitlement} = await guestPreorder('Claim', email)
      const userId = crypto.randomUUID()
      await pool.query(`INSERT INTO users (id, email, account_intent) VALUES ($1, $2, 'consumer')`, [userId, email])
      const sessionToken = crypto.randomUUID()
      await pool.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, CURRENT_TIMESTAMP + INTERVAL '1 hour')`, [
        createHash('sha256').update(`session:${sessionToken}:dev-session-pepper`).digest('hex'), userId,
      ])
      const claim = async (verifiedToken: string) => {
        const response = await claimStorePurchases({
          request: new Request('https://api.test/api/store/purchases/claim', {method: 'POST', headers: {cookie: `mejay_session=${sessionToken}`}, body: JSON.stringify({verifiedToken})}),
          env: {DB: db()},
        })
        return {status: response.status, body: await response.json()}
      }
      const exp = Date.now() + 60_000
      expect(await claim('not-a-token')).toMatchObject({status: 401})
      expect(await claim(await signVerifiedToken({env: {}, email: 'someone-else@example.test', purpose: 'signup_verify', expMs: exp}))).toMatchObject({status: 403})
      expect((await pool.query('SELECT buyer_user_id FROM download_entitlements WHERE id = $1', [entitlement.id])).rows[0].buyer_user_id).toBeNull()
      expect(await claim(await signVerifiedToken({env: {}, email, purpose: 'signup_verify', expMs: exp}))).toMatchObject({status: 200, body: {data: {claimed: 1}}})
      expect((await pool.query('SELECT buyer_user_id FROM download_entitlements WHERE id = $1', [entitlement.id])).rows[0].buyer_user_id).toBe(userId)
    })

    it('keeps live purchases delivered immediately with a download link and an immediate payout', async () => {
      await resetIsrcState()
      const live = await prepareLiveRelease('LiveStill')
      const product = await pool.query<{id: string}>('SELECT id FROM products WHERE release_id = $1', [live.release.id])
      const {calls, emails} = stubServices()
      const commerce = new CommerceService(db() as never, 'sk_test', 1000)
      const checkout = await commerce.createCheckout(null, product.rows[0].id, 'https://app.test')
      expect(calls.find((call) => call.url.endsWith('/v1/checkout/sessions'))!.body!.get('custom_text[submit][message]')).toBeNull()
      const attempt = await pool.query<{id: string}>('SELECT id FROM marketplace_checkout_attempts WHERE stripe_checkout_session_id = $1', [checkout.sessionId])
      const {orderId, held} = await commerce.fulfillPaidSession({
        id: checkout.sessionId, payment_status: 'paid', payment_intent: `pi_${crypto.randomUUID()}`, amount_total: 999, currency: 'usd', livemode: false,
        customer_details: {email: 'livefan@example.test'},
        metadata: {kind: 'marketplace_purchase', attemptId: attempt.rows[0].id, buyer: 'guest', productId: product.rows[0].id},
      })
      expect(held).toBe(false)
      expect((await pool.query('SELECT delivery_status FROM download_entitlements WHERE order_id = $1', [orderId])).rows[0].delivery_status).toBe('available')
      expect(calls.filter((call) => call.url.endsWith('/v1/transfers'))).toHaveLength(1)
      await expect(sendOrderConfirmation(db() as never, emailEnv, orderId)).resolves.toBe('sent')
      expect(emails[0].to).toBe('livefan@example.test')
      expect(String(emails[0].text)).toMatch(/Download your music: https:\/\/app\.test\/download#token=/)
      expect(String(emails[0].text)).toContain('Create a free account')
      await expect(retryFailedConfirmations(db() as never, emailEnv)).resolves.toBe(0)
    })

    /** A finished clip for a track, as the converter would store it; `lengthMs` defaults to the track's current length, null leaves it out like clips made before lengths existed. */
    async function addClip(owner: {provider: {id: string}; track: {id: string}}, setting: number | null, lengthMs?: number | null) {
      const source = await pool.query<{id: string}>(`SELECT id FROM marketplace_assets WHERE track_id = $1 AND kind = 'audio' ORDER BY created_at DESC LIMIT 1`, [owner.track.id])
      const length = lengthMs === undefined ? (await pool.query<{preview_length_ms: number}>('SELECT preview_length_ms FROM tracks WHERE id = $1', [owner.track.id])).rows[0].preview_length_ms : lengthMs
      const clipId = crypto.randomUUID()
      await pool.query(
        `INSERT INTO marketplace_assets (id, provider_profile_id, track_id, kind, storage_key, mime_type, byte_size, processing_status, metadata)
         VALUES ($1, $2, $3, 'audio_preview', $4, 'audio/mpeg', 160000, 'ready', $5)`,
        [clipId, owner.provider.id, owner.track.id, `mejay-artist/${owner.provider.id}/audio_preview/${owner.track.id}/${clipId}.mp3`, JSON.stringify({sourceAssetId: source.rows[0].id, previewSetting: setting, ...(length === null ? {} : {previewLengthMs: length})})],
      )
      await pool.query(`UPDATE audio_processing_jobs SET status = 'succeeded' WHERE track_id = $1 AND status IN ('queued', 'processing')`, [owner.track.id])
      return clipId
    }

    it('keeps exactly one preview clip job per track setting, never retrying a failed file for the same setting', async () => {
      await pool.query(`UPDATE audio_processing_jobs SET status = 'succeeded' WHERE status IN ('queued', 'processing')`)
      const owner = await scheduledPreorder('ClipJobs')
      const jobsFor = async () => (await pool.query(`SELECT status, preview_start_ms FROM audio_processing_jobs WHERE track_id = $1 ORDER BY created_at`, [owner.track.id])).rows
      await ensurePreviewJobs(db() as never, 500)
      await ensurePreviewJobs(db() as never, 500)
      expect(await jobsFor()).toEqual([{status: 'queued', preview_start_ms: null}])
      await addClip(owner, null)
      await ensurePreviewJobs(db() as never, 500)
      expect(await jobsFor()).toHaveLength(1)

      // A new start time queues one fresh job carrying that setting.
      await pool.query('UPDATE tracks SET preview_start_ms = 45000 WHERE id = $1', [owner.track.id])
      await ensurePreviewJobs(db() as never, 500)
      await ensurePreviewJobs(db() as never, 500)
      expect((await jobsFor()).map((job) => job.preview_start_ms)).toEqual([null, 45000])
      const detail = await service.getRelease(owner.userId, owner.release.id) as {tracks: Array<{preview_status: string}>}
      expect(detail.tracks[0].preview_status).toBe('processing')

      // A failed conversion is not retried for the same setting.
      await pool.query(`UPDATE audio_processing_jobs SET status = 'failed' WHERE track_id = $1 AND preview_start_ms = 45000`, [owner.track.id])
      await ensurePreviewJobs(db() as never, 500)
      expect(await jobsFor()).toHaveLength(2)
      expect((await service.getRelease(owner.userId, owner.release.id) as {tracks: Array<{preview_status: string}>}).tracks[0].preview_status).toBe('waiting')

      // Wake-up: only when configured and something is queued.
      const fetchSpy = vi.fn(async () => new Response('{}', {status: 202}))
      expect(await wakeConverterIfQueued(db() as never, {}, fetchSpy as never)).toBe(false)
      await pool.query('UPDATE tracks SET preview_start_ms = 50000 WHERE id = $1', [owner.track.id])
      await ensurePreviewJobs(db() as never, 500)
      expect(await wakeConverterIfQueued(db() as never, {CONVERTER_URL: 'https://converter.test/', CONVERTER_TRIGGER_SECRET: 'secret'}, fetchSpy as never)).toBe(true)
      expect(fetchSpy).toHaveBeenCalledWith('https://converter.test/jobs/run', expect.objectContaining({method: 'POST', headers: {authorization: 'Bearer secret'}}))
      await addClip(owner, 50000)
      expect((await service.getRelease(owner.userId, owner.release.id) as {tracks: Array<{preview_status: string}>}).tracks[0].preview_status).toBe('ready')
    })

    it('defaults new songs to 15-second previews and rebuilds a clip once when the artist picks another length', async () => {
      await pool.query(`UPDATE audio_processing_jobs SET status = 'succeeded' WHERE status IN ('queued', 'processing')`)
      const owner = await scheduledPreorder('ClipLength')
      const track = async () => (await pool.query('SELECT preview_length_ms FROM tracks WHERE id = $1', [owner.track.id])).rows[0].preview_length_ms
      const jobsFor = async () => (await pool.query(`SELECT status, preview_length_ms FROM audio_processing_jobs WHERE track_id = $1 ORDER BY created_at`, [owner.track.id])).rows
      expect(await track()).toBe(15_000)

      // A clip made before lengths existed was 10 seconds: it still matches a song left at 10 seconds.
      await pool.query('UPDATE tracks SET preview_length_ms = 10000 WHERE id = $1', [owner.track.id])
      await addClip(owner, null, null)
      await ensurePreviewJobs(db() as never, 500)
      expect(await jobsFor()).toEqual([])

      // A new length queues exactly one job carrying it; a failed file is not retried for the same length.
      await pool.query('UPDATE tracks SET preview_length_ms = 20000 WHERE id = $1', [owner.track.id])
      await ensurePreviewJobs(db() as never, 500)
      await ensurePreviewJobs(db() as never, 500)
      expect(await jobsFor()).toEqual([{status: 'queued', preview_length_ms: 20_000}])
      await pool.query(`UPDATE audio_processing_jobs SET status = 'failed' WHERE track_id = $1`, [owner.track.id])
      await ensurePreviewJobs(db() as never, 500)
      expect(await jobsFor()).toHaveLength(1)
      expect((await service.getRelease(owner.userId, owner.release.id) as {tracks: Array<{preview_status: string}>}).tracks[0].preview_status).toBe('waiting')
      await addClip(owner, null)
      expect((await service.getRelease(owner.userId, owner.release.id) as {tracks: Array<{preview_status: string}>}).tracks[0].preview_status).toBe('ready')
    })

    it('serves only preview clips, never masters, and plays pre-order previews only when the artist allows', async () => {
      const owner = await scheduledPreorder('ClipStore')
      const clipId = await addClip(owner, null)
      const master = (await pool.query<{id: string}>(`SELECT id FROM marketplace_assets WHERE track_id = $1 AND kind = 'audio'`, [owner.track.id])).rows[0].id
      const store = new StoreService(db() as never)
      const listedPreview = async () => {
        const row = (await store.listCatalog() as Array<{id: string; preview_asset_id: string | null}>).find((release) => release.id === owner.release.id)!
        const detail = await store.getRelease(owner.release.id) as {tracks: Array<{preview_asset_id: string | null}>}
        return {card: row.preview_asset_id, track: detail.tracks[0].preview_asset_id}
      }
      // Default "after release": no preview while it is a pre-order.
      expect(await listedPreview()).toEqual({card: null, track: null})
      await expect(store.getAsset(clipId)).rejects.toMatchObject({code: 'not_found'})

      await pool.query(`UPDATE releases SET preview_timing = 'before_release' WHERE id = $1`, [owner.release.id])
      expect(await listedPreview()).toEqual({card: clipId, track: clipId})
      await expect(store.getAsset(clipId)).resolves.toMatchObject({kind: 'audio_preview', mimeType: 'audio/mpeg'})
      await expect(store.recordPreview(clipId, null)).resolves.toBeUndefined()
      await expect(store.getAsset(master)).rejects.toMatchObject({code: 'not_found'})

      // The public route streams the whole clip (with ranges) and refuses the master.
      const bucket = {getExact: vi.fn(async (_key: string, range?: string) => ({body: new Response('mp3').body!, contentLength: 3, contentRange: range ? 'bytes 0-2/160000' : undefined}))}
      const asset = (id: string, range?: string) => getCatalogAsset({request: new Request(`https://api.test/api/store/assets/${id}`, {headers: range ? {range} : {}}), env: {DB: db() as never, DOWNLOADS: bucket as never}, params: {assetId: id}})
      expect((await asset(clipId)).status).toBe(200)
      expect((await asset(clipId, 'bytes=0-2')).status).toBe(206)
      expect((await asset(master)).status).toBe(404)

      // After release, previews play whatever the setting.
      await pool.query(`UPDATE releases SET preview_timing = 'after_release' WHERE id = $1`, [owner.release.id])
      await makeReleaseDue(owner.release.id)
      await adminService().publishDueReleases()
      expect(await listedPreview()).toEqual({card: clipId, track: clipId})
    })

    it('saves preview settings on drafts, keeps them on step saves, and rejects a start too close to the end', async () => {
      await resetIsrcState()
      const fixture = await createProviderFixture('ClipSettings')
      const trackInput = {title: 'ClipSettings Track', primaryArtistId: fixture.artist.id, discNumber: 1, trackNumber: 1, durationMs: 180_000, explicit: false, instrumental: false}
      await service.updateTrack(fixture.userId, fixture.track.id, {...trackInput, previewStartMs: 95_000})
      await service.updateTrack(fixture.userId, fixture.track.id, trackInput)
      expect((await pool.query('SELECT preview_start_ms FROM tracks WHERE id = $1', [fixture.track.id])).rows[0].preview_start_ms).toBe(95_000)
      // New songs play 15 seconds, so the latest start on a 3:00 song is 2:45.
      await expect(service.updateTrack(fixture.userId, fixture.track.id, {...trackInput, previewStartMs: 175_000}))
        .rejects.toMatchObject({code: 'preview_start_too_late', message: expect.stringContaining('play 15 seconds. The latest start for this song is 2:45')})
      await expect(service.updateTrack(fixture.userId, fixture.track.id, {...trackInput, previewStartMs: 160_000, previewLengthMs: 25_000}))
        .rejects.toMatchObject({code: 'preview_start_too_late', message: expect.stringContaining('2:35')})
      await service.updateTrack(fixture.userId, fixture.track.id, {...trackInput, previewStartMs: 150_000, previewLengthMs: 25_000})
      await service.updateTrack(fixture.userId, fixture.track.id, trackInput)
      expect((await pool.query('SELECT preview_start_ms, preview_length_ms FROM tracks WHERE id = $1', [fixture.track.id])).rows[0]).toEqual({preview_start_ms: 150_000, preview_length_ms: 25_000})
      await service.updateTrack(fixture.userId, fixture.track.id, {...trackInput, previewStartMs: null})
      expect((await pool.query('SELECT preview_start_ms FROM tracks WHERE id = $1', [fixture.track.id])).rows[0].preview_start_ms).toBeNull()

      const base = {draftStep: 'release-information' as const, title: 'ClipSettings Release', releaseType: 'single' as const, primaryArtistId: fixture.artist.id}
      const saved = await service.updateReleaseDraft(fixture.userId, fixture.release.id, {...base, expectedVersion: fixture.release.version, previewTiming: 'before_release'}) as {version: number; preview_timing: string}
      expect(saved.preview_timing).toBe('before_release')
      const kept = await service.updateReleaseDraft(fixture.userId, fixture.release.id, {...base, expectedVersion: saved.version}) as {preview_timing: string}
      expect(kept.preview_timing).toBe('before_release')
    })

    it('returns the original release date as a plain date so "Save and continue" can send it back', async () => {
      await resetIsrcState()
      const fixture = await createProviderFixture('SaveContinue')
      const base = {title: 'SaveContinue Release', releaseType: 'single' as const, primaryArtistId: fixture.artist.id}
      const saved = await service.updateReleaseDraft(fixture.userId, fixture.release.id, releaseDraftSchema.parse({...base, draftStep: 'release-information', expectedVersion: fixture.release.version, originalReleaseDate: '2026-11-06'})) as {version: number; original_release_date: string}
      expect(saved.original_release_date).toBe('2026-11-06')
      const detail = await service.getRelease(fixture.userId, fixture.release.id) as {release: {original_release_date: string; version: number}}
      expect(detail.release.original_release_date).toBe('2026-11-06')
      const listed = await service.listReleases(fixture.userId) as Array<{id: string; original_release_date: string}>
      expect(listed.find((row) => row.id === fixture.release.id)?.original_release_date).toBe('2026-11-06')
      // What the wizard's "Save and continue" sends: the stored values echoed back with the next step.
      const advanced = await service.updateReleaseDraft(fixture.userId, fixture.release.id, releaseDraftSchema.parse({
        ...base, draftStep: 'artwork', expectedVersion: detail.release.version, originalReleaseDate: detail.release.original_release_date,
      })) as {draft_step: string; original_release_date: string}
      expect(advanced).toMatchObject({draft_step: 'artwork', original_release_date: '2026-11-06'})
    })

    it('credits extra primary and featured artists, including people not on MeJay, everywhere the artist shows', async () => {
      await resetIsrcState()
      const live = await prepareLiveRelease('Credits')
      const partner = await service.createArtist(live.userId, {name: 'Kay Partner', countryCode: 'US', metadata: {}}) as {id: string}
      const intruder = await createProviderFixture('CreditsIntruder')
      const draft = await service.createRelease(live.userId, {title: 'Draft With Guests', releaseType: 'single', primaryArtistId: live.artist.id}) as {id: string; version: number}
      const base = {draftStep: 'release-information' as const, title: 'Draft With Guests', releaseType: 'single' as const, primaryArtistId: live.artist.id}
      const credits = [{role: 'featured' as const, name: '  Boldy   James '}, {role: 'primary' as const, artistId: partner.id, name: 'ignored for account artists'}]
      const saved = await service.updateReleaseDraft(live.userId, draft.id, releaseDraftSchema.parse({...base, expectedVersion: draft.version, additionalArtists: credits})) as {version: number}
      let detail = await service.getRelease(live.userId, draft.id) as {release: {additional_artists: Array<{role: string; artist_id: string | null; name: string}>; artist_credit: string; version: number}}
      expect(detail.release.additional_artists).toEqual([
        {role: 'primary', artist_id: partner.id, name: 'Kay Partner'},
        {role: 'featured', artist_id: null, name: 'Boldy James'},
      ])
      expect(detail.release.artist_credit).toBe('Credits Artist & Kay Partner feat. Boldy James')

      // A step save (no additionalArtists) keeps them; an empty list clears them.
      await service.updateReleaseDraft(live.userId, draft.id, releaseDraftSchema.parse({...base, draftStep: 'artwork', expectedVersion: saved.version}))
      detail = await service.getRelease(live.userId, draft.id) as typeof detail
      expect(detail.release.additional_artists).toHaveLength(2)

      // Refused: the lead again, a repeat, another account's artist.
      const save = (additionalArtists: unknown[]) => service.updateReleaseDraft(live.userId, draft.id, releaseDraftSchema.parse({...base, expectedVersion: detail.release.version, additionalArtists}))
      await expect(save([{role: 'featured', artistId: live.artist.id, name: 'x'}])).rejects.toMatchObject({code: 'duplicate_artist_credit'})
      await expect(save([{role: 'featured', name: 'Boldy James'}, {role: 'primary', name: 'boldy james'}])).rejects.toMatchObject({code: 'duplicate_artist_credit'})
      await expect(save([{role: 'featured', artistId: intruder.artist.id, name: 'x'}])).rejects.toMatchObject({code: 'not_found'})
      const cleared = await save([]) as {version: number}
      expect((await pool.query('SELECT COUNT(*)::integer AS count FROM release_artist_credits WHERE release_id = $1', [draft.id])).rows[0].count).toBe(0)

      // Deleting the draft removes its credits with it.
      await service.updateReleaseDraft(live.userId, draft.id, releaseDraftSchema.parse({...base, expectedVersion: cleared.version, additionalArtists: [{role: 'featured', name: 'Temp Guest'}]}))
      await service.deleteReleaseDraft(live.userId, draft.id)
      expect((await pool.query('SELECT COUNT(*)::integer AS count FROM release_artist_credits WHERE release_id = $1', [draft.id])).rows[0].count).toBe(0)

      // A LIVE release with a guest: the store shows the full credit once, links stay on the lead,
      // and checkout records the full credit on the order.
      await pool.query(
        `INSERT INTO release_artist_credits (id, provider_profile_id, release_id, role, artist_id, display_name, position) VALUES ($1, $2, $3, 'featured', NULL, 'Boldy James', 0)`,
        [crypto.randomUUID(), live.provider.id, live.release.id],
      )
      const store = new StoreService(db() as never)
      const listed = (await store.listCatalog() as Array<{id: string; artist_name: string; artist_credit: string}>).filter((row) => row.id === live.release.id)
      expect(listed).toHaveLength(1)
      expect(listed[0]).toMatchObject({artist_name: 'Credits Artist', artist_credit: 'Credits Artist feat. Boldy James'})
      await expect(store.getRelease(live.release.id)).resolves.toMatchObject({release: {artist_credit: 'Credits Artist feat. Boldy James', artist_name: 'Credits Artist'}})
      const {calls} = stubServices()
      const product = await pool.query<{id: string}>('SELECT id FROM products WHERE release_id = $1', [live.release.id])
      const checkout = await new CommerceService(db() as never, 'sk_test', 1000).createCheckout(null, product.rows[0].id, 'https://app.test')
      expect(calls.find((call) => call.url.endsWith('/v1/checkout/sessions'))!.body!.get('line_items[0][price_data][product_data][description]')).toBe('Credits Artist feat. Boldy James - single')
      const attempt = await pool.query(`SELECT snapshot->'product'->>'artist_name' AS artist FROM marketplace_checkout_attempts WHERE stripe_checkout_session_id = $1`, [checkout.sessionId])
      expect(attempt.rows[0].artist).toBe('Credits Artist feat. Boldy James')
    })

    describe('locked submissions and post-approval change requests', () => {
      const changes = () => new ReleaseChangeRequestService(db() as never)
      const wavBucket = () => ({
        createUploadUrl: async () => 'https://upload.test',
        head: async () => ({byteSize: 4_000_000, contentType: 'audio/wav'}),
        getExact: async () => ({body: new Blob([new Uint8Array([...Buffer.from('RIFF'), 0, 0, 0, 0, ...Buffer.from('WAVE'), ...new Array(52).fill(0)])]).stream()}),
      })

      async function submitted(label: string) {
        await resetIsrcState()
        const fixture = await prepareLiveRelease(label, {stage: 'pricing'})
        await certifyRelease(fixture.userId, fixture.release.id)
        const release = await service.transitionRelease(fixture.userId, fixture.release.id, {targetStatus: 'SUBMITTED', expectedVersion: fixture.version}) as {version: number}
        return {...fixture, version: release.version}
      }

      async function stagedAudio(owner: {userId: string; track: {id: string}}, changeRequestId: string) {
        const started = await service.initiateUpload(owner.userId, {kind: 'audio', trackId: owner.track.id, fileName: 'remaster.wav', byteSize: 4_000_000, mimeType: 'audio/wav', changeRequestId}, wavBucket() as never) as {asset: {id: string}}
        const finalized = await service.finalizeUpload(owner.userId, started.asset.id, wavBucket() as never) as {id: string; processing_status: string}
        expect(finalized.processing_status).toBe('staged')
        return finalized.id
      }

      it('lets the artist withdraw a waiting submission to edit it, but not once review starts', async () => {
        const fixture = await submitted('Withdraw')
        await expect(service.updateTrack(fixture.userId, fixture.track.id, {title: 'Edited', primaryArtistId: fixture.artist.id, discNumber: 1, trackNumber: 1, explicit: false, instrumental: false}))
          .rejects.toMatchObject({code: 'release_locked'})
        await expect(service.withdrawSubmission(fixture.userId, fixture.release.id, fixture.version - 1)).rejects.toMatchObject({code: 'stale_release_version'})
        const draft = await service.withdrawSubmission(fixture.userId, fixture.release.id, fixture.version) as {status: string; version: number}
        expect(draft.status).toBe('DRAFT')
        await expect(service.updateTrack(fixture.userId, fixture.track.id, {title: 'Edited', primaryArtistId: fixture.artist.id, discNumber: 1, trackNumber: 1, explicit: false, instrumental: false}))
          .resolves.toMatchObject({title: 'Edited'})
        let version = draft.version
        for (const targetStatus of ['METADATA_COMPLETE', 'RIGHTS_COMPLETE', 'ISRC_COMPLETE', 'PRICING_COMPLETE'] as const) {
          version = (await service.transitionRelease(fixture.userId, fixture.release.id, {targetStatus, expectedVersion: version}) as {version: number}).version
        }
        // Edited releases are certified again before they go back to review.
        await expect(service.transitionRelease(fixture.userId, fixture.release.id, {targetStatus: 'SUBMITTED', expectedVersion: version})).rejects.toMatchObject({code: 'release_prerequisites_unmet'})
        await certifyRelease(fixture.userId, fixture.release.id)
        version = (await service.transitionRelease(fixture.userId, fixture.release.id, {targetStatus: 'SUBMITTED', expectedVersion: version}) as {version: number}).version
        const reviewing = await adminService().commandRelease(reviewerUserId, fixture.release.id, {action: 'start_review', expectedVersion: version}) as {version: number}
        await expect(service.withdrawSubmission(fixture.userId, fixture.release.id, reviewing.version)).rejects.toMatchObject({code: 'release_in_review'})
        await expect(service.updateTrack(fixture.userId, fixture.track.id, {title: 'Again', primaryArtistId: fixture.artist.id, discNumber: 1, trackNumber: 1, explicit: false, instrumental: false}))
          .rejects.toMatchObject({code: 'release_locked'})
      })

      it('prefills the last certification after a withdraw and lets staff play the master', async () => {
        const fixture = await submitted('Recertify')
        const submissions = new ReleaseSubmissionService(db() as never)
        const review = await adminService().getReleaseReview(reviewerUserId, fixture.release.id) as {tracks: Array<{audio_asset_id: string | null}>}
        const master = await pool.query(`SELECT id FROM marketplace_assets WHERE track_id = $1 AND kind = 'audio' AND processing_status = 'ready'`, [fixture.track.id])
        expect(review.tracks[0].audio_asset_id).toBe(master.rows[0].id)

        await service.withdrawSubmission(fixture.userId, fixture.release.id, fixture.version)
        const state = await submissions.getCertification(fixture.userId, fixture.release.id) as {draft: unknown; problems: string[]; previous: {thirdPartyMaterial: string; accepted: string[]; version: string} | null}
        expect(state.draft).toBeNull()
        expect(state.problems).toContain('rights certification')
        expect(state.previous).toMatchObject({thirdPartyMaterial: 'none', version: CERTIFICATION_VERSION})
        expect(state.previous!.accepted).toEqual(expect.arrayContaining(['original_recording', 'information_accurate']))
      })

      it('lets exactly one of a withdraw and a review start win', async () => {
        const fixture = await submitted('WithdrawRace')
        const outcomes = await Promise.allSettled([
          service.withdrawSubmission(fixture.userId, fixture.release.id, fixture.version),
          adminService().commandRelease(reviewerUserId, fixture.release.id, {action: 'start_review', expectedVersion: fixture.version}),
        ])
        expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
        const status = (await pool.query('SELECT status FROM releases WHERE id = $1', [fixture.release.id])).rows[0].status
        expect(['DRAFT', 'UNDER_REVIEW']).toContain(status)
      })

      it('applies approved changes to a scheduled release only after review, keeping one open request', async () => {
        const fixture = await guestPreorder('ChangeScheduled')
        const releaseId = fixture.release.release.id
        const owner = fixture.release
        await expect(service.updateTrack(owner.userId, owner.track.id, {title: 'Direct', primaryArtistId: owner.artist.id, discNumber: 1, trackNumber: 1, explicit: false, instrumental: false}))
          .rejects.toMatchObject({code: 'release_locked'})
        const newDate = new Date(Date.now() + 20 * DAY).toISOString()
        const saved = await changes().saveDraft(owner.userId, releaseId, {
          release: {title: 'ChangeScheduled Deluxe', requestedReleaseAt: newDate, additionalArtists: [{role: 'featured', name: 'Guest Singer'}]},
          tracks: [{trackId: owner.track.id, title: 'Renamed Track', credits: {featuredArtistIds: [], contributors: [{name: 'Writer One', role: 'writer', publisherName: null}]}}],
          audioReplacements: [],
        }) as {request: {id: string; status: string; diff: Array<{key: string}>}}
        expect(saved.request.status).toBe('draft')
        expect(saved.request.diff.map((item) => item.key)).toEqual(expect.arrayContaining(['release.title', 'release.requestedReleaseAt', 'release.additionalArtists', `track.${owner.track.id}.title`, `track.${owner.track.id}.credits`]))
        // Nothing changes on the release while the request is open.
        expect((await pool.query('SELECT title FROM releases WHERE id = $1', [releaseId])).rows[0].title).toBe('ChangeScheduled Release')
        await expect(pool.query(`INSERT INTO release_change_requests (id, provider_profile_id, release_id, base_release_version) VALUES ($1, $2, $3, 1)`, [crypto.randomUUID(), owner.provider.id, releaseId]))
          .rejects.toMatchObject({code: '23505'})

        const audioId = await stagedAudio(owner, saved.request.id)
        // Staged audio is invisible: the preview sweep and the store ignore it.
        await ensurePreviewJobs(db() as never)
        expect((await pool.query('SELECT 1 FROM audio_processing_jobs WHERE source_asset_id = $1', [audioId])).rowCount).toBe(0)
        await changes().saveDraft(owner.userId, releaseId, {
          release: {title: 'ChangeScheduled Deluxe', requestedReleaseAt: newDate, additionalArtists: [{role: 'featured', name: 'Guest Singer'}]},
          tracks: [{trackId: owner.track.id, title: 'Renamed Track', credits: {featuredArtistIds: [], contributors: [{name: 'Writer One', role: 'writer', publisherName: null}]}}],
          audioReplacements: [{trackId: owner.track.id, assetId: audioId}],
        })
        const sent = await changes().submit(owner.userId, releaseId) as {status: string; same_recording_required: boolean}
        expect(sent).toMatchObject({status: 'submitted', same_recording_required: false})
        await expect(changes().saveDraft(owner.userId, releaseId, {release: {title: 'Other'}, tracks: [], audioReplacements: []})).rejects.toMatchObject({code: 'change_request_submitted'})
        await expect(changes().command(owner.userId, saved.request.id, {action: 'approve', confirmSameRecording: false})).rejects.toMatchObject({code: 'marketplace_staff_required'})

        await changes().command(reviewerUserId, saved.request.id, {action: 'start_review'})
        await expect(changes().withdraw(owner.userId, releaseId)).rejects.toMatchObject({code: 'change_request_in_review'})
        const filesBefore = (await pool.query('SELECT storage_key FROM download_entitlement_files WHERE entitlement_id = $1', [fixture.entitlement.id])).rows
        const approved = await changes().command(reviewerUserId, saved.request.id, {action: 'approve', confirmSameRecording: false})
        expect(approved.request).toMatchObject({status: 'approved'})

        const release = (await pool.query('SELECT title, version, scheduled_release_at, requested_release_at FROM releases WHERE id = $1', [releaseId])).rows[0]
        expect(release.title).toBe('ChangeScheduled Deluxe')
        expect(new Date(release.scheduled_release_at).toISOString()).toBe(newDate)
        expect(new Date(release.requested_release_at).toISOString()).toBe(newDate)
        expect((await pool.query('SELECT title FROM tracks WHERE id = $1', [owner.track.id])).rows[0].title).toBe('Renamed Track')
        expect((await pool.query('SELECT display_name FROM release_artist_credits WHERE release_id = $1', [releaseId])).rows).toEqual([{display_name: 'Guest Singer'}])
        expect((await pool.query('SELECT name FROM track_contributors WHERE track_id = $1', [owner.track.id])).rows).toEqual([{name: 'Writer One'}])
        expect((await pool.query('SELECT processing_status FROM marketplace_assets WHERE id = $1', [audioId])).rows[0].processing_status).toBe('ready')
        // The approved audio is now the source the preview sweep uses.
        await ensurePreviewJobs(db() as never)
        expect((await pool.query('SELECT 1 FROM audio_processing_jobs WHERE source_asset_id = $1', [audioId])).rowCount).toBe(1)
        // Pre-order buyers are told about the new date and keep the files they paid for.
        const jobs = await pool.query(`SELECT payload FROM marketplace_email_jobs WHERE entitlement_id = $1 AND kind = 'release_date_changed'`, [fixture.entitlement.id])
        expect(jobs.rows).toHaveLength(1)
        expect((await pool.query('SELECT storage_key FROM download_entitlement_files WHERE entitlement_id = $1', [fixture.entitlement.id])).rows).toEqual(filesBefore)
      })

      it('lets a scheduled pre-order turn on previews before release, only once staff approve', async () => {
        const owner = await scheduledPreorder('ChangePreviewTiming')
        const clipId = await addClip(owner, null)
        const store = new StoreService(db() as never)
        const trackPreview = async () => (await store.getRelease(owner.release.id) as {tracks: Array<{preview_asset_id: string | null}>}).tracks[0].preview_asset_id
        expect(await trackPreview()).toBeNull()

        const saved = await changes().saveDraft(owner.userId, owner.release.id, {release: {previewTiming: 'before_release'}, tracks: [], audioReplacements: []}) as {request: {id: string; diff: Array<{key: string; before: unknown; after: unknown}>}}
        expect(saved.request.diff).toEqual([expect.objectContaining({key: 'release.previewTiming', before: 'after_release', after: 'before_release'})])
        await changes().submit(owner.userId, owner.release.id)
        // Still hidden while the request waits for review.
        expect(await trackPreview()).toBeNull()

        await changes().command(reviewerUserId, saved.request.id, {action: 'start_review'})
        await changes().command(reviewerUserId, saved.request.id, {action: 'approve', confirmSameRecording: false})
        expect((await pool.query('SELECT preview_timing, status FROM releases WHERE id = $1', [owner.release.id])).rows[0]).toEqual({preview_timing: 'before_release', status: 'SCHEDULED'})
        expect(await trackPreview()).toBe(clipId)
        await expect(store.getAsset(clipId)).resolves.toMatchObject({kind: 'audio_preview'})
      })

      it('changes a song\'s preview length through review, re-checking the start against it', async () => {
        const owner = await scheduledPreorder('ChangePreviewLength')
        await pool.query('UPDATE tracks SET duration_ms = 200000, preview_start_ms = 180000 WHERE id = $1', [owner.track.id])
        await expect(changes().saveDraft(owner.userId, owner.release.id, {release: {}, tracks: [{trackId: owner.track.id, previewLengthMs: 30_000}], audioReplacements: []}))
          .rejects.toMatchObject({code: 'preview_start_too_late'})
        const saved = await changes().saveDraft(owner.userId, owner.release.id, {release: {}, tracks: [{trackId: owner.track.id, previewLengthMs: 20_000}], audioReplacements: []}) as {request: {id: string; diff: Array<{key: string; before: unknown; after: unknown}>}}
        expect(saved.request.diff).toEqual([expect.objectContaining({key: `track.${owner.track.id}.previewLengthMs`, before: 15_000, after: 20_000})])
        await changes().submit(owner.userId, owner.release.id)
        expect((await pool.query('SELECT preview_length_ms FROM tracks WHERE id = $1', [owner.track.id])).rows[0].preview_length_ms).toBe(15_000)
        await changes().command(reviewerUserId, saved.request.id, {action: 'start_review'})
        await changes().command(reviewerUserId, saved.request.id, {action: 'approve', confirmSameRecording: false})
        expect((await pool.query('SELECT preview_length_ms, preview_start_ms FROM tracks WHERE id = $1', [owner.track.id])).rows[0]).toEqual({preview_length_ms: 20_000, preview_start_ms: 180_000})
      })

      it("lets only the owner play their song files, giving the preview picker MeJay's MP3 when it exists", async () => {
        await resetIsrcState()
        const live = await prepareLiveRelease('OwnAudio')
        const master = (await pool.query<{id: string}>(`SELECT id FROM marketplace_assets WHERE track_id = $1 AND kind = 'audio' AND processing_status = 'ready'`, [live.track.id])).rows[0].id
        const listen = async () => (await service.getRelease(live.userId, live.release.id) as {tracks: Array<{listen_asset_id: string | null}>}).tracks[0].listen_asset_id
        const derived = async (kind: 'audio_delivery' | 'audio_preview', sourceAssetId: string) => {
          const id = crypto.randomUUID()
          await pool.query(
            `INSERT INTO marketplace_assets (id, provider_profile_id, track_id, kind, storage_key, mime_type, byte_size, processing_status, metadata)
             VALUES ($1, $2, $3, $4, $5, 'audio/mpeg', 1000, 'ready', $6)`,
            [id, live.provider.id, live.track.id, kind, `mejay-artist/${live.provider.id}/${kind}/${live.track.id}/${id}.mp3`, JSON.stringify({sourceAssetId, fileName: 'song.mp3'})],
          )
          return id
        }
        await pool.query(`DELETE FROM marketplace_assets WHERE track_id = $1 AND kind = 'audio_delivery'`, [live.track.id])
        // This file's fixture keeps uploads under a test path; real uploads live under MeJay's prefix.
        await pool.query(`UPDATE marketplace_assets SET storage_key = $2 WHERE id = $1`, [master, `mejay-artist/${live.provider.id}/audio/${live.track.id}/${master}.wav`])
        // Before MeJay makes the MP3 the picker plays the master; an MP3 of some other upload does not count.
        expect(await listen()).toBe(master)
        await derived('audio_delivery', crypto.randomUUID())
        expect(await listen()).toBe(master)
        const delivery = await derived('audio_delivery', master)
        expect(await listen()).toBe(delivery)

        await expect(service.getOwnAudio(live.userId, delivery)).resolves.toMatchObject({mimeType: 'audio/mpeg', fileName: 'song.mp3'})
        await expect(service.getOwnAudio(live.userId, master)).resolves.toMatchObject({storageKey: expect.stringMatching(/^mejay-artist\//)})
        const draft = await changes().saveDraft(live.userId, live.release.id, {release: {}, tracks: [], audioReplacements: []}) as {request: {id: string}}
        const staged = await stagedAudio(live, draft.request.id)
        await expect(service.getOwnAudio(live.userId, staged)).resolves.toMatchObject({mimeType: 'audio/wav'})

        // Not other providers' songs, and not preview clips or other kinds through this route.
        const other = await createProviderFixture('OwnAudioOther')
        await expect(service.getOwnAudio(other.userId, master)).rejects.toMatchObject({code: 'not_found'})
        await expect(service.getOwnAudio(other.userId, staged)).rejects.toMatchObject({code: 'not_found'})
        await expect(service.getOwnAudio(live.userId, await derived('audio_preview', master))).rejects.toMatchObject({code: 'not_found'})
        const artwork = (await pool.query<{id: string}>(`SELECT id FROM marketplace_assets WHERE release_id = $1 AND kind = 'artwork' LIMIT 1`, [live.release.id])).rows[0]
        if (artwork) await expect(service.getOwnAudio(live.userId, artwork.id)).rejects.toMatchObject({code: 'not_found'})
        // A failed upload is never played.
        await pool.query(`UPDATE marketplace_assets SET processing_status = 'failed' WHERE id = $1`, [staged])
        await expect(service.getOwnAudio(live.userId, staged)).rejects.toMatchObject({code: 'not_found'})
      })

      it('requires a same-song confirmation for audio on a live release, and rejection changes nothing', async () => {
        await resetIsrcState()
        const live = await prepareLiveRelease('ChangeLive')
        const draft = await changes().saveDraft(live.userId, live.release.id, {release: {}, tracks: [], audioReplacements: []}) as {request: {id: string}}
        const audioId = await stagedAudio(live, draft.request.id)
        await changes().saveDraft(live.userId, live.release.id, {release: {genre: 'House'}, tracks: [], audioReplacements: [{trackId: live.track.id, assetId: audioId}]})
        await expect(changes().saveDraft(live.userId, live.release.id, {release: {requestedReleaseAt: new Date(Date.now() + 30 * DAY).toISOString()}, tracks: [], audioReplacements: []}))
          .rejects.toMatchObject({code: 'release_already_live'})
        const sent = await changes().submit(live.userId, live.release.id) as {same_recording_required: boolean}
        expect(sent.same_recording_required).toBe(true)
        const review = await changes().getForReview(reviewerUserId, draft.request.id) as {sameRecordingRequired: boolean; request: {diff: Array<{key: string}>}}
        expect(review.sameRecordingRequired).toBe(true)
        expect(review.request.diff.map((item) => item.key)).toEqual(['release.genre', `track.${live.track.id}.audio`])
        await expect(changes().command(reviewerUserId, draft.request.id, {action: 'approve', confirmSameRecording: false})).rejects.toMatchObject({code: 'same_recording_confirmation_required'})

        const rejected = await changes().command(reviewerUserId, draft.request.id, {action: 'reject', note: 'This sounds like a different song.'})
        expect(rejected.request).toMatchObject({status: 'rejected', review_note: 'This sounds like a different song.'})
        expect(rejected.discardedStorageKeys).toHaveLength(1)
        expect((await pool.query('SELECT processing_status FROM marketplace_assets WHERE id = $1', [audioId])).rows[0].processing_status).toBe('failed')
        expect((await pool.query('SELECT genre, version FROM releases WHERE id = $1', [live.release.id])).rows[0]).toMatchObject({genre: null, version: live.version})

        // A new request after rejection; this time confirmed as the same recording.
        const again = await changes().saveDraft(live.userId, live.release.id, {release: {}, tracks: [], audioReplacements: []}) as {request: {id: string}}
        const second = await stagedAudio(live, again.request.id)
        await changes().saveDraft(live.userId, live.release.id, {release: {}, tracks: [], audioReplacements: [{trackId: live.track.id, assetId: second}]})
        await changes().submit(live.userId, live.release.id)
        const approved = await changes().command(reviewerUserId, again.request.id, {action: 'approve', confirmSameRecording: true})
        expect(approved.request).toMatchObject({status: 'approved', same_recording_confirmed: true})
      })

      it('refuses an empty or stale request, and lets the artist withdraw a submitted one', async () => {
        await resetIsrcState()
        const live = await prepareLiveRelease('ChangeStale')
        await changes().saveDraft(live.userId, live.release.id, {release: {title: 'ChangeStale Release'}, tracks: [], audioReplacements: []})
        await expect(changes().submit(live.userId, live.release.id)).rejects.toMatchObject({code: 'change_request_empty'})
        const draft = await changes().saveDraft(live.userId, live.release.id, {release: {title: 'Stale Title'}, tracks: [], audioReplacements: []}) as {request: {id: string}}
        await changes().submit(live.userId, live.release.id)
        const withdrawn = await changes().withdraw(live.userId, live.release.id)
        expect(withdrawn.request).toMatchObject({status: 'withdrawn'})

        const next = await changes().saveDraft(live.userId, live.release.id, {release: {title: 'Stale Title'}, tracks: [], audioReplacements: []}) as {request: {id: string}}
        expect(next.request.id).not.toBe(draft.request.id)
        await changes().submit(live.userId, live.release.id)
        await pool.query(`UPDATE releases SET title = 'Changed Elsewhere' WHERE id = $1`, [live.release.id])
        await expect(changes().command(reviewerUserId, next.request.id, {action: 'approve', confirmSameRecording: false})).rejects.toMatchObject({code: 'change_request_stale'})
        // An admin action that bumps the version without touching the requested fields is not a conflict.
        await pool.query(`UPDATE releases SET title = 'ChangeStale Release', version = version + 5 WHERE id = $1`, [live.release.id])
        await expect(changes().command(reviewerUserId, next.request.id, {action: 'approve', confirmSameRecording: false})).resolves.toMatchObject({request: {status: 'approved'}})
      })

      it('only accepts change-request uploads for a draft request on the same release', async () => {
        await resetIsrcState()
        const live = await prepareLiveRelease('ChangeUpload')
        const other = await createProviderFixture('ChangeUploadOther')
        const draft = await changes().saveDraft(live.userId, live.release.id, {release: {}, tracks: [], audioReplacements: []}) as {request: {id: string}}
        await expect(service.initiateUpload(live.userId, {kind: 'audio', trackId: live.track.id, fileName: 'x.wav', byteSize: 1000, mimeType: 'audio/wav'}, wavBucket() as never))
          .rejects.toMatchObject({code: 'release_locked'})
        await expect(service.initiateUpload(other.userId, {kind: 'audio', trackId: other.track.id, fileName: 'x.wav', byteSize: 1000, mimeType: 'audio/wav', changeRequestId: draft.request.id}, wavBucket() as never))
          .rejects.toMatchObject({code: 'change_request_not_found'})
        await expect(changes().saveDraft(live.userId, live.release.id, {release: {}, tracks: [], audioReplacements: [{trackId: live.track.id, assetId: crypto.randomUUID()}]}))
          .rejects.toMatchObject({code: 'change_request_asset_invalid'})
        await expect(changes().saveDraft(other.userId, other.release.id, {release: {title: 'Nope'}, tracks: [], audioReplacements: []}))
          .rejects.toMatchObject({code: 'release_not_changeable'})
      })
    })
  })

  describe('editorial stories', () => {
    const stories = () => new EditorialStoryService(new Database(connectionString!, pool) as never)
    /** A minimal PNG header: signature + IHDR with the given size, enough for byte inspection. */
    const png = (width: number, height: number) => {
      const bytes = new Uint8Array(33)
      bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82])
      new DataView(bytes.buffer).setUint32(16, width)
      new DataView(bytes.buffer).setUint32(20, height)
      bytes[24] = 8
      bytes[25] = 2
      return bytes
    }
    const imageBucket = (width: number, height: number, byteSize = 500_000) => ({
      createUploadUrl: async () => 'https://upload.test',
      head: async () => ({byteSize, contentType: 'image/png'}),
      getExact: async () => ({body: new Response(png(width, height)).body!}),
    })

    async function uploadImage(storyId: string, role: 'cover' | 'background' | 'gallery' | 'inline', size = {width: 1600, height: 900}) {
      const started = await stories().initiateUpload(adminUserId, storyId, {role, fileName: 'photo.png', mimeType: 'image/png', byteSize: 500_000, ...size}, imageBucket(size.width, size.height) as never) as {media: {id: string}}
      return (await stories().finalizeUpload(adminUserId, started.media.id, imageBucket(size.width, size.height) as never) as {id: string}).id
    }

    type AdminStory = {id: string; slug: string; version: number; status: string; featured: boolean; publishProblems: string[]}
    const baseInput = (story: AdminStory, overrides: Record<string, unknown> = {}) => ({
      expectedVersion: story.version, template: 'headliner' as const, title: 'Detroit Has Something to Say', slug: story.slug,
      teaser: 'Inside the studios pushing Detroit forward.', authorName: 'MeJay Editorial', category: 'Stories', tags: ['detroit'],
      content: [{type: 'paragraph' as const, text: 'Detroit has always been more than **music**.'}],
      appearance: {palette: 'ink' as const, overlay: 50, coverFocal: {x: 50, y: 40}}, media: [], ...overrides,
    })

    async function publishedStory(title: string) {
      const created = await stories().create(adminUserId, {template: 'headliner', title}) as AdminStory
      const coverId = await uploadImage(created.id, 'cover')
      const saved = await stories().update(adminUserId, created.id, baseInput(created, {title, coverMediaId: coverId, media: [{mediaId: coverId, altText: 'Producer at a mixing desk'}]})) as AdminStory
      return await stories().command(adminUserId, created.id, {action: 'publish', expectedVersion: saved.version}) as AdminStory
    }

    beforeAll(async () => {
      await pool.query('DELETE FROM editorial_stories')
    })

    it('lets only marketplace admins create and change stories', async () => {
      await expect(stories().create(reviewerUserId, {template: 'headliner', title: 'Nope'})).rejects.toMatchObject({code: 'marketplace_admin_required'})
      await expect(stories().create(crypto.randomUUID(), {template: 'headliner', title: 'Nope'})).rejects.toMatchObject({code: 'marketplace_staff_required'})
      const story = await stories().create(adminUserId, {template: 'headliner', title: 'Staff Only'}) as AdminStory
      await expect(stories().get(reviewerUserId, story.id)).resolves.toMatchObject({id: story.id})
      await expect(stories().update(reviewerUserId, story.id, baseInput(story))).rejects.toMatchObject({code: 'marketplace_admin_required'})
      await expect(stories().command(reviewerUserId, story.id, {action: 'publish', expectedVersion: story.version})).rejects.toMatchObject({code: 'marketplace_admin_required'})
      await expect(stories().initiateUpload(reviewerUserId, story.id, {role: 'cover', fileName: 'a.png', mimeType: 'image/png', byteSize: 10, width: 1600, height: 900}, imageBucket(1600, 900) as never))
        .rejects.toMatchObject({code: 'marketplace_admin_required'})
    })

    it('keeps drafts private, checks completeness before publishing and locks the link afterwards', async () => {
      const draft = await stories().create(adminUserId, {template: 'headliner', title: 'Detroit Has Something to Say'}) as AdminStory
      const twin = await stories().create(adminUserId, {template: 'headliner', title: 'Detroit Has Something to Say'}) as AdminStory
      expect(draft.slug).toBe('detroit-has-something-to-say')
      expect(twin.slug).toBe('detroit-has-something-to-say-2')
      await expect(stories().getPublished(draft.slug)).rejects.toMatchObject({status: 404})
      await expect(stories().command(adminUserId, draft.id, {action: 'publish', expectedVersion: draft.version})).rejects.toMatchObject({
        code: 'story_incomplete', details: expect.arrayContaining(['Add a teaser. It appears on story cards.', 'Write the article body.', 'Upload a cover image.']),
      })

      const coverId = await uploadImage(draft.id, 'cover')
      const unusedId = await uploadImage(draft.id, 'inline', {width: 900, height: 700})
      await expect(stories().update(adminUserId, draft.id, baseInput(draft, {expectedVersion: draft.version + 5}))).rejects.toMatchObject({code: 'stale_story_version'})
      const missingAlt = await stories().update(adminUserId, draft.id, baseInput(draft, {coverMediaId: coverId})) as AdminStory
      expect(missingAlt.publishProblems).toContain('Describe every image (alt text) so screen-reader users know what it shows.')
      const saved = await stories().update(adminUserId, draft.id, baseInput(missingAlt, {coverMediaId: coverId, media: [{mediaId: coverId, altText: 'Producer at a mixing desk', credit: 'MeJay'}]})) as AdminStory
      expect(saved.publishProblems).toEqual([])
      await expect(stories().getPublicMedia(coverId)).rejects.toMatchObject({status: 404})

      const published = await stories().command(adminUserId, draft.id, {action: 'publish', expectedVersion: saved.version}) as AdminStory
      expect(published.status).toBe('published')
      const view = await stories().getPublished(draft.slug) as Record<string, unknown>
      expect(view).toMatchObject({title: 'Detroit Has Something to Say', cover: {altText: 'Producer at a mixing desk', credit: 'MeJay'}})
      for (const privateField of ['id', 'version', 'status', 'created_by_user_id', 'updated_by_user_id', 'featured']) expect(view).not.toHaveProperty(privateField)
      await expect(stories().getPublicMedia(coverId)).resolves.toMatchObject({mimeType: 'image/png'})
      await expect(stories().getPublicMedia(unusedId)).rejects.toMatchObject({status: 404})
      await expect(stories().update(adminUserId, draft.id, baseInput(published, {slug: 'a-new-link', coverMediaId: coverId}))).rejects.toMatchObject({code: 'slug_locked'})
      expect((await stories().listPublished()).items).toEqual(expect.arrayContaining([expect.objectContaining({slug: draft.slug})]))

      const unpublished = await stories().command(adminUserId, draft.id, {action: 'unpublish', expectedVersion: published.version}) as AdminStory
      expect(unpublished.status).toBe('draft')
      await expect(stories().getPublished(draft.slug)).rejects.toMatchObject({status: 404})
      await expect(stories().getPublicMedia(coverId)).rejects.toMatchObject({status: 404})
      const archived = await stories().command(adminUserId, draft.id, {action: 'archive', expectedVersion: unpublished.version}) as AdminStory
      expect(archived.status).toBe('archived')
      await expect(stories().update(adminUserId, draft.id, baseInput(archived))).rejects.toMatchObject({code: 'story_archived'})
      expect((await stories().listPublished()).items).not.toEqual(expect.arrayContaining([expect.objectContaining({slug: draft.slug})]))
    })

    it('counts views of published stories once per visitor per half hour, and never for drafts', async () => {
      const story = await publishedStory('Counted Views')
      const request = (ip: string) => ({request: new Request(`https://mejay.app/api/stories/${story.slug}/views`, {method: 'POST', headers: {'x-mejay-client-ip': ip}}), env: {DB: new Database(connectionString!, pool) as never}, params: {slug: story.slug}})
      const first = await (await recordStoryView(request('203.0.113.7'))).json() as {data: {counted: boolean; views: number}}
      expect(first.data).toEqual({counted: true, views: 1})
      const repeat = await (await recordStoryView(request('203.0.113.7'))).json() as {data: {counted: boolean; views: number}}
      expect(repeat.data).toEqual({counted: false, views: 1})
      const other = await (await recordStoryView(request('198.51.100.9'))).json() as {data: {counted: boolean; views: number}}
      expect(other.data).toEqual({counted: true, views: 2})
      expect(await stories().getPublished(story.slug)).toMatchObject({viewCount: 2})

      const draft = await stories().create(adminUserId, {template: 'headliner', title: 'Uncounted Draft'}) as AdminStory
      expect((await recordStoryView({...request('192.0.2.1'), params: {slug: draft.slug}})).status).toBe(404)
      expect((await pool.query('SELECT view_count FROM editorial_stories WHERE id = $1', [draft.id])).rows[0].view_count).toBe('0')
    })

    it('rejects images that are not what they claim, and keeps the failure visible', async () => {
      const story = await stories().create(adminUserId, {template: 'headliner', title: 'Upload Checks'}) as AdminStory
      expect(() => mediaUploadSchema.parse({role: 'cover', fileName: 'small.png', mimeType: 'image/png', byteSize: 10, width: 600, height: 400})).toThrow(/at least 1200 x 630/)
      expect(() => mediaUploadSchema.parse({role: 'cover', fileName: 'huge.png', mimeType: 'image/png', byteSize: 16 * 1024 * 1024, width: 1600, height: 900})).toThrow(/15 MB/)
      expect(() => mediaUploadSchema.parse({role: 'cover', fileName: 'x.gif', mimeType: 'image/gif', byteSize: 10, width: 1600, height: 900})).toThrow()
      const started = await stories().initiateUpload(adminUserId, story.id, {role: 'cover', fileName: 'lie.png', mimeType: 'image/png', byteSize: 500_000, width: 1600, height: 900}, imageBucket(1600, 900) as never) as {media: {id: string}}
      await expect(stories().finalizeUpload(adminUserId, started.media.id, imageBucket(1300, 700) as never)).rejects.toMatchObject({code: 'upload_validation_failed'})
      expect((await pool.query('SELECT status FROM editorial_media WHERE id = $1', [started.media.id])).rows[0].status).toBe('failed')
      await expect(stories().update(adminUserId, story.id, baseInput(story, {coverMediaId: started.media.id}))).rejects.toMatchObject({code: 'media_not_ready'})
    })

    it('keeps exactly one featured story, replacing it atomically and clearing it on unpublish', async () => {
      await pool.query(`UPDATE editorial_stories SET featured = FALSE`)
      const first = await publishedStory('First Feature')
      const second = await publishedStory('Second Feature')
      const featuredFirst = await stories().command(adminUserId, first.id, {action: 'feature', expectedVersion: first.version}) as AdminStory
      expect(featuredFirst.featured).toBe(true)
      await Promise.allSettled([
        stories().command(adminUserId, second.id, {action: 'feature', expectedVersion: second.version}),
        stories().command(adminUserId, second.id, {action: 'feature', expectedVersion: second.version}),
      ])
      const featured = await pool.query(`SELECT id FROM editorial_stories WHERE featured`)
      expect(featured.rows).toEqual([{id: second.id}])
      expect((await stories().home()).featured).toMatchObject({slug: second.slug})
      const current = (await pool.query('SELECT version FROM editorial_stories WHERE id = $1', [second.id])).rows[0].version
      await stories().command(adminUserId, second.id, {action: 'unpublish', expectedVersion: current})
      expect((await pool.query(`SELECT COUNT(*)::int AS n FROM editorial_stories WHERE featured`)).rows[0].n).toBe(0)
      const home = await stories().home()
      expect(home.featured).not.toMatchObject({slug: second.slug})
      const draft = await stories().create(adminUserId, {template: 'headliner', title: 'Draft Only'}) as AdminStory
      await expect(stories().command(adminUserId, draft.id, {action: 'feature', expectedVersion: draft.version})).rejects.toMatchObject({code: 'story_not_published'})
    })

    it('links releases and artists only while they are public, and never copies their data', async () => {
      await resetIsrcState()
      const live = await prepareLiveRelease('StoryDrop')
      const drop = await stories().create(adminUserId, {template: 'release_drop', title: 'After Hours'}) as AdminStory
      const saved = await stories().update(adminUserId, drop.id, baseInput(drop, {template: 'release_drop', title: 'After Hours', releaseId: live.release.id, artistId: live.artist.id})) as AdminStory
      expect(saved.publishProblems).toEqual([])
      await stories().command(adminUserId, drop.id, {action: 'publish', expectedVersion: saved.version})
      const view = await stories().getPublished(drop.slug) as {release: {release: {id: string; amount_minor: number}} | null; artist: {slug: string} | null}
      expect(view.release?.release).toMatchObject({id: live.release.id, amount_minor: 999})
      expect(view.artist).toMatchObject({slug: expect.any(String)})
      const card = (await stories().listPublished()).items.find((item) => (item as {slug: string}).slug === drop.slug) as {image: {url: string} | null}
      expect(card.image?.url).toMatch(/^\/api\/store\/assets\//)

      await pool.query(`UPDATE releases SET status = 'TAKEN_DOWN' WHERE id = $1`, [live.release.id])
      await pool.query(`UPDATE provider_profiles SET suspended_at = CURRENT_TIMESTAMP WHERE id = $1`, [live.provider.id])
      const hidden = await stories().getPublished(drop.slug) as {release: unknown; artist: unknown}
      expect(hidden.release).toBeNull()
      expect(hidden.artist).toBeNull()
      const hiddenCard = (await stories().listPublished()).items.find((item) => (item as {slug: string}).slug === drop.slug) as {image: unknown}
      expect(hiddenCard.image).toBeNull()
      await pool.query(`UPDATE provider_profiles SET suspended_at = NULL WHERE id = $1`, [live.provider.id])
      await pool.query(`DELETE FROM releases WHERE id = $1`, [live.release.id]).catch(() => undefined)
    })

    it('lists only live releases with an offer, with playable preview clips, on Discover', async () => {
      await resetIsrcState()
      const live = await prepareLiveRelease('DiscoverNew')
      const clip = crypto.randomUUID()
      await pool.query(
        `INSERT INTO marketplace_assets (id, provider_profile_id, track_id, kind, storage_key, mime_type, byte_size, processing_status, metadata)
         VALUES ($1, $2, $3, 'audio_preview', $4, 'audio/mpeg', 1000, 'ready', '{}'::jsonb)`,
        [clip, live.provider.id, live.track.id, `mejay-artist/${live.provider.id}/audio_preview/${live.track.id}/${clip}.mp3`],
      )
      const scheduled = await prepareLiveRelease('DiscoverLater', {stage: 'pricing'})
      const overview = await new DiscoveryService(new Database(connectionString!, pool) as never).getOverview()
      const listed = overview.newestReleases.find((release) => release.id === live.release.id)
      expect(listed).toMatchObject({preview_asset_id: clip})
      expect(overview.newestReleases.some((release) => release.id === scheduled.release.id)).toBe(false)
    })
  })
})
