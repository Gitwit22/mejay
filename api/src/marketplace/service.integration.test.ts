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

    await expect(adminService().commandProvider(reviewerUserId, provider.id, {action: 'approve'}))
      .rejects.toMatchObject({code: 'marketplace_admin_required'})
    const approved = await adminService().commandProvider(adminUserId, provider.id, {action: 'approve'}) as {status: string}
    expect(approved.status).toBe('approved')
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

    async function startCheckout(label: string, stripeFee: number) {
      await resetIsrcState()
      const fixture = await prepareLiveRelease(label)
      const product = await pool.query<{id: string}>('SELECT id FROM products WHERE release_id = $1', [fixture.release.id])
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
        amount_total: 999,
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

    it('shows a public artist page only while the artist has LIVE music, and never exposes rights documents', async () => {
      await resetIsrcState()
      const draft = await prepareLiveRelease('Hidden', {stage: 'pricing'})
      const hiddenSlug = (await pool.query<{slug: string}>('SELECT slug FROM artists WHERE id = $1', [draft.artist.id])).rows[0].slug
      await expect(profiles().getPublicArtist(hiddenSlug)).rejects.toMatchObject({code: 'not_found'})

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

      // Taking the only LIVE release down removes the page and its imagery.
      await adminService().commandRelease(adminUserId, live.release.id, {action: 'takedown', expectedVersion: live.version, note: 'Rights claim'})
      await expect(profiles().getPublicArtist(slug)).rejects.toMatchObject({code: 'not_found'})
      await expect(store.getAsset(photoId)).rejects.toMatchObject({code: 'not_found'})
    })
  })
})
