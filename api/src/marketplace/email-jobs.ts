import {sendResendEmail} from '../services/email'
import {describeGuestPurchase, downloadPageUrl, issueEmailLink, purchasesForEmail} from './guest-access'
import {ACCOUNT_INVITE, appOrigin, escapeHtml, renderEmail, sendOrderConfirmation, supportLine, type OrderEmailEnv} from './order-email'
import {formatReleaseTime} from './release-schedule'

type Statement = {
  bind: (...values: unknown[]) => Statement
  first: <T = Record<string, unknown>>() => Promise<T | null>
  all: <T = Record<string, unknown>>() => Promise<{results: T[]}>
  run: () => Promise<unknown>
}

type Database = {prepare: (sql: string) => Statement}

export const EMAIL_JOB_MAX_ATTEMPTS = 6
const BACKOFF_BASE_MINUTES = 5

type JobRow = {
  id: string
  dedupe_key: string
  kind: 'release_day' | 'release_date_changed' | 'preorder_canceled'
  order_id: string
  entitlement_id: string | null
  payload: Record<string, unknown> | string
  attempts: number
}

type JobContext = {
  entitlement_status: string | null
  delivery_status: string | null
  account_email: string | null
  buyer_email: string | null
  buyer_user_id: string | null
  product_name: string
  release_title: string
  artist_name: string
  track_id: string | null
  scheduled_release_at: string | Date | null
  release_timezone: string | null
}

type Message = {to: string; subject: string; text: string; html: string} | {skip: string}

/** Backoff after the n-th failed attempt: 5, 10, 20, 40, 80 minutes. */
export function emailRetryDelayMinutes(attempts: number): number {
  return BACKOFF_BASE_MINUTES * 2 ** Math.max(0, attempts - 1)
}

async function claimNextJob(db: Database): Promise<JobRow | null> {
  // A job stuck in 'sending' (crash mid-send) becomes claimable again after ten minutes.
  return db.prepare(
    `UPDATE marketplace_email_jobs SET status = 'sending', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP
     WHERE id = (
       SELECT id FROM marketplace_email_jobs
       WHERE next_attempt_at <= CURRENT_TIMESTAMP AND (
         status = 'pending' OR (status = 'sending' AND updated_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes'))
       ORDER BY next_attempt_at FOR UPDATE SKIP LOCKED LIMIT 1
     )
     RETURNING id, dedupe_key, kind, order_id, entitlement_id, payload, attempts`,
  ).first<JobRow>()
}

async function loadContext(db: Database, job: JobRow): Promise<JobContext | null> {
  return db.prepare(
    `SELECT entitlement.status AS entitlement_status, entitlement.delivery_status, buyer.email AS account_email,
       COALESCE(entitlement.buyer_email, purchase_order.buyer_email) AS buyer_email, purchase_order.buyer_user_id,
       item.product_name, item.release_title, item.artist_name, item.catalog_snapshot->>'track_id' AS track_id,
       release.scheduled_release_at, release.release_timezone
     FROM marketplace_orders purchase_order
     JOIN marketplace_order_items item ON item.order_id = purchase_order.id
     LEFT JOIN download_entitlements entitlement ON entitlement.id = ?2
     LEFT JOIN releases release ON release.id = item.release_id
     LEFT JOIN users buyer ON buyer.id = purchase_order.buyer_user_id
     WHERE purchase_order.id = ?1
     ORDER BY item.created_at LIMIT 1`,
  ).bind(job.order_id, job.entitlement_id).first<JobContext>()
}

