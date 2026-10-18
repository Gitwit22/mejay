const DEFAULT_ACCENT = '#10b981'

/** The artist's accent colour, or MeJay emerald when unset or malformed. */
export function artistAccent(value: string | null | undefined): string {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : DEFAULT_ACCENT
}

/** Black or white text, whichever reads better on the accent colour (WCAG relative luminance). */
export function accentForeground(hex: string): string {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  return luminance > 0.179 ? '#0a0a0b' : '#ffffff'
}
