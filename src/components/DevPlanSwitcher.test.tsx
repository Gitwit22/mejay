import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DevPlanSwitcher } from './DevPlanSwitcher';
import { usePlanStore } from '@/stores/planStore';

// Mock the store
vi.mock('@/stores/planStore', () => ({
  usePlanStore: vi.fn(),
}));

const mockUsePlanStore = usePlanStore as unknown as ReturnType<typeof vi.fn>;

describe('DevPlanSwitcher', () => {
  const mockSetBillingEnabled = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not render in production mode', () => {
    const originalEnv = import.meta.env.DEV;
    (import.meta.env.DEV as boolean) = false;

    mockUsePlanStore.mockReturnValue({
      billingEnabled: false,
      setBillingEnabled: mockSetBillingEnabled,
    });

    const { container } = render(<DevPlanSwitcher />);
    expect(container.firstChild).toBeNull();

    (import.meta.env.DEV as boolean) = originalEnv;
  });

  it('should render in dev mode', () => {
    mockUsePlanStore.mockReturnValue({
      billingEnabled: false,
      setBillingEnabled: mockSetBillingEnabled,
    });

    render(<DevPlanSwitcher />);
    expect(screen.getByText('Dev')).toBeInTheDocument();
    expect(screen.getByText('Billing Off')).toBeInTheDocument();
    expect(screen.getByText('Billing On')).toBeInTheDocument();
  });

  it('should highlight "Billing Off" when billing is disabled', () => {
    mockUsePlanStore.mockReturnValue({
      billingEnabled: false,
      setBillingEnabled: mockSetBillingEnabled,
    });

    render(<DevPlanSwitcher />);
    const billingOffButton = screen.getByText('Billing Off').closest('button');
    expect(billingOffButton).toHaveClass('bg-muted');
  });

  it('should highlight "Billing On" when billing is enabled', () => {
    mockUsePlanStore.mockReturnValue({
      billingEnabled: true,
      setBillingEnabled: mockSetBillingEnabled,
    });

    render(<DevPlanSwitcher />);
    const billingOnButton = screen.getByText('Billing On').closest('button');
    expect(billingOnButton).toHaveClass('from-primary');
  });

  it('should call setBillingEnabled(false) when "Billing Off" is clicked', () => {
    mockUsePlanStore.mockReturnValue({
      billingEnabled: true,
      setBillingEnabled: mockSetBillingEnabled,
    });

    render(<DevPlanSwitcher />);
    const billingOffButton = screen.getByText('Billing Off');
    fireEvent.click(billingOffButton);
    expect(mockSetBillingEnabled).toHaveBeenCalledWith(false);
  });

  it('should call setBillingEnabled(true) when "Billing On" is clicked', () => {
    mockUsePlanStore.mockReturnValue({
      billingEnabled: false,
      setBillingEnabled: mockSetBillingEnabled,
    });

    render(<DevPlanSwitcher />);
    const billingOnButton = screen.getByText('Billing On');
    fireEvent.click(billingOnButton);
    expect(mockSetBillingEnabled).toHaveBeenCalledWith(true);
  });
});