async function buildMessage(db: Database, env: OrderEmailEnv, job: JobRow, context: JobContext): Promise<Message> {
  // The purchase email (account email for account purchases) is the only recipient ever used.
  const to = context.account_email?.trim() || context.buyer_email?.trim() || ''
  if (!to) return {skip: 'no_recipient'}
  const origin = appOrigin(env)
  if (!origin) return {skip: 'frontend_url_missing'}
  const item = context.track_id ? `${context.product_name} (from ${context.release_title})` : context.release_title
  const payload = typeof job.payload === 'string' ? JSON.parse(job.payload) as Record<string, unknown> : job.payload
  const accountLine = context.buyer_user_id ? `Your purchase is also saved in Purchases: ${origin}/app/purchased` : ACCOUNT_INVITE
  const help = supportLine(env)

  if (job.kind === 'release_day') {
    if (context.entitlement_status !== 'active' || context.delivery_status !== 'available' || !job.entitlement_id) return {skip: 'not_deliverable'}
    const {token} = await issueEmailLink(db, {entitlementId: job.entitlement_id, orderId: job.order_id, recipientEmail: to, purpose: 'release_day'})
    const url = downloadPageUrl(origin, token)
    const lines = [`${item} by ${context.artist_name} is out now, and your pre-order is ready to download.`, 'The link works for 7 days without signing in.']
    return {
      to,
      subject: `Out now: ${item}`,
      text: [...lines, '', `Download your music: ${url}`, '', accountLine, 'Lost the link or it expired? Request a new one from the download page with this email address.', '', help].join('\n'),
      html: renderEmail({eyebrow: 'Your pre-order is ready', paragraphs: lines.map(escapeHtml), button: {label: 'Download your music', url}, footer: [accountLine, 'Lost the link or it expired? Request a new one from the download page with this email address.', help]}),
    }
  }

  if (job.kind === 'release_date_changed') {
    // Only meaningful while the pre-order is still waiting; skip if it has since been delivered or revoked.
    if (context.entitlement_status !== 'active' || context.delivery_status !== 'held') return {skip: 'no_longer_held'}
    const releaseAt = typeof payload.releaseAt === 'string' ? payload.releaseAt : context.scheduled_release_at
    if (!releaseAt) return {skip: 'no_release_date'}
    const label = formatReleaseTime(releaseAt, (payload.releaseTimezone as string | null) ?? context.release_timezone)
    const lines = [
      `The release date for your pre-order of ${item} by ${context.artist_name} has changed.`,
      `New release date: ${label}.`,
      "Your purchase is unchanged. We'll email your download link when it releases.",
    ]
    return {
      to,
      subject: `New release date: ${item}`,
      text: [...lines, '', help].join('\n'),
      html: renderEmail({eyebrow: 'Pre-order update', paragraphs: lines.map(escapeHtml), footer: [help]}),
    }
  }

  const lines = [
    `Your pre-order of ${item} by ${context.artist_name} was cancelled because the release will not go ahead as planned.`,
    "You'll receive a full refund to your original payment method. Refunds usually appear within 5-10 business days.",
  ]
  return {
    to,
    subject: `Pre-order cancelled: ${item}`,
    text: [...lines, '', help].join('\n'),
    html: renderEmail({eyebrow: 'Pre-order cancelled', paragraphs: lines.map(escapeHtml), footer: [help]}),
  }
}

async function finishJob(db: Database, job: JobRow, outcome: {status: 'sent' | 'skipped'; error?: string} | {status: 'retry'; error: string}): Promise<void> {
  if (outcome.status === 'retry') {
    const exhausted = job.attempts >= EMAIL_JOB_MAX_ATTEMPTS
    await db.prepare(
      `UPDATE marketplace_email_jobs SET status = ?1, last_error = ?2, updated_at = CURRENT_TIMESTAMP,
         next_attempt_at = CURRENT_TIMESTAMP + (?3 * INTERVAL '1 minute')
       WHERE id = ?4`,
    ).bind(exhausted ? 'failed' : 'pending', outcome.error, emailRetryDelayMinutes(job.attempts), job.id).run()
    return
  }
  await db.prepare(
    `UPDATE marketplace_email_jobs SET status = ?1, last_error = ?2, updated_at = CURRENT_TIMESTAMP,
       sent_at = CASE WHEN ?1 = 'sent' THEN CURRENT_TIMESTAMP ELSE sent_at END
     WHERE id = ?3`,
  ).bind(outcome.status, outcome.error ?? null, job.id).run()
}

/**
 * Sends due release-day, date-change and cancellation emails. Safe to run concurrently and
 * repeatedly: each job is claimed with SKIP LOCKED, Resend de-duplicates by the job's dedupe key,
 * and failures retry with backoff until EMAIL_JOB_MAX_ATTEMPTS, then stay 'failed' for staff.
 */
