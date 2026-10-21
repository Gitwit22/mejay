import 'dotenv/config'
import express from 'express'
import {Database} from './db/client'
import {apiCors} from './middleware/cors'
import {adaptRoute, routes} from './routes'
import {createDownloadsBucket} from './services/r2'
import {loadConfig} from './config/env'
import {apiOriginGuard} from './middleware/origin-guard'
import {CommerceService} from './marketplace/commerce-service'
import {MarketplaceAdminService} from './marketplace/admin-service'
import {processEmailJobs, retryFailedConfirmations} from './marketplace/email-jobs'

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

// Periodically pay out marketplace orders whose provider transfer is pending or failed.
// Set MARKETPLACE_TRANSFER_RETRY_MINUTES=0 to disable (e.g. when a separate worker runs it).
const transferRetryMinutes = Number(config.MARKETPLACE_TRANSFER_RETRY_MINUTES ?? 60)
if (config.STRIPE_SECRET_KEY && Number.isFinite(transferRetryMinutes) && transferRetryMinutes > 0) {
  const commerce = new CommerceService(database as never, config.STRIPE_SECRET_KEY, Number(config.MARKETPLACE_PLATFORM_FEE_BPS))
  let running = false
  setInterval(() => {
    if (running) return
    running = true
    commerce.retryPendingTransfers()
      .then((result) => {
        if (result.attempted > 0) console.log('[marketplace] transfer retry', result)
      })
      .catch((error) => console.error('[marketplace] transfer retry failed', error))
      .finally(() => {
        running = false
      })
  }, transferRetryMinutes * 60_000).unref()
}
// Publish SCHEDULED marketplace releases whose release time has passed, then deliver what that
// unlocked: release-day emails for pre-orders, retries of failed emails, and pre-order refunds.
// Release times therefore take effect within one interval, not to the second.
// Set MARKETPLACE_PUBLISH_DUE_MINUTES=0 to disable (e.g. when a separate worker runs it).
const publishDueMinutes = Number(config.MARKETPLACE_PUBLISH_DUE_MINUTES ?? 5)
if (Number.isFinite(publishDueMinutes) && publishDueMinutes > 0) {
  const admin = new MarketplaceAdminService(database as never)
  const refunds = config.STRIPE_SECRET_KEY ? new CommerceService(database as never, config.STRIPE_SECRET_KEY, Number(config.MARKETPLACE_PLATFORM_FEE_BPS)) : null
  let publishing = false
  const step = async <T>(label: string, run: () => Promise<T>, report: (result: T) => boolean) => {
    try {
      const result = await run()
      if (report(result)) console.log(`[marketplace] ${label}`, result)
    } catch (error) {
      // Each step is independent: a failing email provider never blocks publishing or refunds.
      console.error(`[marketplace] ${label} failed`, error)
    }
  }
  setInterval(() => {
    if (publishing) return
    publishing = true
    void (async () => {
      await step('scheduled publish', () => admin.publishDueReleases(), (result) => result.published.length > 0 || result.notReady.length > 0)
      await step('email jobs', () => processEmailJobs(database as never, env), (result) => result.sent + result.retried + result.skipped > 0)
      await step('confirmation retries', () => retryFailedConfirmations(database as never, env), (sent) => sent > 0)
      if (refunds) await step('pre-order refunds', () => refunds.processPreorderRefunds(), (result) => result.requested + result.failed > 0)
    })().finally(() => {
      publishing = false
    })
  }, publishDueMinutes * 60_000).unref()
}
