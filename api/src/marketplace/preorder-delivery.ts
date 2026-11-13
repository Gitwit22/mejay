/**
 * Pre-order delivery state shared by admin review, the release scheduler and checkout.
 *
 * A paid pre-order is a normal paid order whose entitlement is `delivery_status = 'held'`. Payment
 * state (orders.payment_status, entitlements.status) is never changed here. Every function is safe to
 * run repeatedly: unlocks only touch held rows, and emails are enqueued under unique dedupe keys.
 */

import {downloadAssetSql, downloadFileName} from './download-asset'

type Statement = {
  bind: (...values: unknown[]) => Statement
  first: <T = Record<string, unknown>>() => Promise<T | null>
  all: <T = Record<string, unknown>>() => Promise<{results: T[]}>
  run: () => Promise<unknown>
}

type Database = {prepare: (sql: string) => Statement}

export type EmailJobKind = 'release_day' | 'release_date_changed' | 'preorder_canceled'

/** Orders whose payment can still be refunded through a pre-order cancellation. */
const REFUNDABLE_PAYMENT_STATUSES = `('paid', 'partially_refunded')`

/** Inserts an email job once per dedupe key; repeated calls are no-ops. Returns true when inserted. */
export async function enqueueEmailJob(db: Database, job: {
  dedupeKey: string
  kind: EmailJobKind
  orderId: string
  entitlementId?: string | null
  payload?: Record<string, unknown>
}): Promise<boolean> {
  const row = await db.prepare(
    `INSERT INTO marketplace_email_jobs (id, dedupe_key, kind, order_id, entitlement_id, payload)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
  ).bind(crypto.randomUUID(), job.dedupeKey, job.kind, job.orderId, job.entitlementId ?? null, JSON.stringify(job.payload ?? {})).first<{id: string}>()
  return Boolean(row)
}

/** Paid pre-order entitlements of a release that are still waiting for release day. */
export async function heldPreorderCount(db: Database, releaseId: string): Promise<number> {
  const row = await db.prepare(
    `SELECT COUNT(*)::integer AS count FROM download_entitlements entitlement
     JOIN marketplace_order_items item ON item.id = entitlement.order_item_id
     JOIN marketplace_orders purchase_order ON purchase_order.id = entitlement.order_id
     WHERE item.release_id = ?1 AND entitlement.delivery_status = 'held' AND entitlement.status <> 'revoked'
       AND purchase_order.payment_status IN ${REFUNDABLE_PAYMENT_STATUSES}`,
  ).bind(releaseId).first<{count: number}>()
  return Number(row?.count ?? 0)
}

/**
 * Release day: make a LIVE release's held pre-orders downloadable and queue one release-day email
 * per entitlement. Run it in the transaction that publishes the release; repeating it changes nothing.
 */
export async function releaseHeldPreorders(db: Database, releaseId: string): Promise<{unlocked: number; queued: number}> {
  // Deliver the current file (e.g. a replacement master approved, or its tagged MP3 finished, after purchase).
  await refreshHeldPreorderFiles(db, {releaseId})
  const {results} = await db.prepare(
    `UPDATE download_entitlements entitlement SET delivery_status = 'available', delivery_available_at = CURRENT_TIMESTAMP,
       updated_at = CURRENT_TIMESTAMP
     FROM marketplace_order_items item, releases release
     WHERE item.id = entitlement.order_item_id AND release.id = item.release_id
       AND item.release_id = ?1 AND release.status = 'LIVE' AND entitlement.delivery_status = 'held'
     RETURNING entitlement.id, entitlement.order_id, entitlement.status`,
  ).bind(releaseId).all<{id: string; order_id: string; status: string}>()
  let queued = 0
  for (const entitlement of results) {
    // Suspended (disputed) or revoked purchases are unlocked for consistency but not emailed.
    if (entitlement.status !== 'active') continue
    if (await enqueueEmailJob(db, {dedupeKey: `release_day:${entitlement.id}`, kind: 'release_day', orderId: entitlement.order_id, entitlementId: entitlement.id})) queued += 1
  }
  return {unlocked: results.length, queued}
}

/**
 * Safety net for the scheduler: unlock held pre-orders of releases that are already LIVE, e.g. an
 * order whose payment was confirmed just after the release went live.
 */
export async function sweepLiveHeldPreorders(db: Database, limit = 50): Promise<number> {
  const {results} = await db.prepare(
    `SELECT DISTINCT item.release_id FROM download_entitlements entitlement
     JOIN marketplace_order_items item ON item.id = entitlement.order_item_id
     JOIN releases release ON release.id = item.release_id
     WHERE entitlement.delivery_status = 'held' AND release.status = 'LIVE'
     LIMIT ?1`,
  ).bind(limit).all<{release_id: string}>()
  let unlocked = 0
  for (const row of results) unlocked += (await releaseHeldPreorders(db, row.release_id)).unlocked
  return unlocked
}

/** Tell every active pre-order buyer about a new approved release time. Once per release version. */
export async function enqueueReleaseDateChange(db: Database, releaseId: string, releaseVersion: number, payload: {releaseAt: string; releaseTimezone: string | null; previousReleaseAt: string | null}): Promise<number> {
  const {results} = await db.prepare(
    `SELECT entitlement.id, entitlement.order_id FROM download_entitlements entitlement
     JOIN marketplace_order_items item ON item.id = entitlement.order_item_id
     WHERE item.release_id = ?1 AND entitlement.delivery_status = 'held' AND entitlement.status = 'active'`,
  ).bind(releaseId).all<{id: string; order_id: string}>()
  let queued = 0
  for (const entitlement of results) {
    if (await enqueueEmailJob(db, {
      dedupeKey: `release_date_changed:${entitlement.id}:${releaseVersion}`,
      kind: 'release_date_changed', orderId: entitlement.order_id, entitlementId: entitlement.id, payload,
    })) queued += 1
  }
  return queued
}

/**
 * Cancels a release's pre-orders: records one refund request per paid pre-order order and queues a
 * cancellation email. The refund itself is created afterwards by `processPreorderRefunds`, and the
 * existing charge.refunded webhook then posts the ledger entries and revokes the download.
 */
export async function requestPreorderCancellations(db: Database, releaseId: string, actorUserId: string | null): Promise<number> {
  const {results} = await db.prepare(
    `SELECT DISTINCT purchase_order.id, entitlement.id AS entitlement_id FROM marketplace_orders purchase_order
     JOIN download_entitlements entitlement ON entitlement.order_id = purchase_order.id
     JOIN marketplace_order_items item ON item.id = entitlement.order_item_id
     WHERE item.release_id = ?1 AND purchase_order.purchase_type = 'preorder'
       AND entitlement.delivery_status = 'held' AND purchase_order.payment_status IN ${REFUNDABLE_PAYMENT_STATUSES}`,
  ).bind(releaseId).all<{id: string; entitlement_id: string}>()
  for (const order of results) {
    await db.prepare(
      `INSERT INTO marketplace_preorder_cancellations (order_id, release_id, requested_by_user_id)
       VALUES (?1, ?2, ?3) ON CONFLICT (order_id) DO NOTHING`,
    ).bind(order.id, releaseId, actorUserId).run()
    await enqueueEmailJob(db, {dedupeKey: `preorder_canceled:${order.entitlement_id}`, kind: 'preorder_canceled', orderId: order.id, entitlementId: order.entitlement_id})
  }
  return results.length
}

/**
 * Point pre-orders that have not been delivered yet at the track's current download file. A held
 * pre-order has never been downloadable, so its buyer should get the file MeJay delivers today (the
 * tagged MP3 of the latest approved master), not whatever existed when they paid. Delivered purchases
 * keep their files. `trackId` limits it to one track; otherwise every track of the release. Repeating
 * it changes nothing.
 */
export async function refreshHeldPreorderFiles(db: Database, scope: {releaseId: string; trackId?: string}): Promise<number> {
  const {results: tracks} = await db.prepare(
    `SELECT track.id, track.title, track.track_number, asset.id AS asset_id, asset.storage_key, asset.mime_type, asset.byte_size,
       asset.metadata->>'fileName' AS file_name
     FROM tracks track JOIN LATERAL (${downloadAssetSql('track.id')}) asset ON TRUE
     WHERE track.release_id = ?1 AND (?2 = '' OR track.id = ?2)`,
  ).bind(scope.releaseId, scope.trackId ?? '').all<{id: string; title: string; track_number: number; asset_id: string; storage_key: string; mime_type: string; byte_size: number | string; file_name: string | null}>()
  let updated = 0
  for (const track of tracks) {
    const {results} = await db.prepare(
      `UPDATE download_entitlement_files file SET source_asset_id = ?1, storage_key = ?2, mime_type = ?3, byte_size = ?4, file_name = ?5
       FROM download_entitlements entitlement
       WHERE entitlement.id = file.entitlement_id AND entitlement.delivery_status = 'held'
         AND file.track_id = ?6 AND file.source_asset_id IS DISTINCT FROM ?1
       RETURNING file.id`,
    ).bind(track.asset_id, track.storage_key, track.mime_type, Number(track.byte_size), downloadFileName(track.file_name, track, track.mime_type), track.id).all<{id: string}>()
    updated += results.length
  }
  return updated
}
