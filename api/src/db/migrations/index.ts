import {createHash} from 'node:crypto'
import type {PoolClient} from 'pg'
import {existingSchemaMigration} from './0001-existing-schema'
import {marketplaceFoundationMigration} from './0002-marketplace-foundation'
import {accountDeletionMigration} from './0003-account-deletion'
import {providerReleaseDraftsMigration} from './0004-provider-release-drafts'
import {marketplaceAdminPublishingMigration} from './0005-marketplace-admin-publishing'
import {marketplaceCommerceMigration} from './0006-marketplace-commerce'
import {marketplaceDiscoveryMigration} from './0007-marketplace-discovery'
import {marketplaceSalePolicyMigration} from './0008-marketplace-sale-policy'
import {marketplaceReportingMigration} from './0009-marketplace-reporting'
import {industryReportingMigration} from './0010-industry-reporting'
import {productionHardeningMigration} from './0011-production-hardening'
import {isrcRegistryMigration} from './0012-isrc-registry'
import type {Migration} from './types'

export const migrations: readonly Migration[] = [
  existingSchemaMigration,
  marketplaceFoundationMigration,
  accountDeletionMigration,
  providerReleaseDraftsMigration,
  marketplaceAdminPublishingMigration,
  marketplaceCommerceMigration,
  marketplaceDiscoveryMigration,
  marketplaceSalePolicyMigration,
  marketplaceReportingMigration,
  industryReportingMigration,
  productionHardeningMigration,
  isrcRegistryMigration,
]

const MIGRATION_LOCK_ID = 764_329_101

function checksum(migration: Migration): string {
  return createHash('sha256').update(`${migration.version}:${migration.name}:${migration.sql}`).digest('hex')
}

export async function runMigrations(client: PoolClient, pendingMigrations: readonly Migration[] = migrations): Promise<number> {
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID])
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `)

    const applied = await client.query<{version: number; checksum: string}>('SELECT version, checksum FROM schema_migrations')
    const appliedByVersion = new Map(applied.rows.map((row) => [row.version, row.checksum]))
    let appliedCount = 0

    for (const migration of [...pendingMigrations].sort((left, right) => left.version - right.version)) {
      const expectedChecksum = checksum(migration)
      const existingChecksum = appliedByVersion.get(migration.version)
      if (existingChecksum) {
        if (existingChecksum !== expectedChecksum) throw new Error(`Migration ${migration.version} checksum mismatch`)
        continue
      }

      await client.query('BEGIN')
      try {
        await client.query(migration.sql)
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [migration.version, migration.name, expectedChecksum],
        )
        await client.query('COMMIT')
        appliedCount += 1
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    }

    return appliedCount
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID])
  }
}
