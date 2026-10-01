import { describe, it, expect, beforeEach } from 'vitest';
import { usePlanStore } from './planStore';

describe('planStore authentication transitions', () => {
  it('clears guest mode when a guest signs in', () => {
    usePlanStore.setState({authStatus: 'anonymous', isGuestMode: true, user: null})

    usePlanStore.getState().markAuthenticated({id: 'user-1', email: 'test@example.com'})

    expect(usePlanStore.getState()).toMatchObject({
      authStatus: 'authenticated',
      isGuestMode: false,
      user: {id: 'user-1', email: 'test@example.com'},
    })
  })

  it('clears all persisted account state on logout', () => {
    localStorage.setItem('mejay:accessPlan', 'pro')
    localStorage.setItem('mejay:stripeCustomerId', 'cus_test')
    localStorage.setItem('mejay:authBypassEnabled', 'true')
    localStorage.setItem('mejay:guestId', 'guest-test')
    localStorage.setItem('mejay:stripeSessionId', 'cs_test')
    usePlanStore.setState({
      plan: 'pro',
      planSource: 'runtime',
      authStatus: 'authenticated',
      user: {id: 'user-1', email: 'test@example.com', accountIntent: 'consumer'},
      artistPortalAccess: true,
      isGuestMode: true,
      guestId: 'guest-test',
      authBypassEnabled: true,
      stripeCustomerId: 'cus_test',
      subscriptionStatus: 'active',
    })

    usePlanStore.getState().clearAccountSession()

    expect(usePlanStore.getState()).toMatchObject({
      plan: 'free',
      authStatus: 'anonymous',
      user: null,
      artistPortalAccess: false,
      isGuestMode: false,
      guestId: null,
      authBypassEnabled: false,
      stripeCustomerId: null,
      subscriptionStatus: null,
    })
    expect(localStorage.getItem('mejay:accessPlan')).toBeNull()
    expect(localStorage.getItem('mejay:stripeCustomerId')).toBeNull()
    expect(localStorage.getItem('mejay:authBypassEnabled')).toBeNull()
    expect(localStorage.getItem('mejay:guestId')).toBeNull()
    expect(localStorage.getItem('mejay:stripeSessionId')).toBeNull()
  })
})

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
