import {bootstrapProviderAccount} from './onboarding'

type BoundStatement = {
  first: <T = Record<string, unknown>>() => Promise<T | null>
  run: () => Promise<unknown>
}

type TransactionDatabase = {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => BoundStatement
  }
}

type Database = TransactionDatabase & {
  transaction?: <T>(callback: (database: TransactionDatabase) => Promise<T>) => Promise<T>
}

export type MarketplaceRole = 'reviewer' | 'admin'

export type ClaimedMarketplaceAccess = {
  role: MarketplaceRole
  protectedOwner: boolean
  fullSiteAccess: boolean
  artistPortalAccess: boolean
}

type StaffInvite = {
  role: MarketplaceRole
  protected_owner: boolean
  full_site_access: boolean
  artist_portal_access: boolean
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

async function claimWithDatabase(
  database: TransactionDatabase,
  userId: string,
  email: string,
): Promise<ClaimedMarketplaceAccess | null> {
  const invite = await database.prepare(
    `SELECT role, protected_owner, full_site_access, artist_portal_access
     FROM marketplace_staff_invites
    WHERE email = ?1 AND claimed_at IS NULL AND revoked_at IS NULL
     FOR UPDATE`,
  ).bind(normalizeEmail(email)).first<StaffInvite>()
  if (!invite) return null

  const now = new Date().toISOString()
  await database.prepare(
    `INSERT INTO marketplace_staff (user_id, role, protected_owner, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?4)
     ON CONFLICT (user_id) DO UPDATE SET
       role = EXCLUDED.role,
       protected_owner = marketplace_staff.protected_owner OR EXCLUDED.protected_owner,
       updated_at = EXCLUDED.updated_at`,
  ).bind(userId, invite.role, invite.protected_owner, now).run()

  if (invite.full_site_access || invite.artist_portal_access) {
    await database.prepare(
      `INSERT INTO platform_access_grants
        (user_id, full_site_access, artist_portal_access, source, created_at, updated_at)
       VALUES (?1, ?2, ?3, 'bootstrap', ?4, ?4)
       ON CONFLICT (user_id) DO UPDATE SET
         full_site_access = platform_access_grants.full_site_access OR EXCLUDED.full_site_access,
         artist_portal_access = platform_access_grants.artist_portal_access OR EXCLUDED.artist_portal_access,
         updated_at = EXCLUDED.updated_at`,
    ).bind(userId, invite.full_site_access, invite.artist_portal_access, now).run()
  }

  if (invite.protected_owner && invite.artist_portal_access) {
    await bootstrapProviderAccount({db: database, userId, createdAt: now})
    await database.prepare(
      `UPDATE users SET account_intent = 'provider', updated_at = ?1 WHERE id = ?2`,
    ).bind(now, userId).run()
  }

  await database.prepare(
    `UPDATE marketplace_staff_invites SET claimed_by_user_id = ?1, claimed_at = ?2, updated_at = ?2
     WHERE email = ?3 AND revoked_at IS NULL`,
  ).bind(userId, now, normalizeEmail(email)).run()

  return {
    role: invite.role,
    protectedOwner: invite.protected_owner,
    fullSiteAccess: invite.full_site_access,
    artistPortalAccess: invite.artist_portal_access,
  }
}

export async function claimMarketplaceAccess(
  database: Database,
  userId: string,
  email: string,
): Promise<ClaimedMarketplaceAccess | null> {
  if (database.transaction) {
    return database.transaction((transaction) => claimWithDatabase(transaction, userId, email))
  }
  return claimWithDatabase(database, userId, email)
}

export async function marketplaceRoleForUser(
  database: TransactionDatabase,
  userId: string,
): Promise<MarketplaceRole | null> {
  const staff = await database.prepare(
    'SELECT role FROM marketplace_staff WHERE user_id = ?1',
  ).bind(userId).first<{role: MarketplaceRole}>()
  return staff?.role ?? null
}