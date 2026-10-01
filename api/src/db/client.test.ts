import type {Pool} from 'pg'
import {describe, expect, it, vi} from 'vitest'
import {Database} from './client'

function databaseWithQuery(query: ReturnType<typeof vi.fn>) {
  const client = {query, release: vi.fn()}
  const pool = {connect: vi.fn().mockResolvedValue(client)} as unknown as Pool
  return {database: new Database('postgresql://localhost/mejay', pool), client}
}

describe('Database.transaction', () => {
  it('commits callback writes and returns its result', async () => {
    const query = vi.fn().mockResolvedValue({rowCount: 1, rows: []})
    const {database, client} = databaseWithQuery(query)

    const result = await database.transaction(async (transaction) => {
      await transaction.prepare('DELETE FROM sessions WHERE user_id = ?1').bind('user-1').run()
      return 'done'
    })

    expect(result).toBe('done')
    expect(query.mock.calls.map(([sql]) => typeof sql === 'string' ? sql : sql.text)).toEqual([
      'BEGIN',
      'DELETE FROM sessions WHERE user_id = $1',
      'COMMIT',
    ])
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('rolls back and releases the client when the callback fails', async () => {
    const query = vi.fn().mockResolvedValue({rowCount: 0, rows: []})
    const {database, client} = databaseWithQuery(query)

    await expect(database.transaction(async () => {
      throw new Error('write failed')
    })).rejects.toThrow('write failed')

    expect(query).toHaveBeenNthCalledWith(1, 'BEGIN')
    expect(query).toHaveBeenNthCalledWith(2, 'ROLLBACK')
    expect(client.release).toHaveBeenCalledOnce()
  })
})