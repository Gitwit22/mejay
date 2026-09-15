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
  it('registers provider release drafts after account deletion', () => {
    expect(migrations.map(({version, name}) => ({version, name}))).toEqual([
      {version: 1, name: 'existing_schema'},
      {version: 2, name: 'marketplace_foundation'},
      {version: 3, name: 'account_deletion'},
      {version: 4, name: 'provider_release_drafts'},
    ])
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
