import { useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { useDJStore } from '@/stores/djStore';
import { getStarterPackName, starterPacksCatalog } from '@/config/starterPacks';
import type { StarterPackId } from '@/lib/starterPacksPrefs';
import { readStarterPacksPrefs, writeStarterPacksPrefs } from '@/lib/starterPacksPrefs';

export type StarterPacksOnboardingModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function StarterPacksOnboardingModal(props: StarterPacksOnboardingModalProps) {
  const { open, onOpenChange } = props;

  const initialSelectedPacks = useMemo<StarterPackId[]>(() => {
    const prefs = readStarterPacksPrefs();
    if (!prefs.choiceMade) return starterPacksCatalog.map((pack) => pack.id);
    return prefs.enabledPackIds;
  }, []);

  const [selectedPacks, setSelectedPacks] = useState<StarterPackId[]>(initialSelectedPacks);
  const [isWorking, setIsWorking] = useState(false);

  function togglePack(packId: StarterPackId) {
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
    if (selectedPacks.length === 0) {
      saveAndClose([]);
      return;
    }

    setIsWorking(true);
    try {
      const seeded = await useDJStore.getState().seedStarterTracksIfEmpty(selectedPacks);
      if (!seeded) {
        saveAndClose(selectedPacks);
        toast({
          title: 'Store music not added',
          description: 'You already have tracks in your library. Open Settings and choose Music Store to add bundled releases later.',
          variant: 'destructive',
        });
        return;
      }

      const packNames = selectedPacks.map((id) => getStarterPackName(id)).join(', ');

      toast({
        title: 'Music Store release added',
        description: `${packNames} is now ready in your library.`,
      });

      saveAndClose(selectedPacks);
    } catch (e) {
      toast({
        title: 'Could not add store music',
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
          <DialogTitle>Add music from the Music Store?</DialogTitle>
          <DialogDescription>
            Start with a featured release so you can try Play Mode right away. You can still import your own music any time.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {starterPacksCatalog.map((pack) => {
            const isSelected = selectedPacks.includes(pack.id);
            return (
              <div
                key={pack.id}
                className="flex items-start gap-3 rounded-xl border border-border bg-background/60 p-3"
              >
                <Checkbox
                  id={`starter-pack-${pack.id}`}
                  checked={isSelected}
                  onCheckedChange={() => togglePack(pack.id)}
                  disabled={isWorking}
                  className="mt-1"
                />
                <Label htmlFor={`starter-pack-${pack.id}`} className="flex flex-1 items-start gap-3 cursor-pointer">
                  <img
                    src={pack.artworkUrl}
                    alt={`${pack.title} artwork`}
                    className="h-20 w-20 rounded-lg object-cover"
                  />
                  <div className="grid gap-1 leading-tight">
                    <span>{pack.title}</span>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      {pack.tagline} • {pack.releaseYear}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {pack.artist} • {pack.tracks.length} tracks • {pack.genres.join(' • ')}
                    </div>
                    <div className="text-xs text-muted-foreground">{pack.description}</div>
                    <div className="text-xs text-muted-foreground">
                      {pack.tracks.map((track) => track.title).join(', ')}
                    </div>
                  </div>
                </Label>
              </div>
            );
          })}
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
