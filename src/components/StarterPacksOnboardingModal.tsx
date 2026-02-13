import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { useDJStore } from '@/stores/djStore';
import type { StarterPackId } from '@/lib/starterPacksPrefs';
import { readStarterPacksPrefs, writeStarterPacksPrefs } from '@/lib/starterPacksPrefs';

export type StarterPacksOnboardingModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const VALENTINE_PACK_ID: StarterPackId = 'valentine-2026';

export function StarterPacksOnboardingModal(props: StarterPacksOnboardingModalProps) {
  const { open, onOpenChange } = props;

  const initialChecked = useMemo(() => {
    const prefs = readStarterPacksPrefs();
    if (!prefs.choiceMade) return true;
    return prefs.enabledPackIds.includes(VALENTINE_PACK_ID);
  }, []);

  const [valentineEnabled, setValentineEnabled] = useState<boolean>(initialChecked);
  const [isWorking, setIsWorking] = useState(false);

  const close = () => onOpenChange(false);

  const saveAndClose = (enabledPackIds: StarterPackId[]) => {
    writeStarterPacksPrefs({ choiceMade: true, enabledPackIds });
    close();
  };

  const handleSkip = () => {
    saveAndClose([]);
  };

  const handleConfirm = async () => {
    const enabled: StarterPackId[] = valentineEnabled ? [VALENTINE_PACK_ID] : [];

    // Persist "disabled" immediately.
    if (enabled.length === 0) {
      saveAndClose([]);
      return;
    }

    setIsWorking(true);
    try {
      const seeded = await useDJStore.getState().seedStarterTracksIfEmpty(enabled);
      if (!seeded) {
        toast({
          title: 'Starter pack not added',
          description: 'Your library is not empty, or the download failed. You can try again.',
          variant: 'destructive',
        });
        return;
      }

      toast({
        title: 'Starter pack added',
        description: 'Valentine 2026 tracks are now in your Library.',
      });

      saveAndClose(enabled);
    } catch (e) {
      toast({
        title: 'Could not add starter pack',
        description: e instanceof Error ? e.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a starter pack?</DialogTitle>
          <DialogDescription>
            Start with a few tracks so you can try Party Mode right away.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="starter-pack-valentine-2026"
              checked={valentineEnabled}
              onCheckedChange={(v) => setValentineEnabled(v === true)}
              disabled={isWorking}
            />
            <div className="grid gap-1 leading-tight">
              <Label htmlFor="starter-pack-valentine-2026">Valentine 2026 (5 tracks)</Label>
              <div className="text-xs text-muted-foreground">John Blaze — Believe It, I Do, SAYLESS, Sundress, Turnstyle</div>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            You can still import your own music any time.
          </div>
        </div>

        <DialogFooter>
          <Button variant="secondary" type="button" onClick={handleSkip} disabled={isWorking}>
            Skip
          </Button>
          <Button type="button" onClick={handleConfirm} disabled={isWorking}>
            {isWorking ? 'Adding…' : 'Add to Library'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
