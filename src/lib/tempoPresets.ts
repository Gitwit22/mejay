export type TempoPreset =
  | 'original'
  | 'chill'
  | 'upbeat'
  | 'club'
  | 'fast'

/**
 * Relative tempo presets: each preset is a multiplier of the track's original BPM.
 * Spectrum (slow → fast): Texas → Chill → Original → Upbeat → Club
 * - fast (Texas): ×0.75 (~25% slower) - Slowed & Screwed
 * - chill: ×0.88 (~12% slower)
 * - original: ×1.00 (no change)
 * - upbeat: ×1.08 (~8% faster)
 * - club: ×1.20 (~20% faster) - Peak energy
 */
export const TEMPO_PRESET_RATIOS: Record<TempoPreset, number> = {
  fast: 0.75,
  chill: 0.88,
  original: 1.00,
  upbeat: 1.08,
  club: 1.20,
}

/**
 * Safety caps for each preset (max stretch percentage).
 * Prevents extreme pitch shifts on tracks with unusual BPMs.
 */
export const TEMPO_PRESET_MAX_STRETCH: Record<TempoPreset, number> = {
  fast: 25,
  chill: 15,
  original: 0,
  upbeat: 12,
  club: 25,
}

export const TEMPO_PRESET_LABEL: Record<TempoPreset, string> = {
  original: 'Original',
  chill: 'Chill',
  upbeat: 'Upbeat',
  club: 'Club',
  fast: 'Texas',
}

export const TEMPO_PRESET_OPTIONS: Array<{ key: TempoPreset; shortLabel: string }> = [
  { key: 'original', shortLabel: 'Original' },
  { key: 'chill', shortLabel: 'Chill' },
  { key: 'upbeat', shortLabel: 'Upbeat' },
  { key: 'club', shortLabel: 'Club' },
  { key: 'fast', shortLabel: 'Texas' },
]

export function normalizeTempoPreset(value: unknown, fallback: TempoPreset = 'original'): TempoPreset {
  return value === 'original' ||
    value === 'chill' ||
    value === 'upbeat' ||
    value === 'club' ||
    value === 'fast'
    ? value
    : fallback
}

/**
 * Computes the target BPM and ratio for a track given a preset.
 * Returns the preset's ratio clamped to its safety cap.
 */
export function computePresetTempo(
  trackBpm: number | undefined,
  preset: TempoPreset
): { targetBpm: number | null; ratio: number } {
  if (preset === 'original' || !trackBpm) {
    return { targetBpm: trackBpm ?? null, ratio: 1 };
  }

  const targetRatio = TEMPO_PRESET_RATIOS[preset];
  const maxStretchPct = TEMPO_PRESET_MAX_STRETCH[preset];

  // Clamp to safety cap
  const minRatio = 1 - maxStretchPct / 100;
  const maxRatio = 1 + maxStretchPct / 100;
  const clampedRatio = Math.max(minRatio, Math.min(maxRatio, targetRatio));

  const targetBpm = trackBpm * clampedRatio;

  return { targetBpm, ratio: clampedRatio };
}

export function getTempoPresetLabel(preset: TempoPreset): string {
  return TEMPO_PRESET_LABEL[preset] ?? TEMPO_PRESET_LABEL.upbeat
}

/**
 * Get the display string for a preset's target (for UI).
 * For relative presets, shows the multiplier; for Original, shows "Original".
 */
export function getTempoPresetDisplayTarget(preset: TempoPreset, trackBpm?: number): string {
  if (preset === 'original') return 'Original';
  
  const result = computePresetTempo(trackBpm, preset);
  if (result.targetBpm === null) return `×${result.ratio.toFixed(2)}`;
  
  return `${Math.round(result.targetBpm)} BPM`;
}
