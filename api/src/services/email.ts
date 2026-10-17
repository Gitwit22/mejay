/** Resend settings, read the same way as the existing login-code and Full Program emails. */
export type ResendEnv = {
  RESEND_API_KEY?: string
  RESEND_FROM?: string
  EMAIL_FROM?: string
  FROM_EMAIL?: string
  MAIL_FROM?: string
}

export type ResendResult =
  | {status: 'sent'}
  | {status: 'skipped'; reason: 'not_configured'}
  | {status: 'failed'; reason: string}

export function resendSender(env: ResendEnv): string {
  return (env.RESEND_FROM ?? '').trim() || (env.EMAIL_FROM ?? '').trim() || (env.FROM_EMAIL ?? '').trim() || (env.MAIL_FROM ?? '').trim()
}

/**
 * Sends one email through Resend. Never throws: callers decide what a failure means. The returned
 * reason is safe to log (HTTP status or error class only, never the key, recipient, or body).
 */
export async function sendResendEmail(args: {
  env: ResendEnv
  to: string
  subject: string
  text: string
  html: string
  replyTo?: string
  /** Resend de-duplicates sends that reuse this key (24 hours), covering retries after a crash. */
  idempotencyKey?: string
}): Promise<ResendResult> {
  const apiKey = (args.env.RESEND_API_KEY ?? '').trim()
  const from = resendSender(args.env)
  if (!apiKey || !from) return {status: 'skipped', reason: 'not_configured'}
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        ...(args.idempotencyKey ? {'idempotency-key': args.idempotencyKey} : {}),
      },
      body: JSON.stringify({
        from,
        to: args.to,
        subject: args.subject,
        text: args.text,
        html: args.html,
        ...(args.replyTo ? {reply_to: args.replyTo} : {}),
      }),
    })
    if (!response.ok) return {status: 'failed', reason: `http_${response.status}`}
    return {status: 'sent'}
  } catch (error) {
    return {status: 'failed', reason: error instanceof Error ? error.name : 'network_error'}
  }
}
