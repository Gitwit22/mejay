import { describe, it, expect, beforeEach } from 'vitest';
import { usePlanStore } from './planStore';

describe.skip('planStore - basic functionality', () => {
  beforeEach(() => {
    // Reset store state before each test if setState exists
    const setState = (usePlanStore as any).setState;
    if (setState) {
      setState({
        billingEnabled: false,
        authBypassEnabled: false,
        user: null,
      });
    }
  });

  it('should initialize with default state', () => {
    const state = usePlanStore.getState();
    expect(state.billingEnabled).toBeDefined();
    expect(state.canToggleAuthBypass).toBeDefined();
  });

  it('should toggle billing enabled state', () => {
    const { setBillingEnabled } = usePlanStore.getState();
    
    setBillingEnabled(true);
    expect(usePlanStore.getState().billingEnabled).toBe(true);
    
    setBillingEnabled(false);
    expect(usePlanStore.getState().billingEnabled).toBe(false);
  });

  it('should handle auth bypass toggle', () => {
    const { setAuthBypassEnabled, canToggleAuthBypass } = usePlanStore.getState();
    
    if (canToggleAuthBypass) {
      setAuthBypassEnabled(true);
      expect(usePlanStore.getState().authBypassEnabled).toBe(true);
      
      setAuthBypassEnabled(false);
      expect(usePlanStore.getState().authBypassEnabled).toBe(false);
    }
  });

  it('should mark user as authenticated', () => {
    const { markAuthenticated } = usePlanStore.getState();
    
    markAuthenticated({ email: 'test@example.com' });
    
    const state = usePlanStore.getState();
    expect(state.user).toBeDefined();
    expect(state.user?.email).toBe('test@example.com');
  });
});
