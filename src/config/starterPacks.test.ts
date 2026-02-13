import { describe, it, expect } from 'vitest';
import { valentine2026Pack, partyPack, type StarterTrack } from './starterPacks';

describe('starterPacks', () => {
  it('should have Valentine 2026 pack tracks', () => {
    expect(Array.isArray(valentine2026Pack)).toBe(true);
    expect(valentine2026Pack.length).toBeGreaterThan(0);
    expect(valentine2026Pack[0].isStarter).toBe(true);
  });

  it('should have Party Pack tracks', () => {
    expect(Array.isArray(partyPack)).toBe(true);
    expect(partyPack.length).toBeGreaterThan(0);
    expect(partyPack[0].isStarter).toBe(true);
  });

  it('should have valid track structure in valentine pack', () => {
    valentine2026Pack.forEach(track => {
      expect(track.id).toBeDefined();
      expect(track.title).toBeDefined();
      expect(track.artist).toBeDefined();
      expect(track.url).toBeDefined();
      expect(track.isStarter).toBe(true);
    });
  });

  it('should have valid track structure in party pack', () => {
    partyPack.forEach(track => {
      expect(track.id).toBeDefined();
      expect(track.title).toBeDefined();
      expect(track.artist).toBeDefined();
      expect(track.url).toBeDefined();
      expect(track.isStarter).toBe(true);
    });
  });
});
