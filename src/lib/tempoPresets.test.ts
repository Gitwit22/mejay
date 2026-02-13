import { describe, it, expect } from 'vitest';
import {
  TEMPO_PRESET_RATIOS,
  TEMPO_PRESET_LABEL,
  TEMPO_PRESET_OPTIONS,
  normalizeTempoPreset,
  computePresetTempo,
  type TempoPreset,
} from './tempoPresets';

describe('tempoPresets', () => {
  it('should have tempo preset ratios', () => {
    expect(TEMPO_PRESET_RATIOS.original).toBe(1.0);
    expect(TEMPO_PRESET_RATIOS.chill).toBeLessThan(1.0);
    expect(TEMPO_PRESET_RATIOS.upbeat).toBeGreaterThan(1.0);
    expect(TEMPO_PRESET_RATIOS.club).toBeGreaterThan(1.0);
    expect(TEMPO_PRESET_RATIOS.fast).toBeLessThan(1.0);
  });

  it('should have valid preset labels', () => {
    Object.values(TEMPO_PRESET_LABEL).forEach(label => {
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    });
  });

  it('should have preset options array', () => {
    expect(Array.isArray(TEMPO_PRESET_OPTIONS)).toBe(true);
    expect(TEMPO_PRESET_OPTIONS.length).toBeGreaterThan(0);
    TEMPO_PRESET_OPTIONS.forEach(opt => {
      expect(opt.key).toBeDefined();
      expect(opt.shortLabel).toBeDefined();
    });
  });

  it('should normalize valid tempo presets', () => {
    expect(normalizeTempoPreset('original')).toBe('original');
    expect(normalizeTempoPreset('chill')).toBe('chill');
    expect(normalizeTempoPreset('upbeat')).toBe('upbeat');
    expect(normalizeTempoPreset('club')).toBe('club');
    expect(normalizeTempoPreset('fast')).toBe('fast');
  });

  it('should return fallback for invalid presets', () => {
    expect(normalizeTempoPreset('invalid')).toBe('original');
    expect(normalizeTempoPreset('invalid', 'chill')).toBe('chill');
  });

  it('should compute preset tempo for original', () => {
    const result = computePresetTempo(120, 'original');
    expect(result.ratio).toBe(1);
    expect(result.targetBpm).toBe(120);
  });

  it('should compute preset tempo for chill', () => {
    const result = computePresetTempo(120, 'chill');
    expect(result.ratio).toBeLessThan(1);
    expect(result.targetBpm).toBeLessThan(120);
  });

  it('should handle undefined BPM', () => {
    const result = computePresetTempo(undefined, 'upbeat');
    expect(result.ratio).toBe(1);
    expect(result.targetBpm).toBeNull();
  });
});
