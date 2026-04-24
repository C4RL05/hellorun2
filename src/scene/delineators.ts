import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BEATS_PER_STRAIGHT, TUNNEL_DEPTH, CELL } from "../constants";
import { mulberry32 } from "../chart";

// Minimum emissive level even for steady delineators. Dim enough that
// the cat's-eye reads as "unlit" at rest on saturated primaries — base
// color × 0.9 stays under the bloom threshold for most hues, so they
// only really glow when the pulse kicks in.
const DELINEATOR_BASE_STRENGTH = 0.9;
// Extra strength added at the peak of a pulse. Base + peak ≈ 3.5× at
// the flash, well above bloom threshold.
const DELINEATOR_PULSE_PEAK = 2.6;

// Delineators: cat's-eye-style reflectors lining the corridor. Purely
// visual — no collision, no effect on gameplay. Their one job is to
// make the tunnel read as a road and sell the beat: each straight's
// delineators pulse on some musical boundary (beat/bar/phrase) so the
// player sees the music flowing past them.
//
// Variation cadence (user spec):
//   - completely different per audio-section kind
//       → shape, pulse pattern, color
//   - more different on section change (cumulative section index)
//       → layout, density
//   - slightly different every 2 phrases
//       → size scale + yaw offset
//
// Everything is deterministic from (kind, sectionIndex, phraseIndex)
// via mulberry32, so a given song always produces the same
// delineators for the same pathS.

type Shape = "cube" | "tetra" | "capsule";
type Layout =
  | "left"
  | "right"
  | "alternating"
  | "both-sides"
  | "triple-both"
  | "floor"
  | "ceiling"
  | "floor-ceiling"
  | "corner-spiral";
type Pulse = "steady" | "beat" | "bar" | "phrase" | "alt-bar";
type Density = 1 | 2 | 4;

export interface DelineatorSpec {
  shape: Shape;
  layout: Layout;
  density: Density;
  pulse: Pulse;
  colorHex: number;
  sizeScale: number;
  rotationOffset: number; // radians, yaw applied to every instance
}

const SHAPES: readonly Shape[] = ["cube", "tetra", "capsule"];
const LAYOUTS: readonly Layout[] = [
  "left",
  "right",
  "alternating",
  "both-sides",
  "triple-both",
  "floor",
  "ceiling",
  "floor-ceiling",
  "corner-spiral",
];
const PULSES: readonly Pulse[] = [
  "steady",
  "beat",
  "bar",
  "phrase",
  "alt-bar",
];
const DENSITIES: readonly Density[] = [1, 2, 4];

// Distinct from SECTION_EDGE_PALETTE so delineators don't blend into
// the wall edges — pure-channel primaries bloom hardest.
const DELINEATOR_COLORS: readonly number[] = [
  0x00ffff, // cyan
  0xff44aa, // hot pink
  0xffaa22, // amber
  0x66ff66, // lime
  0xaa66ff, // violet
  0xff6644, // coral
];

function pickFrom<T>(arr: readonly T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)] as T;
}

// Generate a spec from the 3 variation axes. Hash seeds are constants
// so two calls with identical inputs are bit-identical.
export function specForDelineators(
  kind: number | null,
  sectionIndex: number,
  phraseIndex: number,
): DelineatorSpec {
  const k = kind ?? -1;
  const kindSeed = (k + 1) * 131 + 7;
  const sectionSeed = kindSeed * 17 + sectionIndex * 73;
  const phraseBlockSeed =
    sectionSeed * 11 + Math.floor(phraseIndex / 2) * 97;

  // Kind-level: stays constant for the whole kind. Shape, pulse, color.
  const rngKind = mulberry32(kindSeed);
  const shape = pickFrom(SHAPES, rngKind);
  const pulse = pickFrom(PULSES, rngKind);
  const colorHex =
    DELINEATOR_COLORS[
      Math.floor(rngKind() * DELINEATOR_COLORS.length)
    ] as number;

  // Section-level: changes per audio-section boundary within a kind.
  // Layout + density.
  const rngSection = mulberry32(sectionSeed);
  const layout = pickFrom(LAYOUTS, rngSection);
  const density = pickFrom(DENSITIES, rngSection);

  // Phrase-block-level: changes every 2 phrases. Size + yaw jitter
  // so the delineators nudge without breaking the look.
  const rngPhrase = mulberry32(phraseBlockSeed);
  const sizeScale = 0.7 + rngPhrase() * 0.6; // 0.7–1.3
  const rotationOffset = rngPhrase() * Math.PI * 2;

  return {
    shape,
    layout,
    density,
    pulse,
    colorHex,
    sizeScale,
    rotationOffset,
  };
}

