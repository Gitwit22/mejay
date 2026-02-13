import { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { useDJStore } from '@/stores/djStore';
import type { StarterPackId } from '@/lib/starterPacksPrefs';

export type DownloadPacksModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const VALENTINE_PACK_ID: StarterPackId = 'valentine-2026';
const PARTY_PACK_ID: StarterPackId = 'party-pack';

export function DownloadPacksModal(props: DownloadPacksModalProps) {
  const { open, onOpenChange } = props;

  const [selectedPacks, setSelectedPacks] = useState<string[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);

  function togglePack(packId: string) {
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
        title: 'No packs selected',
        description: 'Please select at least one pack to download.',
        variant: 'destructive',
      });
      return;
    }

    setIsDownloading(true);
    try {
      const result = await useDJStore.getState().downloadStarterPacks(selectedPacks as StarterPackId[]);
      
      if (result.added === 0 && result.skipped > 0) {
        toast({
          title: 'No new tracks',
          description: 'All selected tracks are already in your library.',
        });
      } else if (result.added > 0) {
        const packNames = selectedPacks
          .map((id) => {
            if (id === VALENTINE_PACK_ID) return 'Valentine 2026';
            if (id === PARTY_PACK_ID) return 'Party Pack';
            return id;
          })
          .join(', ');

        toast({
          title: 'Packs downloaded',
          description: `Added ${result.added} track${result.added === 1 ? '' : 's'} from ${packNames}${result.skipped > 0 ? ` (${result.skipped} already in library)` : ''}.`,
        });
        close();
      }
    } catch (e) {
      toast({
        title: 'Download failed',
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
        title: 'Starter tracks removed',
        description: `Removed ${removed} starter track${removed === 1 ? '' : 's'} from your library.`,
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
          <DialogTitle>Download Starter Packs</DialogTitle>
          <DialogDescription>
            Download starter tracks to your library. Duplicates will be skipped.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <Checkbox
              id="download-pack-valentine-2026"
              checked={selectedPacks.includes(VALENTINE_PACK_ID)}
              onCheckedChange={() => togglePack(VALENTINE_PACK_ID)}
              disabled={isDownloading}
            />
            <div className="grid gap-1 leading-tight">
              <Label htmlFor="download-pack-valentine-2026">Valentine 2026 (5 tracks)</Label>
              <div className="text-xs text-muted-foreground">John Blaze — Believe It, I Do, SAYLESS, Sundress, Turnstyle</div>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Checkbox
              id="download-pack-party"
              checked={selectedPacks.includes(PARTY_PACK_ID)}
              onCheckedChange={() => togglePack(PARTY_PACK_ID)}
              disabled={isDownloading}
            />
            <div className="grid gap-1 leading-tight">
              <Label htmlFor="download-pack-party">Party Pack (6 tracks)</Label>
              <div className="text-xs text-muted-foreground">John Blaze — Im So Lit, Its a Celebration, Money Right, No Friends, On Tha Move, Strawberry and Lime Liquor</div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button 
            type="button" 
            variant="outline" 
            onClick={handleRemoveStarters} 
            disabled={isDownloading}
            className="text-destructive border-destructive/40 hover:bg-destructive/10 hover:text-destructive"
          >
            Remove Starter Tracks
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" type="button" onClick={close} disabled={isDownloading}>
              Cancel
            </Button>
            <Button type="button" onClick={handleDownload} disabled={isDownloading}>
              {isDownloading ? 'Downloading…' : 'Download'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
