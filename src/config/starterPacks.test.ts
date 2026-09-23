import { describe, it, expect } from 'vitest';
import { getStarterPackById, isStarterPackId, starterPacksCatalog, valentine2026Pack } from './starterPacks';

describe('starterPacks', () => {
  it('should expose a music store catalog', () => {
    expect(Array.isArray(starterPacksCatalog)).toBe(true);
    expect(starterPacksCatalog.length).toBeGreaterThan(0);
    expect(starterPacksCatalog[0].tracks.length).toBeGreaterThan(0);
  });

  it('should only accept supported starter pack ids', () => {
    expect(isStarterPackId('valentine-2026')).toBe(true);
    expect(isStarterPackId('party-pack')).toBe(false);
  });

  it('should resolve the featured release by id', () => {
    expect(getStarterPackById('valentine-2026')?.title).toBe('Valentine 2026');
  });

  it('should have valid track structure in valentine pack', () => {
    valentine2026Pack.forEach((track) => {
      expect(track.id).toBeDefined();
      expect(track.title).toBeDefined();
      expect(track.artist).toBeDefined();
      expect(track.url).toBeDefined();
      expect(track.artworkUrl).toBeDefined();
      expect(track.isStarter).toBe(true);
    });
  });
});
