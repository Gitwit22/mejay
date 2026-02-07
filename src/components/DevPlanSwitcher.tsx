import { usePlanStore } from '@/stores/planStore';
import { cn } from '@/lib/utils';
import { CreditCard, Ban } from 'lucide-react';

export function DevPlanSwitcher() {
  const { billingEnabled, setBillingEnabled } = usePlanStore();

  if (!import.meta.env.DEV) return null;

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 px-3 py-2 rounded-xl bg-background/90 backdrop-blur-md border border-border shadow-lg">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1">Dev</span>
      <button
        onClick={() => setBillingEnabled(false)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
          !billingEnabled
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <Ban className="w-3 h-3" />
        Billing Off
      </button>
      <button
        onClick={() => setBillingEnabled(true)}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
          billingEnabled
            ? 'bg-gradient-to-r from-primary to-secondary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <CreditCard className="w-3 h-3" />
        Billing On
      </button>
    </div>
  );
}
