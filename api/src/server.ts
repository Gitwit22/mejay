import 'dotenv/config'
import express from 'express'
import {Database} from './db/client'
import {apiCors} from './middleware/cors'
import {adaptRoute, routes} from './routes'
import {createDownloadsBucket} from './services/r2'

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is required')

const port = Number(process.env.PORT || 4000)
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:8080'
const database = new Database(databaseUrl)
const env = {...process.env, DB: database, DOWNLOADS: createDownloadsBucket(process.env)}
const app = express()

app.set('trust proxy', 1)
app.use(apiCors(frontendUrl))
app.use(express.raw({type: '*/*', limit: '2mb'}))

app.get('/api/health', async (_request, response, next) => {
  try {
    await database.pool.query('SELECT 1')
    response.json({ok: true, service: 'mejay-api'})
  } catch (error) {
    next(error)
  }
})

for (const route of routes) {
  ;(app as any)[route.method](route.path, adaptRoute(route.handler, env))
}

app.use((error: Error, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  console.error(error)
  response.status(500).json({ok: false, error: 'server_error'})
})

app.listen(port, () => {
  console.log(`mejay-api listening on port ${port}`)
})