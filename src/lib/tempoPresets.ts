export type TempoPreset =
  | 'original'
  | 'chill'
  | 'upbeat'
  | 'club'
  | 'fast'

export const TEMPO_PRESET_BPM: Record<TempoPreset, number | null> = {
  original: null,
  chill: 95,
  // Upbeat now takes the old "Normal" speed.
  upbeat: 115,
  // Club now takes the old "Upbeat" speed.
  club: 128,
  fast: 145,
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

export function getTempoPresetTargetBpm(preset: TempoPreset): number | null {
  return TEMPO_PRESET_BPM[preset] ?? TEMPO_PRESET_BPM.upbeat
}

export function getTempoPresetLabel(preset: TempoPreset): string {
  return TEMPO_PRESET_LABEL[preset] ?? TEMPO_PRESET_LABEL.upbeat
}
