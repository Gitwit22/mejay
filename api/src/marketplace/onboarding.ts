export type AccountIntent = 'consumer' | 'provider'

export type ProviderStatus =
  | 'pending_profile_completion'
  | 'pending_review'
  | 'approved'
  | 'needs_changes'
  | 'rejected'
  | 'suspended'

type Queryable = {
  prepare: (sql: string) => {
    bind: (...values: unknown[]) => {
      first: <T = Record<string, unknown>>() => Promise<T | null>
      run: () => Promise<unknown>
    }
  }
}

export function parseAccountIntent(raw: unknown): AccountIntent {
  return raw === 'provider' ? 'provider' : 'consumer'
}

export async function bootstrapProviderAccount(args: {
  db: Queryable
  userId: string
  createdAt: string
}): Promise<void> {
  const {db, userId, createdAt} = args

  const existing = await db
    .prepare('SELECT id FROM provider_profiles WHERE owner_user_id = ?1 LIMIT 1')
    .bind(userId)
    .first<{id: string}>()

  const providerId = existing?.id ?? crypto.randomUUID()

  if (!existing?.id) {
    await db
      .prepare(
        [
          'INSERT INTO provider_profiles (id, owner_user_id, status, created_at, updated_at)',
          'VALUES (?1, ?2, ?3, ?4, ?5)',
        ].join(' '),
      )
      .bind(providerId, userId, 'pending_profile_completion', createdAt, createdAt)
      .run()
  } else {
    await db
      .prepare('UPDATE provider_profiles SET updated_at = ?1 WHERE id = ?2')
      .bind(createdAt, providerId)
      .run()
  }

  await db
    .prepare(
      [
        'INSERT INTO provider_members (provider_profile_id, user_id, role, created_at)',
        'VALUES (?1, ?2, ?3, ?4)',
        'ON CONFLICT(provider_profile_id, user_id) DO UPDATE SET',
        'role=excluded.role',
      ].join(' '),
    )
    .bind(providerId, userId, 'owner', createdAt)
    .run()
}
