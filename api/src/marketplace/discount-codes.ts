import {z} from 'zod'

import {MarketplaceError} from './service'

/**
 * Store discount codes (percent off), modeled on Beat Wing's promo codes.
 *
 * Staff create codes in the marketplace admin. A code works on every release, or only on one
 * release (its whole-release product and each of its songs). The discount is applied on the
 * server when the Checkout Session is created: the buyer is charged the discounted price, and
 * that discounted price is the sale's gross amount. The platform fee, the artist's proceeds and
 * every split are then worked out from what the buyer actually paid, exactly as for any other
 * sale, so the discount is shared in proportion to everyone's normal cut.
 */

type Statement = {
  bind: (...values: unknown[]) => Statement
  first: <T = Record<string, unknown>>() => Promise<T | null>
  all: <T = Record<string, unknown>>() => Promise<{results: T[]}>
  run: () => Promise<unknown>
}

type Database = {prepare: (sql: string) => Statement}

/** Codes are stored upper-case: letters, digits, "-" and "_", 3 to 32 characters. */
export const DISCOUNT_CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/
export const MAX_PERCENT_OFF = 90
/**
 * A discounted sale is never charged less than this ($1.00, the database's price floor), so a
 * sale still covers card processing for the artist.
 */
export const MINIMUM_DISCOUNTED_PRICE_MINOR = 100

export type AppliedDiscount = {
  id: string
  code: string
  percentOff: number
  listAmountMinor: number
  discountMinor: number
  /** What the buyer pays. */
  amountMinor: number
}

type DiscountCodeRow = {
  id: string
  code: string
  percent_off: number
  release_id: string | null
  active: boolean
  max_redemptions: number | null
  redemption_count: number
}

export function normalizeDiscountCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return DISCOUNT_CODE_PATTERN.test(code) ? code : null
}

/** Whole cents off, rounded to the nearest cent. */
export function applyPercentOff(listAmountMinor: number, percentOff: number): {discountMinor: number; amountMinor: number} {
  if (!Number.isSafeInteger(listAmountMinor) || listAmountMinor <= 0) throw new Error('listAmountMinor must be a positive integer')
  if (!Number.isInteger(percentOff) || percentOff < 1 || percentOff > MAX_PERCENT_OFF) throw new Error(`percentOff must be between 1 and ${MAX_PERCENT_OFF}`)
  const discountMinor = Math.round((listAmountMinor * percentOff) / 100)
  return {discountMinor, amountMinor: listAmountMinor - discountMinor}
}

// One message for unknown, switched-off and wrong-release codes, so the check can't be used to
// find out which codes exist.
const invalidCode = () => new MarketplaceError(422, 'discount_code_invalid', "That code isn't valid for this music.")

/**
 * Validates `rawCode` for a purchase from `releaseId` at `listAmountMinor` and returns the price
 * to charge. Throws a 422 MarketplaceError the buyer can read when the code can't be used.
 */
export async function resolveDiscount(
  database: Database,
  rawCode: unknown,
  purchase: {releaseId: string; listAmountMinor: number},
): Promise<AppliedDiscount> {
  const code = normalizeDiscountCode(rawCode)
  if (!code) throw invalidCode()
  const row = await database.prepare(
    `SELECT id, code, percent_off, release_id, active, max_redemptions, redemption_count
     FROM marketplace_discount_codes WHERE code = ?1`,
  ).bind(code).first<DiscountCodeRow>()
  if (!row || !row.active || (row.release_id && row.release_id !== purchase.releaseId)) throw invalidCode()
  // Checked when checkout starts; two buyers paying at the same moment can both get the last use.
  if (row.max_redemptions !== null && Number(row.redemption_count) >= Number(row.max_redemptions)) {
    throw new MarketplaceError(422, 'discount_code_used_up', 'That code has already been used the maximum number of times.')
  }
  const {discountMinor, amountMinor} = applyPercentOff(purchase.listAmountMinor, Number(row.percent_off))
  if (amountMinor < MINIMUM_DISCOUNTED_PRICE_MINOR) {
    throw new MarketplaceError(422, 'discount_code_below_minimum', "That code can't be used on this item.")
  }
  return {id: row.id, code: row.code, percentOff: Number(row.percent_off), listAmountMinor: purchase.listAmountMinor, discountMinor, amountMinor}
}

/**
 * Price check for the store page's "Apply" button: the product's current price with the code
 * applied. Checkout validates the code again, so this is only ever a preview.
 */
export async function quoteDiscount(database: Database, productId: string, rawCode: unknown): Promise<AppliedDiscount & {currency: string}> {
  const product = await database.prepare(
    `SELECT release.id AS release_id, price.amount_minor, price.currency
     FROM products product
     LEFT JOIN tracks sold_track ON sold_track.id = product.track_id
     JOIN releases release ON release.id = COALESCE(product.release_id, sold_track.release_id)
       AND (release.status = 'LIVE' OR (release.status = 'SCHEDULED' AND release.preorders_enabled AND release.scheduled_release_at IS NOT NULL))
     JOIN LATERAL (
       SELECT current_price.amount_minor, current_price.currency
       FROM prices current_price WHERE current_price.product_id = product.id AND current_price.active = TRUE
         AND current_price.effective_from <= CURRENT_TIMESTAMP
         AND (current_price.effective_until IS NULL OR current_price.effective_until > CURRENT_TIMESTAMP)
       ORDER BY current_price.effective_from DESC LIMIT 1
     ) price ON TRUE
     WHERE product.id = ?1 AND product.active = TRUE LIMIT 1`,
  ).bind(productId).first<{release_id: string; amount_minor: number; currency: string}>()
  if (!product) throw new MarketplaceError(404, 'product_not_found', 'This product is not available')
  const applied = await resolveDiscount(database, rawCode, {releaseId: product.release_id, listAmountMinor: Number(product.amount_minor)})
  return {...applied, currency: product.currency}
}

