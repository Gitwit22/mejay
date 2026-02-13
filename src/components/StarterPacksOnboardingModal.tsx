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
const PARTY_PACK_ID: StarterPackId = 'party-pack';

export function StarterPacksOnboardingModal(props: StarterPacksOnboardingModalProps) {
  const { open, onOpenChange } = props;

  const initialSelectedPacks = useMemo(() => {
    const prefs = readStarterPacksPrefs();
    if (!prefs.choiceMade) return [VALENTINE_PACK_ID];
    return prefs.enabledPackIds;
  }, []);

  const [selectedPacks, setSelectedPacks] = useState<string[]>(initialSelectedPacks);
  const [isWorking, setIsWorking] = useState(false);

  function togglePack(packId: string) {
    setSelectedPacks((prev) =>
      prev.includes(packId)
        ? prev.filter((id) => id !== packId)
        : [...prev, packId]
    );
  }

  const close = () => onOpenChange(false);

  const saveAndClose = (enabledPackIds: StarterPackId[]) => {
    writeStarterPacksPrefs({ choiceMade: true, enabledPackIds });
    close();
  };

  const handleSkip = () => {
    saveAndClose([]);
  };

  const handleConfirm = async () => {
    // Persist "disabled" immediately if nothing selected.
    if (selectedPacks.length === 0) {
      saveAndClose([]);
      return;
    }

    setIsWorking(true);
    try {
      const seeded = await useDJStore.getState().seedStarterTracksIfEmpty(selectedPacks as StarterPackId[]);
      if (!seeded) {
        toast({
          title: 'Starter packs not added',
          description: 'Your library is not empty, or the download failed. You can try again.',
          variant: 'destructive',
        });
        return;
      }

      const packNames = selectedPacks
        .map((id) => {
          if (id === VALENTINE_PACK_ID) return 'Valentine 2026';
          if (id === PARTY_PACK_ID) return 'Party Pack';
          return id;
        })
        .join(', ');

      toast({
        title: 'Starter packs added',
        description: `${packNames} tracks are now in your Library.`,
      });

      saveAndClose(selectedPacks as StarterPackId[]);
    } catch (e) {
      toast({
        title: 'Could not add starter packs',
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
              checked={selectedPacks.includes(VALENTINE_PACK_ID)}
              onCheckedChange={() => togglePack(VALENTINE_PACK_ID)}
              disabled={isWorking}
            />
            <div className="grid gap-1 leading-tight">
              <Label htmlFor="starter-pack-valentine-2026">Valentine 2026 (5 tracks)</Label>
              <div className="text-xs text-muted-foreground">John Blaze — Believe It, I Do, SAYLESS, Sundress, Turnstyle</div>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id="starter-pack-party"
              checked={selectedPacks.includes(PARTY_PACK_ID)}
              onCheckedChange={() => togglePack(PARTY_PACK_ID)}
              disabled={isWorking}
            />
            <div className="grid gap-1 leading-tight">
              <Label htmlFor="starter-pack-party">Party Pack (6 tracks)</Label>
              <div className="text-xs text-muted-foreground">John Blaze — Im So Lit, Its a Celebration, Money Right, No Friends, On Tha Move, Strawberry and Lime Liquor</div>
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
