import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {render, screen} from '@testing-library/react'
import {MemoryRouter} from 'react-router-dom'
import {describe, expect, it, vi} from 'vitest'

import ProviderPortalPage from './ProviderPortalPage'

// Navigation must render while portal data is still loading, so leave every request pending.
vi.mock('@/lib/providerApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/providerApi')>()
  return Object.fromEntries(Object.entries(actual).map(([name, value]) => [name, typeof value === 'function' ? vi.fn(() => new Promise(() => undefined)) : value]))
})

describe('ProviderPortalPage navigation', () => {
  it('links back to the main MEJay app', () => {
    const queryClient = new QueryClient({defaultOptions: {queries: {retry: false}}})
    render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/app/artist']}><ProviderPortalPage /></MemoryRouter></QueryClientProvider>)

    expect(screen.getByRole('link', {name: 'Back to MEJay'})).toHaveAttribute('href', '/app')
  })
})
