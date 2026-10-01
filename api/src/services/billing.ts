export type BillingCadence = 'monthly' | 'yearly'

export type SubscriptionState = {
  status: string
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string | null
  cadence: BillingCadence | null
}

/**
 * Statuses that grant Pro. `past_due` is Stripe's dunning window (payment retries in progress):
 * the subscriber keeps Pro while Stripe retries, and Stripe moves the subscription to
 * `unpaid`/`canceled` (which revokes Pro) once retries are exhausted.
 */
export function subscriptionGrantsPro(status: string): boolean {
  return status === 'active' || status === 'trialing' || status === 'past_due'
}

export function stripeTimestampToIso(timestamp: unknown): string | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return null
  return new Date(timestamp * 1000).toISOString()
}

export function cadenceFromPrice(priceId: unknown, monthlyPriceId: string, yearlyPriceId: string): BillingCadence | null {
  if (priceId === monthlyPriceId) return 'monthly'
  if (priceId === yearlyPriceId) return 'yearly'
  return null
}

export async function persistSubscriptionState(args: {
  db: any
  userId: string
  customerId: string | null
  subscriptionId: string | null
  state: SubscriptionState
  eventCreatedAt: string
}): Promise<void> {
  const {db, userId, customerId, subscriptionId, state, eventCreatedAt} = args
  const grantsPro = subscriptionGrantsPro(state.status)

  await db
    .prepare(
      [
        'INSERT INTO entitlements',
        '(user_id, access_type, has_full_access, stripe_customer_id, stripe_subscription_id, subscription_status, billing_cadence, cancel_at_period_end, current_period_end, stripe_event_created_at, updated_at)',
        'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, CURRENT_TIMESTAMP)',
        'ON CONFLICT(user_id) DO UPDATE SET',
        "access_type=CASE WHEN entitlements.access_type IN ('full', 'full_program') THEN entitlements.access_type ELSE excluded.access_type END,",
        "has_full_access=CASE WHEN entitlements.access_type IN ('full', 'full_program') THEN entitlements.has_full_access ELSE excluded.has_full_access END,",
        'stripe_customer_id=COALESCE(excluded.stripe_customer_id, entitlements.stripe_customer_id),',
        'stripe_subscription_id=excluded.stripe_subscription_id,',
        'subscription_status=excluded.subscription_status,',
        'billing_cadence=excluded.billing_cadence,',
        'cancel_at_period_end=excluded.cancel_at_period_end,',
        'current_period_end=excluded.current_period_end,',
        'stripe_event_created_at=excluded.stripe_event_created_at,',
        'updated_at=excluded.updated_at',
        'WHERE entitlements.stripe_event_created_at IS NULL OR entitlements.stripe_event_created_at <= excluded.stripe_event_created_at',
      ].join(' '),
    )
    .bind(
      userId,
      grantsPro ? 'pro' : 'free',
      grantsPro ? 1 : 0,
      customerId,
      subscriptionId,
      state.status,
      state.cadence,
      state.cancelAtPeriodEnd,
      state.currentPeriodEnd,
      eventCreatedAt,
    )
    .run()
}
/**
 * Revoke a one-time Full Program purchase after a full refund or a lost dispute.
 * Users who still hold a live Pro subscription fall back to Pro; everyone else to free.
 * Returns true when an entitlement row was downgraded.
 */
type RunnableDb = {
  prepare: (sql: string) => {bind: (...values: unknown[]) => {run: () => Promise<{meta?: {changes?: number}} | unknown>}}
}

export async function revokeFullProgramAccess(args: {db: RunnableDb; userId: string}): Promise<boolean> {
  const {db, userId} = args
  const result = await db
    .prepare(
      [
        'UPDATE entitlements SET',
        "access_type = CASE WHEN subscription_status IN ('active', 'trialing') THEN 'pro' ELSE 'free' END,",
        "has_full_access = CASE WHEN subscription_status IN ('active', 'trialing') THEN 1 ELSE 0 END,",
        'updated_at = CURRENT_TIMESTAMP',
        "WHERE user_id = ?1 AND access_type IN ('full', 'full_program')",
      ].join(' '),
    )
    .bind(userId)
    .run()
  return Number((result as {meta?: {changes?: number}} | null)?.meta?.changes ?? 0) > 0
}

type UpsertDb = {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => {
      first: <T = Record<string, unknown>>() => Promise<T | null>
      run: () => Promise<unknown>
    }
  }
}

/**
 * Persist a paid entitlement confirmed by Stripe (checkout webhook, checkout-status
 * verification, or billing sync). Shared so every path follows the same rules:
 * - never persists "free" (verification of an incomplete session must not downgrade anyone);
 * - never downgrades a Full Program owner to Pro;
 * - never orphans an existing Stripe subscription or customer id.
 */
export async function upsertPurchasedEntitlement(args: {
  db: UpsertDb
  userId: string
  customerId: string | null
  email?: string | null
  subscriptionId?: string | null
  accessType: 'free' | 'pro' | 'full_program'
  hasFullAccess: boolean
}): Promise<void> {
  const {db, userId, customerId, email, subscriptionId, accessType, hasFullAccess} = args
  if (!hasFullAccess) return
  if (accessType !== 'pro' && accessType !== 'full_program') return

  // Ensure a user row exists for FK(user_id) even if email uniqueness collides.
  const effectiveUserId = await (async () => {
    const byId = await db.prepare('SELECT id FROM users WHERE id = ?1').bind(userId).first<{id: string}>()
    if (byId?.id) return userId
    if (email) {
      const byEmail = await db.prepare('SELECT id FROM users WHERE email = ?1').bind(email).first<{id: string}>()
      if (byEmail?.id) return byEmail.id
    }
    await db.prepare('INSERT INTO users (id, email) VALUES (?1, ?2)').bind(userId, email ?? `unknown+${userId}@example.invalid`).run()
    return userId
  })()

  await db
    .prepare(
      [
        'INSERT INTO entitlements (user_id, access_type, has_full_access, stripe_customer_id, stripe_subscription_id, updated_at)',
        'VALUES (?1, ?2, 1, ?3, ?4, CURRENT_TIMESTAMP)',
        'ON CONFLICT(user_id) DO UPDATE SET',
        "access_type=CASE WHEN entitlements.access_type IN ('full', 'full_program') THEN entitlements.access_type ELSE excluded.access_type END,",
        "has_full_access=CASE WHEN entitlements.access_type IN ('full', 'full_program') THEN entitlements.has_full_access ELSE excluded.has_full_access END,",
        'stripe_customer_id=COALESCE(excluded.stripe_customer_id, entitlements.stripe_customer_id),',
        'stripe_subscription_id=COALESCE(excluded.stripe_subscription_id, entitlements.stripe_subscription_id),',
        'updated_at=excluded.updated_at',
      ].join(' '),
    )
    .bind(effectiveUserId, accessType === 'full_program' ? 'full' : 'pro', customerId, subscriptionId ?? null)
    .run()
}
