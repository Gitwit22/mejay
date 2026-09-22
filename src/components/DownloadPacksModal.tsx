import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { useDJStore } from '@/stores/djStore';
import { getStarterPackName, starterPacksCatalog } from '@/config/starterPacks';
import type { StarterPackId } from '@/lib/starterPacksPrefs';

export type DownloadPacksModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function DownloadPacksModal(props: DownloadPacksModalProps) {
  const { open, onOpenChange } = props;

  const [selectedPacks, setSelectedPacks] = useState<StarterPackId[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);

  function togglePack(packId: StarterPackId) {
    setSelectedPacks((prev) =>
      prev.includes(packId)
        ? prev.filter((id) => id !== packId)
        : [...prev, packId]
    );
  }

  const close = () => {
    setSelectedPacks([]);
    onOpenChange(false);
  };

  const handleDownload = async () => {
    if (selectedPacks.length === 0) {
      toast({
        title: 'No releases selected',
        description: 'Select at least one Music Store release to add to your library.',
        variant: 'destructive',
      });
      return;
    }

    setIsDownloading(true);
    try {
      const result = await useDJStore.getState().downloadStarterPacks(selectedPacks);
      const packNames = selectedPacks.map((id) => getStarterPackName(id)).join(', ');

      if (result.added === 0 && result.skipped > 0 && result.failed === 0) {
        toast({
          title: 'Already in your library',
          description: `Everything from ${packNames} is already available on this device.`,
        });
      } else if (result.added === 0 && result.failed > 0) {
        toast({
          title: 'Music Store download failed',
          description: `${result.failed} track${result.failed === 1 ? '' : 's'} could not be downloaded from ${packNames}.`,
          variant: 'destructive',
        });
      } else if (result.added > 0) {
        toast({
          title: 'Music added to your library',
          description: `Added ${result.added} track${result.added === 1 ? '' : 's'} from ${packNames}${result.skipped > 0 ? ` • ${result.skipped} already owned` : ''}${result.failed > 0 ? ` • ${result.failed} unavailable` : ''}.`,
        });
        close();
      }
    } catch (e) {
      toast({
        title: 'Music Store download failed',
        description: e instanceof Error ? e.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const handleRemoveStarters = async () => {
    setIsDownloading(true);
    try {
      const removed = await useDJStore.getState().removeStarterTracks();
      toast({
        title: 'Store music removed',
        description: `Removed ${removed} bundled track${removed === 1 ? '' : 's'} from your library.`,
      });
      close();
    } catch (e) {
      toast({
        title: 'Remove failed',
        description: e instanceof Error ? e.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Music Store</DialogTitle>
          <DialogDescription>
            Browse bundled releases for this device. Artwork, artist info, and track details are shown before you add anything.
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
                  id={`download-pack-${pack.id}`}
                  checked={isSelected}
                  onCheckedChange={() => togglePack(pack.id)}
                  disabled={isDownloading}
                  className="mt-1"
                />
                <Label htmlFor={`download-pack-${pack.id}`} className="flex flex-1 items-start gap-3 cursor-pointer">
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

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="outline"
            onClick={handleRemoveStarters}
            disabled={isDownloading}
            className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
          >
            Remove Store Music
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" type="button" onClick={close} disabled={isDownloading}>
              Cancel
            </Button>
            <Button type="button" onClick={handleDownload} disabled={isDownloading}>
              {isDownloading ? 'Adding…' : 'Add to Library'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
