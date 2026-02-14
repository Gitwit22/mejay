import { usePlanStore } from '@/stores/planStore';
import { X, Check, Sparkles, Volume2, Sliders, Gauge } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useLocation, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import { toast } from '@/hooks/use-toast';
import { startCheckout } from '@/lib/checkout';
import {getSettingsEntryNavigateOptions} from '@/app/navigation/settingsReturnTo'

export function UpgradeModal() {
  const { upgradeModalOpen, closeUpgradeModal, billingEnabled, setDevPlan, authBypassEnabled, plan, isGuestMode, authStatus } = usePlanStore();
  const navigate = useNavigate();
  const location = useLocation();

  const isFullProgramOwner = plan === 'full_program'
  const isProOwner = plan === 'pro'
  const isUpgraded = isProOwner || isFullProgramOwner
  const needsAuth = isGuestMode || authStatus === 'anonymous'

  // Handle ESC key to close modal
  useEffect(() => {
    if (!upgradeModalOpen) return;
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeUpgradeModal();
      }
    };
    
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [upgradeModalOpen, closeUpgradeModal]);

  const goToPricing = () => {
    closeUpgradeModal();
    const from = `${location.pathname}${location.search}`;
    navigate(
      `/app/settings/pricing?returnTo=${encodeURIComponent(from)}`,
      getSettingsEntryNavigateOptions({state: {from}}),
    );
  };

  const goToManagePlan = () => {
    closeUpgradeModal()
    const from = `${location.pathname}${location.search}`
    navigate(
      `/app/settings/billing?returnTo=${encodeURIComponent(from)}`,
      getSettingsEntryNavigateOptions({state: {from}}),
    )
  }

  const beginCheckout = async (plan: 'pro' | 'full_program') => {
    if (!billingEnabled) {
      setDevPlan(plan === 'pro' ? 'pro' : 'full_program');
      toast({title: 'Billing disabled (dev)', description: 'Unlocked locally.'});
      closeUpgradeModal();
      return;
    }

    if (authBypassEnabled) {
      toast({
        title: 'Login bypass is enabled',
        description: 'Disable bypass and sign in to use checkout.',
        variant: 'destructive',
      });
      goToPricing();
      return;
    }
    try {
      await startCheckout(plan, undefined, 'monthly');
    } catch (e) {
      toast({
        title: 'Checkout unavailable',
        description: e instanceof Error ? e.message : 'Could not start checkout right now.',
        variant: 'destructive',
      });
      goToPricing();
    }
  };

  const features = [
    { icon: Volume2, label: 'Auto volume matching' },
    { icon: Sliders, label: 'Smooth transitions & crossfade control' },
    { icon: Gauge, label: 'Tempo control + BPM tools' },
    { icon: Sparkles, label: 'Party-ready playback' },
  ];

  return (
    <AnimatePresence>
      {upgradeModalOpen && (
        <>
          {/* Backdrop with Flexbox Centering */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeUpgradeModal}
            style={{
              position: 'fixed',
              inset: 0,
              background: 'rgba(0, 0, 0, 0.55)',
              backdropFilter: 'blur(6px)',
              zIndex: 9999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '16px',
            }}
          >
            {/* Modal Container */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ type: 'spring', duration: 0.4 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                maxWidth: '420px',
                width: '100%',
                borderRadius: '20px',
              }}
            >
              <div className="glass-card p-6 relative">
              {/* Close Button */}
              <button
                onClick={closeUpgradeModal}
                className="absolute top-4 right-4 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-white/10 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>

              {/* Header */}
              <div className="text-center mb-6">
                <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-secondary mb-4">
                  <Sparkles className="w-7 h-7 text-white" />
                </div>
                <h2 className="text-xl font-bold text-foreground mb-2">
                  {isFullProgramOwner ? 'Full Program unlocked' : 'Start 3-Day Trial'}
                </h2>
                <p className="text-sm text-muted-foreground mb-2">
                  {isFullProgramOwner
                    ? 'Everything is unlocked on your account.'
                    : needsAuth
                      ? 'Create an account to unlock Pro features'
                      : 'Get full access to all Pro features'}
                </p>
                {!isFullProgramOwner && (
                  <p className="text-xs text-muted-foreground/80">
                    $5/month after trial. Cancel anytime.
                  </p>
                )}
              </div>

              {/* Features List */}
              <div className="space-y-3 mb-6">
                {features.map((feature, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-accent/20 flex items-center justify-center">
                      <feature.icon className="w-4 h-4 text-accent" />
                    </div>
                    <span className="text-sm text-foreground">{feature.label}</span>
                    <Check className="w-4 h-4 text-accent ml-auto" />
                  </div>
                ))}
              </div>

              {/* Actions */}
              {isFullProgramOwner ? (
                <div className="space-y-2">
                  <button
                    onClick={goToManagePlan}
                    className="w-full py-3.5 rounded-xl bg-white/10 text-foreground font-medium text-sm hover:bg-white/15 transition-colors"
                  >
                    Manage plan
                  </button>
                  <button
                    onClick={closeUpgradeModal}
                    className="w-full py-3.5 rounded-xl bg-transparent text-muted-foreground font-medium text-sm hover:text-foreground transition-colors"
                  >
                    Close
                  </button>
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <button
                      type="button"
                      onClick={() => beginCheckout('pro')}
                      className="w-full py-3.5 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-semibold text-sm hover:opacity-90 transition-opacity"
                      disabled={isUpgraded}
                    >
                      {isFullProgramOwner ? 'Full Program active' : isProOwner ? 'Pro active' : 'Start 3-Day Trial'}
                    </button>
                    {!needsAuth && (
                      <button
                        onClick={() => beginCheckout('full_program')}
                        className="w-full py-3.5 rounded-xl bg-white/10 text-foreground font-medium text-sm hover:bg-white/15 transition-colors"
                        disabled={isFullProgramOwner}
                      >
                        {isFullProgramOwner ? 'Full Program active' : 'Buy Full Program — Own It Forever'}
                      </button>
                    )}
                    <button
                      onClick={goToPricing}
                      className="w-full py-3.5 rounded-xl bg-transparent text-muted-foreground font-medium text-sm hover:text-foreground transition-colors"
                    >
                      View pricing details
                    </button>
                  </div>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
