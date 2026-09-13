import 'dotenv/config'
import express from 'express'
import {Database} from './db/client'
import {apiCors} from './middleware/cors'
import {adaptRoute, routes} from './routes'
import {createDownloadsBucket} from './services/r2'
import {loadConfig} from './config/env'
import {apiOriginGuard} from './middleware/origin-guard'

const config = loadConfig()
const port = Number(config.PORT)
const database = new Database(config.DATABASE_URL)
const env = {...config, DB: database, DOWNLOADS: createDownloadsBucket(config)}
const app = express()

app.set('trust proxy', 1)
app.use(apiCors(config.FRONTEND_URL))
app.use(apiOriginGuard(config.FRONTEND_URL, ['/api/stripe-webhook']))
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