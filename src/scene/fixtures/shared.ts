import * as THREE from "three";

// Shared infrastructure for fixture types. Anything cross-cutting
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

// A tunable numeric param: random rolls sample uniformly between
// min and max. The editor lets you edit min/max per param per type.
export interface ParamRange {
  min: number;
  max: number;
}
// Mutable map — editor writes to this at runtime; loader merges
// JSON overrides at boot. Each type owns its own ranges record and
// exposes it via FixtureType.ranges so the editor can introspect.
export type ParamRanges = Record<string, ParamRange>;

export function randomInRange(rng: () => number, r: ParamRange): number {
  return r.min + rng() * (r.max - r.min);
}

export interface FixtureType<Params = unknown> {
  readonly name: string;
  // Mutable ranges record. specFor reads from this (so editor edits
  // take effect on the next call); loader merges JSON overrides into
  // it at boot.
  readonly ranges: ParamRanges;
  specFor(seeds: VariationSeeds): Params;
  build(params: Params, colorHex: number): BuiltFixture;
  describe(params: Params): string;
}

export interface VariationSeeds {
  readonly kindSeed: number;
  readonly sectionSeed: number;
  readonly phraseBlockSeed: number;
}

export interface BuiltFixture {
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

export const FIXTURE_BASE_STRENGTH = 0.9;
export const FIXTURE_PULSE_PEAK = 2.6;

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
      return FIXTURE_BASE_STRENGTH;
    case "beat":
      return (
        FIXTURE_BASE_STRENGTH +
        pulseCurve(beatPhase, 6) * FIXTURE_PULSE_PEAK
      );
    case "bar":
      return (
        FIXTURE_BASE_STRENGTH +
        pulseCurve(barPhase, 4) * FIXTURE_PULSE_PEAK
      );
    case "phrase":
      return (
        FIXTURE_BASE_STRENGTH +
        pulseCurve(phrasePhase, 2) * FIXTURE_PULSE_PEAK
      );
    case "alt-bar": {
      // Two-bar cadence: full peak on bar 1, dimmer on bar 2.
      const peak =
        phrasePhase < 0.5
          ? pulseCurve(barPhase, 4)
          : pulseCurve(barPhase, 4) * 0.3;
      return FIXTURE_BASE_STRENGTH + peak * FIXTURE_PULSE_PEAK;
    }
  }
}
