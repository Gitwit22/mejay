import type {PoolClient} from 'pg'
import {describe, expect, it, vi} from 'vitest'
import {migrations, runMigrations} from '.'
import type {Migration} from './types'

function clientWithApplied(rows: Array<{version: number; checksum: string}> = []) {
  const query = vi.fn(async (sql: string) => {
    if (sql === 'SELECT version, checksum FROM schema_migrations') return {rows}
    return {rows: [], rowCount: 1}
  })
  return {client: {query} as unknown as PoolClient, query}
}

describe('runMigrations', () => {
  it('registers marketplace migrations in forward-only order', () => {
    expect(migrations.map(({version, name}) => ({version, name}))).toEqual([
      {version: 1, name: 'existing_schema'},
      {version: 2, name: 'marketplace_foundation'},
      {version: 3, name: 'account_deletion'},
      {version: 4, name: 'provider_release_drafts'},
      {version: 5, name: 'marketplace_admin_publishing'},
      {version: 6, name: 'marketplace_commerce'},
      {version: 7, name: 'marketplace_discovery'},
      {version: 8, name: 'marketplace_sale_policy'},
      {version: 9, name: 'marketplace_reporting'},
      {version: 10, name: 'industry_reporting'},
    ])
  })

  it('adds nullable ISO territory data for provider reporting', () => {
    const migration = migrations.find(({version}) => version === 9)
    expect(migration?.sql).toContain('ADD COLUMN buyer_country_code TEXT')
    expect(migration?.sql).toContain("buyer_country_code ~ '^[A-Z]{2}$'")
    expect(migration?.sql).toContain('provider_profile_id, paid_at DESC, buyer_country_code')
  })

  it('adds append-only reporting events and daily export batches', () => {
    const migration = migrations.find(({version}) => version === 10)
    expect(migration?.sql).toContain('CREATE TABLE marketplace_reporting_events')
    expect(migration?.sql).toContain('ledger_transaction_id TEXT NOT NULL REFERENCES marketplace_ledger_transactions')
    expect(migration?.sql).toContain("event_type IN ('sale', 'refund')")
    expect(migration?.sql).toContain('UNIQUE (ledger_transaction_id, track_id)')
    expect(migration?.sql).toContain('marketplace_reporting_events_append_only')
    expect(migration?.sql).toContain('CREATE TABLE marketplace_reporting_event_states')
    expect(migration?.sql).toContain('CREATE TABLE marketplace_reporting_batches')
    expect(migration?.sql).toContain("status IN ('exported', 'submitted', 'accepted', 'rejected')")
    expect(migration?.sql).toContain("ledger.transaction_type IN ('sale', 'refund')")
    expect(migration?.sql).toContain('LAG(target_minor, 1, 0)')
    expect(migration?.sql).toContain("SUBSTRING(ledger.idempotency_key FROM '([0-9]+)$')")
    expect(migration?.sql).toContain('cumulative_refunded_minor::numeric * sale_price_minor / gross_amount_minor')
    expect(migration?.sql).toContain("'report-' || MD5(ledger_transaction_id || ':' || track_id)")
  })

  it('applies migrations in version order inside transactions', async () => {
    const {client, query} = clientWithApplied()
    const pending: Migration[] = [
      {version: 2, name: 'second', sql: 'SELECT 2'},
      {version: 1, name: 'first', sql: 'SELECT 1'},
    ]

    await expect(runMigrations(client, pending)).resolves.toBe(2)

    const statements = query.mock.calls.map(([sql]) => sql)
    expect(statements.indexOf('SELECT 1')).toBeLessThan(statements.indexOf('SELECT 2'))
    expect(statements.filter((sql) => sql === 'BEGIN')).toHaveLength(2)
    expect(statements.filter((sql) => sql === 'COMMIT')).toHaveLength(2)
  })

  it('rolls back a failed migration and releases the advisory lock', async () => {
    const {client, query} = clientWithApplied()
    query.mockImplementation(async (sql: string) => {
      if (sql === 'SELECT version, checksum FROM schema_migrations') return {rows: []}
      if (sql === 'BROKEN') throw new Error('migration failed')
      return {rows: [], rowCount: 1}
    })

    await expect(runMigrations(client, [{version: 1, name: 'broken', sql: 'BROKEN'}])).rejects.toThrow('migration failed')

    expect(query).toHaveBeenCalledWith('ROLLBACK')
    expect(query).toHaveBeenLastCalledWith('SELECT pg_advisory_unlock($1)', [764_329_101])
  })

  it('rejects checksum drift without rerunning the migration', async () => {
    const {client, query} = clientWithApplied([{version: 1, checksum: 'different'}])

    await expect(runMigrations(client, [{version: 1, name: 'first', sql: 'SELECT 1'}])).rejects.toThrow('checksum mismatch')

    expect(query).not.toHaveBeenCalledWith('SELECT 1')
  })
})
