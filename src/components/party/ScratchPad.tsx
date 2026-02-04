import { Disc3 } from 'lucide-react';
import { useDJStore } from '@/stores/djStore';
import { cn } from '@/lib/utils';
import { Slider } from '@/components/ui/slider';
import type { ScratchType } from '@/lib/audioEngine';

const SCRATCH_TYPES: { type: ScratchType; label: string; emoji: string }[] = [
  { type: 'baby', label: 'Baby', emoji: '👶' },
  { type: 'chirp', label: 'Chirp', emoji: '🐦' },
  { type: 'transformer', label: 'Transform', emoji: '🤖' },
  { type: 'tear', label: 'Tear', emoji: '💧' },
  { type: 'stab', label: 'Stab', emoji: '⚡' },
];

export function ScratchPad() {
  const { settings, updateUserSettings, performScratch, deckA, deckB, activeDeck } = useDJStore();
  
  const currentDeck = activeDeck === 'A' ? deckA : deckB;
  const isPlaying = currentDeck.isPlaying;

  return (
    <div className="glass-card space-y-4">
      <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
        <Disc3 className="w-4 h-4 text-secondary" />
        Scratch Pad
      </h3>

      {/* Scratch Buttons */}
      <div className="grid grid-cols-5 gap-2">
        {SCRATCH_TYPES.map(({ type, label, emoji }) => (
          <button
            key={type}
            onClick={() => performScratch(type)}
            disabled={!isPlaying}
            className={cn(
              'flex flex-col items-center justify-center p-3 rounded-xl transition-all',
              'bg-gradient-to-br from-white/10 to-white/5 border border-white/10',
              'hover:from-secondary/20 hover:to-secondary/10 hover:border-secondary/30',
              'active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed'
            )}
          >
            <span className="text-lg mb-1">{emoji}</span>
            <span className="text-[9px] text-muted-foreground uppercase tracking-wider">{label}</span>
          </button>
        ))}
      </div>

      {/* Quantize Setting */}
      <div>
        <span className="text-xs text-muted-foreground block mb-2">Quantize</span>
        <div className="grid grid-cols-3 gap-1.5">
          {(['1/4', '1/2', '1'] as const).map((q) => (
            <button
              key={q}
              onClick={() => updateUserSettings({ scratchQuantize: q })}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                settings.scratchQuantize === q
                  ? 'bg-secondary text-secondary-foreground'
                  : 'bg-white/5 text-muted-foreground hover:bg-white/10'
              )}
            >
              {q} beat
            </button>
          ))}
        </div>
      </div>

      {/* Intensity Slider */}
      <div>
        <div className="flex justify-between mb-2">
          <span className="text-xs text-muted-foreground">Intensity</span>
          <span className="text-xs font-semibold text-secondary">{Math.round(settings.scratchIntensity * 100)}%</span>
        </div>
        <Slider
          value={[settings.scratchIntensity * 100]}
          onValueChange={([v]) => updateUserSettings({ scratchIntensity: v / 100 })}
          min={10}
          max={100}
          step={5}
          className="w-full"
        />
      </div>

      {!isPlaying && (
        <p className="text-[10px] text-muted-foreground text-center py-2">
          Start playing to enable scratching
        </p>
      )}
    </div>
  );
}
