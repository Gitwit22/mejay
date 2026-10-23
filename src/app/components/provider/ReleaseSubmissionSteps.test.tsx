import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {fireEvent, render, screen, waitFor} from '@testing-library/react'
import {beforeEach, describe, expect, it, vi} from 'vitest'

import {getReleaseCertification, saveReleaseCertification, type ProviderReleaseDetail, type ReleaseCertificationState} from '@/lib/providerApi'
import {CertificationStep} from './ReleaseSubmissionSteps'

vi.mock('@/lib/providerApi', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/providerApi')>(),
  getReleaseCertification: vi.fn(),
  saveReleaseCertification: vi.fn(),
}))

const statements = [
  {key: 'original_recording', title: 'Original Recording', text: 'I certify that this recording contains no unauthorized samples or copyrighted third-party recordings.'},
  {key: 'beat_rights', title: 'Beat / Instrumental Rights', text: 'Beat statement'},
  {key: 'distribution_rights', title: 'Distribution Rights', text: 'Distribution statement'},
  {key: 'collaborators_authorized', title: 'Collaborators', text: 'Collaborator statement'},
  {key: 'information_accurate', title: 'Accuracy', text: 'Accuracy statement'},
  {key: 'platform_authorization', title: 'Platform Authorization', text: 'Platform statement'},
]

function state(overrides: Partial<ReleaseCertificationState> = {}): ReleaseCertificationState {
  return {
    version: '2026-10-v1', policy: 'MeJay accepts original music for commercial sale and distribution.', statements,
    requiredKeys: statements.map((statement) => statement.key), tracksWithoutIsrc: 0, rightsStatus: 'NOT_CERTIFIED',
    thirdPartyMaterial: null, draft: null, materials: [], problems: ['rights certification'], history: [], ...overrides,
  }
}

const detail = {release: {id: 'release-1', status: 'PRICING_COMPLETE'}, tracks: []} as unknown as ProviderReleaseDetail

function renderStep(onContinue = vi.fn()) {
  const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
  render(<QueryClientProvider client={client}><CertificationStep detail={detail} onBack={vi.fn()} onContinue={onContinue} /></QueryClientProvider>)
  return onContinue
}

describe('Rights Certification step', () => {
  beforeEach(() => {
    vi.mocked(saveReleaseCertification).mockReset().mockResolvedValue({saved: true})
  })

  it('keeps Review Submission disabled until the question is answered and every statement is checked', async () => {
    vi.mocked(getReleaseCertification).mockResolvedValue(state())
    const onContinue = renderStep()
    expect(await screen.findByText(/MeJay accepts original music/)).toBeInTheDocument()
    const reviewButton = screen.getByRole('button', {name: 'Review Submission'})
    expect(reviewButton).toBeDisabled()

    fireEvent.click(screen.getByRole('radio', {name: /No — entirely original material/}))
    const boxes = screen.getAllByRole('checkbox')
    expect(boxes).toHaveLength(6)
    for (const box of boxes.slice(0, 5)) fireEvent.click(box)
    expect(reviewButton).toBeDisabled()
    fireEvent.click(boxes[5])
    expect(reviewButton).toBeEnabled()

    fireEvent.click(reviewButton)
    await waitFor(() => expect(saveReleaseCertification).toHaveBeenCalledWith('release-1', {
      version: '2026-10-v1', thirdPartyMaterial: 'none', accepted: statements.map((statement) => statement.key),
    }))
    await waitFor(() => expect(onContinue).toHaveBeenCalled())
  })

  it('requires material details for licensed material and warns about review when unsure', async () => {
    vi.mocked(getReleaseCertification).mockResolvedValue(state())
    renderStep()
    await screen.findByText(/MeJay accepts original music/)
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box)

    fireEvent.click(screen.getByRole('radio', {name: /Yes — I have documented rights/}))
    expect(screen.getByText('Third-party material')).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Review Submission'})).toBeDisabled()

    fireEvent.click(screen.getByRole('radio', {name: /Unsure/}))
    expect(screen.getByText(/hold this release for rights review/)).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Review Submission'})).toBeEnabled()
  })

  it('locks the step once the release has been submitted', async () => {
    vi.mocked(getReleaseCertification).mockResolvedValue(state({rightsStatus: 'CERTIFIED_ORIGINAL'}))
    const client = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(<QueryClientProvider client={client}><CertificationStep detail={{...detail, release: {...detail.release, status: 'SUBMITTED'}} as ProviderReleaseDetail} onBack={vi.fn()} onContinue={vi.fn()} /></QueryClientProvider>)
    expect(await screen.findByText(/can no longer be changed/)).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Review Submission'})).toBeDisabled()
  })

  it('prefills the last submitted answers after an edit, explains why, and saves only when confirmed', async () => {
    vi.mocked(getReleaseCertification).mockResolvedValue(state({
      previous: {version: '2026-10-v1', thirdPartyMaterial: 'none', accepted: statements.map((statement) => statement.key), certifiedAt: '2026-10-22T00:00:00.000Z'},
      history: [{id: 'cert-1', certification_version: '2026-10-v1', third_party_material: 'none', rights_status: 'CERTIFIED_ORIGINAL', certified_at: '2026-10-22T00:00:00.000Z'}],
    }))
    const onContinue = renderStep()
    expect(await screen.findByText(/You edited this release after certifying it/)).toBeInTheDocument()
    expect(screen.getByRole('radio', {name: /entirely original/})).toHaveAttribute('aria-checked', 'true')
    const confirm = screen.getByRole('button', {name: 'Review Submission'})
    await waitFor(() => expect(confirm).toBeEnabled())
    expect(saveReleaseCertification).not.toHaveBeenCalled()
    fireEvent.click(confirm)
    await waitFor(() => expect(saveReleaseCertification).toHaveBeenCalledWith('release-1', expect.objectContaining({thirdPartyMaterial: 'none', accepted: statements.map((statement) => statement.key)})))
    await waitFor(() => expect(onContinue).toHaveBeenCalled())
  })

  it('does not pre-check statements whose wording changed since the last certification', async () => {
    vi.mocked(getReleaseCertification).mockResolvedValue(state({previous: {version: '2025-01-v0', thirdPartyMaterial: 'none', accepted: statements.map((statement) => statement.key), certifiedAt: '2026-01-01T00:00:00.000Z'}}))
    renderStep()
    expect(await screen.findByText(/You edited this release after certifying it/)).toBeInTheDocument()
    expect(screen.getByRole('button', {name: 'Review Submission'})).toBeDisabled()
  })

  it('warns that licensed material without a document is reviewed by hand', async () => {
    vi.mocked(getReleaseCertification).mockResolvedValue(state({
      draft: {version: '2026-10-v1', thirdPartyMaterial: 'licensed', accepted: [], savedAt: '2026-10-22T00:00:00.000Z'},
      materials: [{id: 'mat-1', material_type: 'sample', licensor_name: 'Old Record', description: 'Hook', license_type: 'other', document_asset_id: null}],
    }))
    renderStep()
    expect(await screen.findByText(/Without a license document, MeJay checks these rights by hand/)).toBeInTheDocument()
  })
})
