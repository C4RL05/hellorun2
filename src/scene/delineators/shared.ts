import * as THREE from "three";

// Shared infrastructure for delineator types. Anything cross-cutting
// (interfaces, pose table, pulse math) lives here; type-specific
// geometry stays in each type's own file so types can be added,
// removed, or modified independently.

export type PulsePattern = "steady" | "beat" | "bar" | "phrase" | "alt-bar";
export const PULSES: readonly PulsePattern[] = [
  "steady",
  "beat",
  "bar",
  "phrase",
  "alt-bar",
];

export interface DelineatorType<Params = unknown> {
  readonly name: string;
  specFor(seeds: VariationSeeds): Params;
  build(params: Params, colorHex: number): BuiltDelineators;
  describe(params: Params): string;
}

export interface VariationSeeds {
  readonly kindSeed: number;
  readonly sectionSeed: number;
  readonly phraseBlockSeed: number;
}

export interface BuiltDelineators {
  object: THREE.Object3D;
  material: THREE.MeshBasicMaterial;
  baseHex: number;
  pulse: PulsePattern;
}

export function pickFrom<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

// Single-axis Euler (x, y, z) in radians. 90° entries weighted 70%,
// 45° diagonals 30% — "most rotations in 90°, less in 45°". Shape-
// agnostic: cubes read clean at 45° diagonal (diamond), capsules flip
// between vertical / lateral / forward, tetras look intentional at
// any pose.
const POSES_ALIGNED: ReadonlyArray<[number, number, number]> = [
  [0, 0, 0],
  [0, Math.PI / 2, 0],
  [Math.PI / 2, 0, 0],
  [0, 0, Math.PI / 2],
];
const POSES_DIAGONAL: ReadonlyArray<[number, number, number]> = [
  [0, Math.PI / 4, 0],
  [Math.PI / 4, 0, 0],
  [0, 0, Math.PI / 4],
];
export function pickRotation(rng: () => number): [number, number, number] {
  const useDiag = rng() >= 0.7;
  const table = useDiag ? POSES_DIAGONAL : POSES_ALIGNED;
  return table[Math.floor(rng() * table.length)] as [number, number, number];
}

export const DELINEATOR_BASE_STRENGTH = 0.9;
export const DELINEATOR_PULSE_PEAK = 2.6;

// `rate` scales inversely with window length so beat/bar/phrase
// pulses all have proportionally similar afterglow — beat ~6 reads
// as a crisp flash, phrase ~2 as a sustained glow.
function pulseCurve(phase: number, rate: number): number {
  return Math.exp(-rate * phase);
}

export function pulseIntensity(
  pulse: PulsePattern,
  beatPhase: number,
  barPhase: number,
  phrasePhase: number,
): number {
  switch (pulse) {
    case "steady":
      return DELINEATOR_BASE_STRENGTH;
    case "beat":
      return (
        DELINEATOR_BASE_STRENGTH +
        pulseCurve(beatPhase, 6) * DELINEATOR_PULSE_PEAK
      );
    case "bar":
      return (
        DELINEATOR_BASE_STRENGTH +
        pulseCurve(barPhase, 4) * DELINEATOR_PULSE_PEAK
      );
    case "phrase":
      return (
        DELINEATOR_BASE_STRENGTH +
        pulseCurve(phrasePhase, 2) * DELINEATOR_PULSE_PEAK
      );
    case "alt-bar": {
      // Two-bar cadence: full peak on bar 1, dimmer on bar 2.
      const peak =
        phrasePhase < 0.5
          ? pulseCurve(barPhase, 4)
          : pulseCurve(barPhase, 4) * 0.3;
      return DELINEATOR_BASE_STRENGTH + peak * DELINEATOR_PULSE_PEAK;
    }
  }
}
