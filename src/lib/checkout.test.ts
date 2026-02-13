import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const originalFetch = globalThis.fetch;

describe('checkout API integration', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn() as any;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should handle successful checkout API call', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({ checkoutUrl: 'https://checkout.stripe.com/test' }),
    };
    
    (globalThis.fetch as any).mockResolvedValueOnce(mockResponse as Response);

    const response = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ priceId: 'price_123' }),
    });

    expect(response.ok).toBe(true);
    const data = await response.json();
    expect(data.checkoutUrl).toBeDefined();
  });

  it('should handle failed checkout API call', async () => {
    const mockResponse = {
      ok: false,
      status: 400,
      json: async () => ({ error: 'Invalid price ID' }),
    };
    
    (globalThis.fetch as any).mockResolvedValueOnce(mockResponse as Response);

    const response = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ priceId: 'invalid' }),
    });

    expect(response.ok).toBe(false);
    expect(response.status).toBe(400);
  });
});
