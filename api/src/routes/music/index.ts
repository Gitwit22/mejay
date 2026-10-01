import {DiscoveryService} from '../../marketplace/discovery-service'

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'},
  })
}

export async function getMusicDiscovery(context: {env: {DB?: ConstructorParameters<typeof DiscoveryService>[0]}}): Promise<Response> {
  if (!context.env.DB) return json({ok: false, error: 'db_not_configured'}, 500)
  try {
    return json({ok: true, data: await new DiscoveryService(context.env.DB).getOverview()})
  } catch (error) {
    console.error('[music] discovery request failed', error)
    return json({ok: false, error: 'server_error'}, 500)
  }
}