// Offsets just inside the hollow surface so delineators hug the wall
// without z-fighting the tunnel fill. Hollow is 1 unit wide/tall, so
// ±0.47 places the center 0.03 in from the wall surface — enough
// clearance for small delineators to sit flush without embedding.
const HALF_W = 0.47;
const HALF_H = 0.47;
const INNER_ROW_Y = 0.25; // vertical spacing for triple-both stacks
const FLOOR_ROW_X = 0.28; // lateral spacing for floor/ceiling rows

// Base edge length for the delineator shape. Small enough (~1/15th
// of hollow width) to read as a cat's-eye marker, not a structural
// element. sizeScale modulates this per phrase block.
const BASE_SIZE = 0.07;

function baseShapeGeometry(shape: Shape, size: number): THREE.BufferGeometry {
  switch (shape) {
    case "cube":
      return new THREE.BoxGeometry(size, size, size);
    case "tetra":
      return new THREE.TetrahedronGeometry(size * 0.7);
    case "capsule":
      // Capsule axis: default Y (tall). Length along Y so it reads as
      // a standing post when placed on the wall.
      return new THREE.CapsuleGeometry(size * 0.28, size * 1.1, 3, 6);
  }
}

interface Placement {
  x: number;
  y: number;
  z: number;
}

// Produces the per-delineator position set for a full straight.
// `count` is the total instances the layout wants along Z; each Z
// slot may return 1+ placements (e.g. both-sides returns 2).
function placementsForLayout(layout: Layout, count: number): Placement[] {
  const out: Placement[] = [];
  const straightLen = TUNNEL_DEPTH * CELL;
  const dz = straightLen / count;

  for (let i = 0; i < count; i++) {
    const z = -(i + 0.5) * dz;

    switch (layout) {
      case "left":
        out.push({ x: -HALF_W, y: 0, z });
        break;
      case "right":
        out.push({ x: HALF_W, y: 0, z });
        break;
      case "alternating":
        out.push({ x: i % 2 === 0 ? -HALF_W : HALF_W, y: 0, z });
        break;
      case "both-sides":
        out.push({ x: -HALF_W, y: 0, z });
        out.push({ x: HALF_W, y: 0, z });
        break;
      case "triple-both":
        for (const side of [-HALF_W, HALF_W]) {
          for (const y of [-INNER_ROW_Y, 0, INNER_ROW_Y]) {
            out.push({ x: side, y, z });
          }
        }
        break;
      case "floor":
        for (const x of [-FLOOR_ROW_X, 0, FLOOR_ROW_X]) {
          out.push({ x, y: -HALF_H, z });
        }
        break;
      case "ceiling":
        for (const x of [-FLOOR_ROW_X, 0, FLOOR_ROW_X]) {
          out.push({ x, y: HALF_H, z });
        }
        break;
      case "floor-ceiling":
        for (const x of [-FLOOR_ROW_X, 0, FLOOR_ROW_X]) {
          out.push({ x, y: -HALF_H, z });
          out.push({ x, y: HALF_H, z });
        }
        break;
      case "corner-spiral": {
        const corners: readonly [number, number][] = [
          [-HALF_W, -HALF_H],
          [HALF_W, -HALF_H],
          [HALF_W, HALF_H],
          [-HALF_W, HALF_H],
        ];
        const [cx, cy] = corners[i % 4] as readonly [number, number];
        out.push({ x: cx, y: cy, z });
        break;
      }
    }
  }
  return out;
}

export interface DelineatorSet {
  object: THREE.Object3D;
  material: THREE.MeshBasicMaterial;
  baseHex: number;
  pulse: Pulse;
}

