type Statement = {
  bind: (...values: unknown[]) => Statement
  first: <T = Record<string, unknown>>() => Promise<T | null>
  run: () => Promise<unknown>
}

type Database = {prepare: (sql: string) => Statement}

export async function claimStripeWebhookEvent(
  database: Database,
  event: {id: string; type: string; createdAt: string | null},
): Promise<boolean> {
  const inserted = await database.prepare(
    `INSERT INTO stripe_webhook_events (stripe_event_id, event_type, stripe_created_at)
     VALUES (?1, ?2, ?3) ON CONFLICT (stripe_event_id) DO NOTHING
     RETURNING stripe_event_id`,
  ).bind(event.id, event.type, event.createdAt).first<{stripe_event_id: string}>()
  if (inserted) return true

  const retried = await database.prepare(
    `UPDATE stripe_webhook_events SET status = 'processing', attempts = attempts + 1,
      last_error = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE stripe_event_id = ?1 AND (
       status = 'failed' OR (status = 'processing' AND updated_at < CURRENT_TIMESTAMP - INTERVAL '10 minutes')
     )
     RETURNING stripe_event_id`,
  ).bind(event.id).first<{stripe_event_id: string}>()
  return Boolean(retried)
}

export async function finalizeStripeWebhookEvent(
  database: Database,
  eventId: string,
  error?: unknown,
): Promise<void> {
  const failed = error !== undefined
  const message = failed ? String(error instanceof Error ? error.message : error).slice(0, 1000) : null
  await database.prepare(
    `UPDATE stripe_webhook_events SET status = ?1, last_error = ?2,
      processed_at = CASE WHEN ?1 = 'processed' THEN CURRENT_TIMESTAMP ELSE processed_at END,
      updated_at = CURRENT_TIMESTAMP WHERE stripe_event_id = ?3`,
  ).bind(failed ? 'failed' : 'processed', message, eventId).run()
}