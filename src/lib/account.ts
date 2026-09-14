import {apiFetch} from './api'

type ErrorPayload = {
  error?: string
  message?: string
}

export class AccountRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

async function requireOk(response: Response): Promise<void> {
  const payload = await response.json().catch(() => null) as ({ok?: boolean} & ErrorPayload) | null
  if (response.ok && payload?.ok === true) return
  throw new AccountRequestError(
    response.status,
    payload?.error || 'request_failed',
    payload?.message || 'The account request could not be completed.',
  )
}

export async function logoutAccount(): Promise<void> {
  const response = await apiFetch('/api/auth/logout', {method: 'POST'})
  await requireOk(response)
}

export async function deleteAccount(input: {email: string; forfeitFullProgram: boolean}): Promise<void> {
  const response = await apiFetch('/api/account', {
    method: 'DELETE',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(input),
  })
  await requireOk(response)
}

export function clearMejayBrowserStorage(): void {
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const keys: string[] = []
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index)
        if (key?.startsWith('mejay:')) keys.push(key)
      }
      keys.forEach((key) => storage.removeItem(key))
    } catch {
      // Storage can be unavailable in private or restricted browser contexts.
    }
  }
}