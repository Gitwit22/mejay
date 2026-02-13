import { describe, it, expect } from 'vitest';
import { MEJAY_LOGO_URL } from './branding';

describe('branding', () => {
  it('should export MEJAY_LOGO_URL', () => {
    expect(MEJAY_LOGO_URL).toBeDefined();
    expect(typeof MEJAY_LOGO_URL).toBe('string');
  });

  it('should have a valid URL format', () => {
    expect(MEJAY_LOGO_URL).toMatch(/^(https?:\/\/|file:\/\/\/|\/).+/);
  });
});