// Builds one delineator set for a straight. Geometry is merged so the
// entire straight's delineators are one draw call. Material is
// MeshBasicMaterial (unlit) — we rely on the HDR bloom chain to make
// them glow. Emissive modulation happens per-frame via the registry.
export function createDelineatorSet(spec: DelineatorSpec): DelineatorSet {
  const countAlongZ = BEATS_PER_STRAIGHT * spec.density;
  const baseSize = BASE_SIZE * spec.sizeScale;

  const proto = baseShapeGeometry(spec.shape, baseSize);
  const rotation = new THREE.Matrix4().makeRotationY(spec.rotationOffset);
  proto.applyMatrix4(rotation);

  const placements = placementsForLayout(spec.layout, countAlongZ);
  const pieces: THREE.BufferGeometry[] = [];
  const placementMatrix = new THREE.Matrix4();
  for (const p of placements) {
    placementMatrix.makeTranslation(p.x, p.y, p.z);
    pieces.push(proto.clone().applyMatrix4(placementMatrix));
  }
  proto.dispose();

  const merged = mergeGeometries(pieces, false);
  for (const g of pieces) g.dispose();
  if (!merged) throw new Error("Failed to merge delineator geometry");

  const material = new THREE.MeshBasicMaterial({ color: spec.colorHex });
  // HDR baseline: push into the bloom range. Per-frame pulse re-derives
  // from baseHex so we never compound float drift.
  material.color.multiplyScalar(DELINEATOR_BASE_STRENGTH);

  const mesh = new THREE.Mesh(merged, material);
  return {
    object: mesh,
    material,
    baseHex: spec.colorHex,
    pulse: spec.pulse,
  };
}

// Registry of currently-live delineator sets. updateDelineatorPulses
// walks this list per-frame. Cleared on corridor teardown (beat sync,
// game reset).
const registry: DelineatorSet[] = [];

export function registerDelineatorSet(set: DelineatorSet): void {
  registry.push(set);
}

export function clearDelineatorRegistry(): void {
  registry.length = 0;
}

// Exponential-decay "blink": peak at phase 0, decays across the window.
// `rate` = decay coefficient; higher = faster drop to zero. Beat-scale
// windows use a higher rate so the flash is crisp; phrase-scale
// windows use a lower rate so the afterglow covers more of the cycle.
function pulseCurve(phase: number, rate: number): number {
  return Math.exp(-rate * phase);
}

// Call once per frame with the three musical phases (beat/bar/phrase
// each normalized to [0,1)). main.ts derives them from pathS.
export function updateDelineatorPulses(
  beatPhase: number,
  barPhase: number,
  phrasePhase: number,
): void {
  for (const set of registry) {
    let pulse: number;
    switch (set.pulse) {
      case "steady":
        pulse = 0;
        break;
      case "beat":
        pulse = pulseCurve(beatPhase, 6);
        break;
      case "bar":
        pulse = pulseCurve(barPhase, 4);
        break;
      case "phrase":
        pulse = pulseCurve(phrasePhase, 2);
        break;
      case "alt-bar":
        // Two-bar cadence: full peak on bar 1, dimmer on bar 2.
        pulse =
          phrasePhase < 0.5
            ? pulseCurve(barPhase, 4)
            : pulseCurve(barPhase, 4) * 0.3;
        break;
    }
    const strength = DELINEATOR_BASE_STRENGTH + pulse * DELINEATOR_PULSE_PEAK;
    set.material.color.setHex(set.baseHex);
    set.material.color.multiplyScalar(strength);
  }
}

// Convenience: derive the phraseIndex to feed into specForDelineators
// from a straight's world-space pathStart. PHRASE_LENGTH isn't
// imported here directly to avoid a circular dep with constants;
// callers import it and compute.
export function phraseIndexForPathStart(
  pathStart: number,
  phraseLength: number,
): number {
  return Math.floor(pathStart / phraseLength);
}

// Baseline used so tests / the post panel can read consistent
// min/peak values without recomputing.
export const DELINEATOR_BASELINES = {
  base: DELINEATOR_BASE_STRENGTH,
  peak: DELINEATOR_PULSE_PEAK,
};
