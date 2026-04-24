// Per-audio-section color. Shared across every visual element that
// needs to key off the current section's identity — tunnel edges,
// delineators, and anything added later (gate fill tints? marker
// accents?). Centralizing here keeps the look coherent: when one
// kind's color changes here, every element that consumes it shifts
// together.
//
// Each unique SongAnalysis section-kind index maps to a palette entry
// via modulo. Kinds past the palette length cycle; that's fine — a
// song with 7+ kinds is extremely rare and the repeat reads as
// "musically similar," which is roughly what the kind detector is
// catching anyway.
//
// Hues tuned for HDR bloom: pure primaries bloom hardest, mid-
// saturation keeps the tunnel readable between flashes. Chosen to
// stay inside the Tron-Recognizer aesthetic (plan §5) — no neutrals,
// no muddy earth tones. Violet sits near the bloom threshold at
// DELINEATOR_PULSE_PEAK by design: it's the one "quiet" hue so
// violet-kind straights feel softer than coral/amber ones.

export const SECTION_PALETTE: readonly number[] = [
  0x00aaff, // cyan — matches COLOR_EDGE, so kind 0 keeps the baseline look
  0xff66cc, // pink
  0xffaa22, // amber
  0x44ddaa, // teal-green
  0xaa66ff, // violet
  0xff6644, // coral
];

export const DEFAULT_SECTION_COLOR = SECTION_PALETTE[0] as number;

// Returns the canonical color for a section kind. `null` = no audio
// analysis landed yet (boot lookahead), falls through to the default.
export function colorForKind(kind: number | null): number {
  if (kind === null) return DEFAULT_SECTION_COLOR;
  const len = SECTION_PALETTE.length;
  // JS % can go negative for negative kinds; clamp via double-mod.
  const idx = ((kind % len) + len) % len;
  return SECTION_PALETTE[idx] as number;
}
