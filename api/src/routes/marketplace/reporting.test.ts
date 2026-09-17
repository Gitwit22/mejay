import {beforeEach, describe, expect, it, vi} from 'vitest'

import {getProviderReporting, getRecipientEarnings} from './reporting'

const getSessionUserId = vi.fn()
const getProviderReport = vi.fn()
const getRecipientReport = vi.fn()

vi.mock('../_auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('../_auth')>(),
  getSessionUserId: (...args: unknown[]) => getSessionUserId(...args),
}))
vi.mock('../../marketplace/reporting-service', () => ({
  MarketplaceReportingService: class {
    getProviderReport = getProviderReport
    getRecipientReport = getRecipientReport
  },
}))

describe('marketplace reporting routes', () => {
  beforeEach(() => {
    getSessionUserId.mockReset()
    getProviderReport.mockReset()
    getRecipientReport.mockReset()
  })

  it('requires an authenticated session', async () => {
    getSessionUserId.mockResolvedValue(null)
    const response = await getProviderReporting({request: new Request('https://mejay.app/api/marketplace/reporting'), env: {DB: {}}})
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toMatchObject({error: 'unauthorized'})
  })

  it('rejects invalid reporting ranges', async () => {
    getSessionUserId.mockResolvedValue('user-1')
    const response = await getProviderReporting({request: new Request('https://mejay.app/api/marketplace/reporting?range=weekly'), env: {DB: {}}})
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({error: 'invalid_range'})
    expect(getProviderReport).not.toHaveBeenCalled()
  })

  it('uses 30 days by default and permits recipient reports without provider access', async () => {
    getSessionUserId.mockResolvedValue('recipient-1')
    getProviderReport.mockResolvedValue({summary: {}})
    getRecipientReport.mockResolvedValue({summary: {owedMinor: 480}})

    const providerResponse = await getProviderReporting({request: new Request('https://mejay.app/api/marketplace/reporting'), env: {DB: {}}})
    const recipientResponse = await getRecipientEarnings({request: new Request('https://mejay.app/api/marketplace/recipient-earnings?range=ytd'), env: {DB: {}}})

    expect(providerResponse.headers.get('cache-control')).toContain('no-store')
    expect(getProviderReport).toHaveBeenCalledWith('recipient-1', '30d')
    expect(getRecipientReport).toHaveBeenCalledWith('recipient-1', 'ytd')
    await expect(recipientResponse.json()).resolves.toMatchObject({ok: true, data: {summary: {owedMinor: 480}}})
  })
})