export const createDiscountCodeSchema = z.object({
  code: z.string().trim().transform((value) => value.toUpperCase())
    .refine((value) => DISCOUNT_CODE_PATTERN.test(value), 'Use 3 to 32 letters, numbers, dashes or underscores.'),
  percentOff: z.number().int().min(1).max(MAX_PERCENT_OFF),
  releaseId: z.string().trim().min(1).max(80).nullable().optional(),
  maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
}).strict()

export const updateDiscountCodeSchema = z.object({
  active: z.boolean().optional(),
  maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
}).strict().refine((value) => value.active !== undefined || value.maxRedemptions !== undefined, 'Nothing to change')

export type DiscountCodeView = {
  id: string
  code: string
  percent_off: number
  release_id: string | null
  release_title: string | null
  active: boolean
  max_redemptions: number | null
  redemption_count: number
  created_at: string
}

const VIEW_SQL = `SELECT d.id, d.code, d.percent_off, d.release_id, r.title AS release_title, d.active,
    d.max_redemptions, d.redemption_count, d.created_at
  FROM marketplace_discount_codes d LEFT JOIN releases r ON r.id = d.release_id`

/** Staff management of discount codes. Any staff member can view; only admins can change them. */
export class DiscountCodeAdminService {
  constructor(private readonly database: Database) {}

  private async role(userId: string): Promise<'reviewer' | 'admin'> {
    const staff = await this.database.prepare('SELECT role FROM marketplace_staff WHERE user_id = ?1').bind(userId).first<{role: 'reviewer' | 'admin'}>()
    if (!staff) throw new MarketplaceError(403, 'marketplace_staff_required', 'Marketplace staff access is required')
    return staff.role
  }

  private async requireAdmin(userId: string): Promise<void> {
    if (await this.role(userId) !== 'admin') throw new MarketplaceError(403, 'marketplace_admin_required', 'Marketplace admin access is required')
  }

  async list(userId: string): Promise<{role: 'reviewer' | 'admin'; codes: DiscountCodeView[]}> {
    const role = await this.role(userId)
    const {results} = await this.database.prepare(`${VIEW_SQL} ORDER BY d.created_at DESC LIMIT 500`).bind().all<DiscountCodeView>()
    return {role, codes: results}
  }

  async create(userId: string, input: z.infer<typeof createDiscountCodeSchema>): Promise<DiscountCodeView> {
    await this.requireAdmin(userId)
    const releaseId = input.releaseId || null
    if (releaseId) {
      const release = await this.database.prepare('SELECT id FROM releases WHERE id = ?1').bind(releaseId).first()
      if (!release) throw new MarketplaceError(404, 'release_not_found', 'That release was not found')
    }
    const existing = await this.database.prepare('SELECT id FROM marketplace_discount_codes WHERE code = ?1').bind(input.code).first()
    if (existing) throw new MarketplaceError(409, 'discount_code_taken', 'A code with that name already exists')
    const id = crypto.randomUUID()
    try {
      await this.database.prepare(
        `INSERT INTO marketplace_discount_codes (id, code, percent_off, release_id, max_redemptions, created_by_user_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
      ).bind(id, input.code, input.percentOff, releaseId, input.maxRedemptions ?? null, userId).run()
    } catch (error) {
      // Two admins creating the same code at once: the unique index decides.
      if ((error as {code?: string})?.code === '23505') throw new MarketplaceError(409, 'discount_code_taken', 'A code with that name already exists')
      throw error
    }
    return this.get(id)
  }

  /** Switch a code on or off, or change its use limit. Code and percent stay fixed once created. */
  async update(userId: string, id: string, input: z.infer<typeof updateDiscountCodeSchema>): Promise<DiscountCodeView> {
    await this.requireAdmin(userId)
    const updated = await this.database.prepare(
      `UPDATE marketplace_discount_codes SET
         active = CASE WHEN ?2 THEN ?3 ELSE active END,
         max_redemptions = CASE WHEN ?4 THEN ?5 ELSE max_redemptions END,
         updated_at = CURRENT_TIMESTAMP
       WHERE id = ?1 RETURNING id`,
    ).bind(id, input.active !== undefined, input.active ?? false, input.maxRedemptions !== undefined, input.maxRedemptions ?? null).first()
    if (!updated) throw new MarketplaceError(404, 'not_found', 'Discount code was not found')
    return this.get(id)
  }

  private async get(id: string): Promise<DiscountCodeView> {
    const row = await this.database.prepare(`${VIEW_SQL} WHERE d.id = ?1`).bind(id).first<DiscountCodeView>()
    if (!row) throw new MarketplaceError(404, 'not_found', 'Discount code was not found')
    return row
  }
}
