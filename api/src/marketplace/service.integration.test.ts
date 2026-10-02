import {Pool} from 'pg'
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest'
import {Database} from '../db/client'
import {runMigrations} from '../db/migrations'
import {AccountDeletionService} from '../account/deletion'
import {MarketplaceAdminService} from './admin-service'
import {CommerceService} from './commerce-service'
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

    async function buyLiveRelease(label: string, stripeFee: number) {
      await resetIsrcState()
      const fixture = await prepareLiveRelease(label)
      const product = await pool.query<{id: string}>('SELECT id FROM products WHERE release_id = $1', [fixture.release.id])
      const buyerId = crypto.randomUUID()
      await pool.query(`INSERT INTO users (id, email, account_intent) VALUES ($1, $2, 'consumer')`, [buyerId, `buyer-${buyerId.slice(0, 8)}@example.test`])
      const calls = stubStripe(stripeFee)
      const commerce = new CommerceService(new Database(connectionString!, pool) as never, 'sk_test', 1000)
      const checkout = await commerce.createCheckout(buyerId, product.rows[0].id, 'https://app.test')
      const attempt = await pool.query<{id: string}>('SELECT id FROM marketplace_checkout_attempts WHERE stripe_checkout_session_id = $1', [checkout.sessionId])
      const {orderId} = await commerce.fulfillPaidSession({
        id: checkout.sessionId,
        payment_status: 'paid',
        payment_intent: `pi_${crypto.randomUUID()}`,
        amount_total: 999,
        currency: 'usd',
        metadata: {kind: 'marketplace_purchase', attemptId: attempt.rows[0].id, userId: buyerId, productId: product.rows[0].id},
      })
      const order = await pool.query('SELECT * FROM marketplace_orders WHERE id = $1', [orderId])
      return {commerce, calls, order: order.rows[0], buyerId}
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
})