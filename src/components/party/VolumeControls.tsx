import { Volume2, Shield, Gauge } from 'lucide-react';
import { useDJStore } from '@/stores/djStore';
import { cn } from '@/lib/utils';

export function VolumeControls() {
  const { settings, updateUserSettings } = useDJStore();

  return (
    <div className="glass-card">
      <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
        <Volume2 className="w-4 h-4 text-primary" />
        Auto Volume Matching
      </h3>

      {/* Main Toggle */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs text-muted-foreground">Auto Volume Match</span>
        <button
          onClick={() => updateUserSettings({ autoVolumeMatch: !settings.autoVolumeMatch })}
          className={cn(
            'relative w-12 h-6 rounded-full transition-colors',
            settings.autoVolumeMatch ? 'bg-primary' : 'bg-white/20'
          )}
        >
          <div className={cn(
            'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
            settings.autoVolumeMatch ? 'translate-x-7' : 'translate-x-1'
          )} />
        </button>
      </div>

      {/* Target Loudness */}
      <div className="mb-4">
        <div className="flex justify-between text-xs mb-2">
          <span className="text-muted-foreground">Target Loudness</span>
          <span className="font-medium">
            {settings.targetLoudness < 0.33 ? 'Quiet' : settings.targetLoudness < 0.66 ? 'Normal' : 'Club'}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <Gauge className="w-4 h-4 text-muted-foreground" />
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={settings.targetLoudness}
            onChange={(e) => updateUserSettings({ targetLoudness: parseFloat(e.target.value) })}
            className="flex-1 accent-primary"
          />
        </div>
        <div className="flex justify-between text-[9px] text-muted-foreground mt-1">
          <span>Quiet</span>
          <span>Club</span>
        </div>
      </div>

      {/* Limiter Section */}
      <div className="border-t border-white/10 pt-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-accent" />
            <span className="text-xs text-muted-foreground">Protect from Clipping</span>
          </div>
          <button
            onClick={() => updateUserSettings({ limiterEnabled: !settings.limiterEnabled })}
            className={cn(
              'relative w-12 h-6 rounded-full transition-colors',
              settings.limiterEnabled ? 'bg-accent' : 'bg-white/20'
            )}
          >
            <div className={cn(
              'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
              settings.limiterEnabled ? 'translate-x-7' : 'translate-x-1'
            )} />
          </button>
        </div>

        {settings.limiterEnabled && (
          <div className="flex gap-2">
            {(['light', 'medium', 'strong'] as const).map((strength) => (
              <button
                key={strength}
                onClick={() => updateUserSettings({ limiterStrength: strength })}
                className={cn(
                  'flex-1 py-2 rounded-lg text-xs font-medium transition-colors capitalize',
                  settings.limiterStrength === strength
                    ? 'bg-accent/20 text-accent border border-accent/30'
                    : 'bg-white/5 text-muted-foreground hover:bg-white/10'
                )}
              >
                {strength}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