export async function processEmailJobs(db: Database, env: OrderEmailEnv, limit = 50): Promise<{sent: number; retried: number; skipped: number}> {
  const totals = {sent: 0, retried: 0, skipped: 0}
  for (let index = 0; index < limit; index += 1) {
    const job = await claimNextJob(db)
    if (!job) break
    try {
      const context = await loadContext(db, job)
      const message = context ? await buildMessage(db, env, job, context) : {skip: 'order_not_found'}
      if ('skip' in message) {
        await finishJob(db, job, {status: 'skipped', error: message.skip})
        totals.skipped += 1
        continue
      }
      const support = (env.SUPPORT_EMAIL ?? '').trim()
      const result = await sendResendEmail({env, ...message, ...(support ? {replyTo: support} : {}), idempotencyKey: `mejay-${job.dedupe_key}`})
      if (result.status === 'sent') {
        await finishJob(db, job, {status: 'sent'})
        totals.sent += 1
      } else {
        // Not configured is retried too: configuring email later still delivers release-day links.
        await finishJob(db, job, {status: 'retry', error: result.reason})
        totals.retried += 1
      }
    } catch (error) {
      console.error('[email-jobs] job failed', {jobId: job.id, kind: job.kind, error: error instanceof Error ? error.name : 'unknown'})
      await finishJob(db, job, {status: 'retry', error: 'internal_error'}).catch(() => undefined)
      totals.retried += 1
    }
  }
  return totals
}

/** Re-attempts purchase confirmations whose earlier send failed (they carry the buyer's download link). */
export async function retryFailedConfirmations(db: Database, env: OrderEmailEnv, limit = 20): Promise<number> {
  const {results} = await db.prepare(
    `SELECT order_id FROM marketplace_order_notifications
     WHERE kind = 'purchase_confirmation' AND attempts < 5 AND updated_at < CURRENT_TIMESTAMP - INTERVAL '5 minutes'
       AND (status = 'failed' OR (status = 'sending' AND updated_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes'))
     ORDER BY updated_at LIMIT ?1`,
  ).bind(limit).all<{order_id: string}>()
  let sent = 0
  for (const row of results) {
    if (await sendOrderConfirmation(db as never, env, row.order_id) === 'sent') sent += 1
  }
  return sent
}

/**
 * Lost or expired link: emails fresh 7-day links for every purchase made with this address, to that
 * address only. The caller always answers the same way whether or not purchases exist.
 */
export async function sendAccessRecovery(db: Database, env: OrderEmailEnv, normalizedEmail: string): Promise<'sent' | 'none' | 'failed'> {
  const purchases = await purchasesForEmail(db, normalizedEmail)
  const origin = appOrigin(env)
  if (purchases.length === 0 || !origin) return 'none'
  const items: Array<{text: string; html: string}> = []
  for (const purchase of purchases) {
    const info = describeGuestPurchase(purchase)
    const title = `${info.itemTitle} by ${info.artistName}`
    if (info.deliveryStatus === 'held') {
      const when = info.releaseAt ? formatReleaseTime(info.releaseAt, info.releaseTimezone) : 'release day'
      items.push({text: `${title}: pre-order, downloads open ${when}.`, html: `${escapeHtml(title)}: pre-order, downloads open ${escapeHtml(when)}.`})
      continue
    }
    const {token} = await issueEmailLink(db, {entitlementId: purchase.entitlement_id, orderId: purchase.order_id, recipientEmail: purchase.buyer_email, purpose: 'recovery'})
    const url = downloadPageUrl(origin, token)
    items.push({text: `${title}: ${url}`, html: `<a href="${escapeHtml(url)}">${escapeHtml(title)}</a>`})
  }
  const help = supportLine(env)
  const intro = 'Here are new download links for your MeJay purchases. Each link works for 7 days without signing in.'
  const result = await sendResendEmail({
    env,
    to: normalizedEmail,
    subject: 'Your MeJay download links',
    text: [intro, '', ...items.map((item) => item.text), '', "Didn't ask for this? You can ignore this email.", ACCOUNT_INVITE, help].join('\n'),
    html: renderEmail({eyebrow: 'Download links', paragraphs: [escapeHtml(intro), ...items.map((item) => item.html)], footer: ["Didn't ask for this? You can ignore this email.", ACCOUNT_INVITE, help]}),
  })
  return result.status === 'sent' ? 'sent' : 'failed'
}
