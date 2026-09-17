import {beforeEach, describe, expect, it, vi} from 'vitest'

import {createIndustryReportingBatch, exportIndustryReportingBatch, getIndustryReporting, resolveIndustryReportingBatch, submitIndustryReportingBatch, validateIndustryReporting} from './reporting'

const getSessionUserId = vi.fn()
const getDashboard = vi.fn()
const validate = vi.fn()
const createBatch = vi.fn()
const getExport = vi.fn()
const submitBatch = vi.fn()
const resolveBatch = vi.fn()

vi.mock('../_auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('../_auth')>(),
  getSessionUserId: (...args: unknown[]) => getSessionUserId(...args),
}))
vi.mock('../../marketplace/industry-reporting-service', () => ({
  IndustryReportingService: class {
    getDashboard = getDashboard
    validate = validate
    createBatch = createBatch
    getExport = getExport
    submitBatch = submitBatch
    resolveBatch = resolveBatch
  },
}))

const context = (path: string, init?: RequestInit, params: Record<string, string> = {}) => ({
  request: new Request(`https://mejay.app${path}`, init),
  env: {DB: {}},
  params,
})

describe('industry reporting admin routes', () => {
  beforeEach(() => {
    for (const mock of [getSessionUserId, getDashboard, validate, createBatch, getExport, submitBatch, resolveBatch]) mock.mockReset()
  })

  it('requires authentication and rejects invalid report dates', async () => {
    getSessionUserId.mockResolvedValueOnce(null).mockResolvedValueOnce('admin-1')
    expect((await getIndustryReporting(context('/api/marketplace-admin/reporting'))).status).toBe(401)
    expect((await getIndustryReporting(context('/api/marketplace-admin/reporting?date=wrong'))).status).toBe(400)
    expect(getDashboard).not.toHaveBeenCalled()
  })

  it('runs validation and batch lifecycle commands with strict input', async () => {
    getSessionUserId.mockResolvedValue('admin-1')
    validate.mockResolvedValue({ready: 131, metadataErrors: 6})
    createBatch.mockResolvedValue({id: 'batch-1'})

    const body = {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({reportDate: '2026-09-17'})}
    expect((await validateIndustryReporting(context('/api/marketplace-admin/reporting/validate', body))).status).toBe(200)
    expect((await createIndustryReportingBatch(context('/api/marketplace-admin/reporting/batches', body))).status).toBe(201)
    await submitIndustryReportingBatch(context('/api/marketplace-admin/reporting/batches/batch-1/submit', {method: 'POST'}, {batchId: 'batch-1'}))
    await resolveIndustryReportingBatch(context('/api/marketplace-admin/reporting/batches/batch-1/resolve', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({status: 'accepted'})}, {batchId: 'batch-1'}))

    expect(validate).toHaveBeenCalledWith('admin-1', '2026-09-17')
    expect(createBatch).toHaveBeenCalledWith('admin-1', '2026-09-17')
    expect(submitBatch).toHaveBeenCalledWith('admin-1', 'batch-1')
    expect(resolveBatch).toHaveBeenCalledWith('admin-1', 'batch-1', 'accepted', undefined)
  })

  it('returns a no-store CSV attachment', async () => {
    getSessionUserId.mockResolvedValue('reviewer-1')
    getExport.mockResolvedValue({fileName: 'mejay-reporting-2026-09-17.csv', data: 'event_id\r\nevent-1\r\n'})

    const response = await exportIndustryReportingBatch(context('/api/marketplace-admin/reporting/batches/batch-1/export', undefined, {batchId: 'batch-1'}))

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('content-disposition')).toContain('mejay-reporting-2026-09-17.csv')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(await response.text()).toContain('event-1')
  })
})