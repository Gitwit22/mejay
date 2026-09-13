import {Pool, types, type PoolClient} from 'pg'

types.setTypeParser(1114, (value) => new Date(`${value}Z`).toISOString())
types.setTypeParser(1184, (value) => new Date(value).toISOString())

export type BoundStatement = ReturnType<Database['prepare']>

function toPostgresSql(sql: string): string {
  return sql
    .replace(/\?(\d+)/g, (_match, index) => `$${index}`)
    .replace(/\(strftime\('\%Y-\%m-\%dT\%H:\%M:\%fZ','now'\)\)/gi, 'CURRENT_TIMESTAMP')
}

type Queryable = Pick<PoolClient, 'query'>

class Statement {
  private values: unknown[] = []

  constructor(
    private readonly pool: Queryable,
    private readonly sql: string,
  ) {}

  bind(...values: unknown[]): this {
    this.values = values
    return this
  }

  async first<T = Record<string, unknown>>(): Promise<T | null> {
    const result = await this.pool.query<T & Record<string, unknown>>(toPostgresSql(this.sql), this.values)
    return result.rows[0] ?? null
  }

  async all<T = Record<string, unknown>>(): Promise<{results: T[]}> {
    const result = await this.pool.query<T & Record<string, unknown>>(toPostgresSql(this.sql), this.values)
    return {results: result.rows}
  }

  async run(): Promise<{success: boolean; meta: {changes: number}}> {
    const result = await this.pool.query(toPostgresSql(this.sql), this.values)
    return {success: true, meta: {changes: result.rowCount ?? 0}}
  }

  query() {
    return {text: toPostgresSql(this.sql), values: this.values}
  }
}

export class Database {
  readonly pool: Pool

  constructor(connectionString: string, pool?: Pool) {
    this.pool = pool ?? new Pool({connectionString, ssl: connectionString.includes('localhost') ? false : {rejectUnauthorized: false}})
  }

  prepare(sql: string): Statement {
    return new Statement(this.pool, sql)
  }

  async batch(statements: Statement[]): Promise<Array<{success: boolean; meta: {changes: number}}>> {
    const client = await this.pool.connect()
    try {
      await client.query('BEGIN')
      const results = []
      for (const statement of statements) {
        const result = await client.query(statement.query())
        results.push({success: true, meta: {changes: result.rowCount ?? 0}})
      }
      await client.query('COMMIT')
      return results
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async transaction<T>(callback: (database: Pick<Database, 'prepare'>) => Promise<T>): Promise<T> {
    const client = await this.pool.connect()
    const database = {prepare: (sql: string) => new Statement(client, sql)}
    try {
      await client.query('BEGIN')
      const result = await callback(database)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}