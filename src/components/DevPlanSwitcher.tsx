import { usePlanStore } from '@/stores/planStore';
import { cn } from '@/lib/utils';
import { Crown, User } from 'lucide-react';

export function DevPlanSwitcher() {
  const { plan, setPlan } = usePlanStore();

  // Only show in development
  if (import.meta.env.PROD) return null;

  return (
    <div className="fixed top-3 right-3 z-[100] flex items-center gap-2 px-3 py-2 rounded-xl bg-background/90 backdrop-blur-md border border-border shadow-lg">
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider mr-1">Dev</span>
      <button
        onClick={() => setPlan('free')}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
          plan === 'free'
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <User className="w-3 h-3" />
        Free
      </button>
      <button
        onClick={() => setPlan('plus')}
        className={cn(
          'flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all',
          plan === 'plus'
            ? 'bg-gradient-to-r from-primary to-secondary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground'
        )}
      >
        <Crown className="w-3 h-3" />
        Plus
      </button>
    </div>
  );
}
