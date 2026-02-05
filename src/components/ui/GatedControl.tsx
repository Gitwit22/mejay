import { ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { usePlanStore, Feature } from '@/stores/planStore';
import { cn } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface GatedControlProps {
  feature: Feature;
  children: ReactNode;
  className?: string;
  showLockIcon?: boolean;
}

/**
 * Wraps a control and dims/disables it if the user doesn't have the feature.
 * Clicking a locked control opens the upgrade modal.
 */
export function GatedControl({
  feature,
  children,
  className,
  showLockIcon = false,
}: GatedControlProps) {
  const { hasFeature, openUpgradeModal } = usePlanStore();
  const isLocked = !hasFeature(feature);

  if (!isLocked) {
    return <>{children}</>;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openUpgradeModal();
            }}
            className={cn(
              'relative cursor-pointer',
              isLocked && 'opacity-40 pointer-events-auto',
              className
            )}
          >
            {/* Lock overlay */}
            {showLockIcon && (
              <div className="absolute -top-1 -right-1 z-10 w-5 h-5 rounded-full bg-muted flex items-center justify-center">
                <Lock className="w-3 h-3 text-muted-foreground" />
              </div>
            )}
            {/* Disable pointer events on children */}
            <div className="pointer-events-none">{children}</div>
          </div>
        </TooltipTrigger>
        <TooltipContent side="top" className="bg-popover text-popover-foreground text-xs">
          Upgrade to ME Plus to unlock
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

interface GatedSectionProps {
  feature: Feature;
  children: ReactNode;
  className?: string;
  label?: string;
}

/**
 * Wraps a section/card and shows a lock overlay when locked.
 */
export function GatedSection({
  feature,
  children,
  className,
  label,
}: GatedSectionProps) {
  const { hasFeature, openUpgradeModal } = usePlanStore();
  const isLocked = !hasFeature(feature);

  return (
    <div className={cn('relative', className)}>
      {children}
      {isLocked && (
        <div
          onClick={openUpgradeModal}
          className="absolute inset-0 z-10 flex items-center justify-center cursor-pointer rounded-2xl bg-background/60 backdrop-blur-[2px]"
        >
          <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-muted/80">
            <Lock className="w-4 h-4 text-primary" />
            <span className="text-xs font-medium text-foreground">
              {label || 'Upgrade to unlock'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
