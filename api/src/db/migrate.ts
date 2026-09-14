import 'dotenv/config'
import {Database} from './client'
import {runMigrations} from './migrations'

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is required')

  const database = new Database(connectionString)
  try {
    const client = await database.pool.connect()
    try {
      const appliedCount = await runMigrations(client)
      console.log(`Neon schema is up to date (${appliedCount} migration${appliedCount === 1 ? '' : 's'} applied)`)
    } finally {
      client.release()
    }
  } finally {
    await database.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})