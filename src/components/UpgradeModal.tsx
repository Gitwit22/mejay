import { usePlanStore } from '@/stores/planStore';
import { X, Check, Sparkles, Volume2, Sliders, Gauge } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';

export function UpgradeModal() {
  const { upgradeModalOpen, closeUpgradeModal } = usePlanStore();
  const navigate = useNavigate();

  const goToPricing = () => {
    closeUpgradeModal();
    navigate('/pricing');
  };

  const features = [
    { icon: Volume2, label: 'Auto volume matching' },
    { icon: Sliders, label: 'Smooth transitions & crossfade control' },
    { icon: Gauge, label: 'Tempo & energy control' },
    { icon: Sparkles, label: 'Party-ready playback' },
  ];

  return (
    <AnimatePresence>
      {upgradeModalOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeUpgradeModal}
            className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm"
          />
          
          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', duration: 0.4 }}
            className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-[201] max-w-sm mx-auto"
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
                <h2 className="text-xl font-bold text-foreground mb-1">Unlock ME Plus</h2>
                <p className="text-sm text-muted-foreground">Pro DJ features for seamless mixes</p>
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

              {/* Pricing Buttons */}
              <div className="space-y-2">
                <button
                  onClick={goToPricing}
                  className="w-full py-3.5 rounded-xl bg-gradient-to-r from-primary to-secondary text-white font-semibold text-sm hover:opacity-90 transition-opacity"
                >
                  $4.99 / month
                </button>
                <button
                  onClick={goToPricing}
                  className="w-full py-3.5 rounded-xl bg-white/10 text-foreground font-medium text-sm hover:bg-white/15 transition-colors"
                >
                  $50 / year
                  <span className="ml-2 text-xs text-accent">(2 months free)</span>
                </button>
              </div>

              {/* Footer */}
              <p className="text-center text-[11px] text-muted-foreground mt-4">
                Cancel anytime. No commitment.
              </p>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
