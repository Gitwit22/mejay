import {beforeEach, describe, expect, it, vi} from 'vitest'
import {apiFetch} from './api'
import {AccountRequestError, clearMejayBrowserStorage, deleteAccount, logoutAccount} from './account'

vi.mock('./api', () => ({apiFetch: vi.fn()}))

const mockedApiFetch = vi.mocked(apiFetch)

describe('account client', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset()
    localStorage.clear()
    sessionStorage.clear()
  })

  it('requires a confirmed JSON response for logout', async () => {
    mockedApiFetch.mockResolvedValue(new Response('<html>not the API</html>', {status: 200}))
    await expect(logoutAccount()).rejects.toBeInstanceOf(AccountRequestError)
  })

  it('sends self-deletion confirmation to the account endpoint', async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({ok: true}), {
      status: 200,
      headers: {'content-type': 'application/json'},
    }))

    await deleteAccount({email: 'user@example.com', forfeitFullProgram: true})

    expect(mockedApiFetch).toHaveBeenCalledWith('/api/account', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({email: 'user@example.com', forfeitFullProgram: true}),
    }))
  })

  it('removes only MEJay browser keys during account deletion cleanup', () => {
    localStorage.setItem('mejay:accessPlan', 'pro')
    localStorage.setItem('other-app', 'keep')
    sessionStorage.setItem('mejay:lastTab', 'party')

    clearMejayBrowserStorage()

    expect(localStorage.getItem('mejay:accessPlan')).toBeNull()
    expect(sessionStorage.getItem('mejay:lastTab')).toBeNull()
    expect(localStorage.getItem('other-app')).toBe('keep')
  })
})