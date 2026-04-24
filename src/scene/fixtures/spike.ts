import * as THREE from "three";
import { BEATS_PER_STRAIGHT, TUNNEL_DEPTH, CELL } from "../../constants";
import { mulberry32 } from "../../chart";
import type {
  BuiltFixture,
  FixtureType,
  ParamRanges,
  PulsePattern,
  VariationSeeds,
} from "./shared";
import {
  FIXTURE_BASE_STRENGTH,
  PULSES,
  pickFrom,
  randomInRange,
} from "./shared";

// Spike fixtures: pyramidal cones scattered across corridor
// surfaces (walls/floor/ceiling), pointing inward toward the corridor
// centerline. Length and spawn mask come from a cheap 3D value noise
// evaluated at each candidate's world position — nearby spikes share
// similar lengths, so they cluster into natural "thickets" instead of
// looking like a uniform field of posts.
//
// Uses THREE.InstancedMesh (per-instance Matrix4) because every spike
// has a unique position, orientation, and scale — merging N unique
// geometries would waste memory with no draw-call benefit.

type Surface = "left" | "right" | "floor" | "ceiling";
// Spikes cover all four surfaces at once — no section-level surface
// pick. Count is spikes-per-beat-per-surface before the threshold
// mask; accepted ~50% of candidates make it past the mask.
type Density = 100 | 200 | 400;

interface SpikeParams {
  density: Density;
  // Noise value below this → spike doesn't spawn. Higher values give
  // sparser thickets.
  threshold: number;
  // World-units per noise feature. Low = high-frequency (each spike
  // different from its neighbor); high = low-frequency (smooth length
  // ramps across a region).
  noiseScale: number;
  noiseSeed: number;
  pulse: PulsePattern;
  // Max length a spike reaches when noise=1, in world units. Hollow
  // is 1 unit wide, so baseLength ~0.3 puts tips ~60% of the way to
  // the center at peak.
  baseLength: number;
  // Cone base radius relative to length. Higher = stubbier spikes.
  radiusRatio: number;
}

const ALL_SURFACES: readonly Surface[] = ["left", "right", "floor", "ceiling"];
const DENSITIES: readonly Density[] = [100, 200, 400];

// Editable numeric ranges. Mutable so the editor / JSON loader can
// override at runtime; specFor below reads through this record.
// noiseSeed stays non-tunable (it's an integer hash salt, not an
// aesthetic knob); density and pulse are union picks.
const ranges: ParamRanges = {
  baseLength: { min: 0.18, max: 0.36 },
  radiusRatio: { min: 0.15, max: 0.4 },
  threshold: { min: 0.35, max: 0.65 },
  noiseScale: { min: 1, max: 4 },
};

// Surface positions (hollow extent = ±0.5). Candidates are offset
// slightly inward along the perpendicular (t ∈ [-0.45, 0.45]) so they
// don't hug the corners.
const SURFACE_COORD = 0.5;
const PERP_EXTENT = 0.45;

// Pyramidal cones — 4 radial segments = low-poly angular look,
// matches the cube/tetra aesthetic of cateye. Proto height of 0.1
// gives a clean 1× scale factor at the default length.
const CONE_RADIAL_SEGMENTS = 4;
const PROTO_HEIGHT = 0.1;

// Cheap 3D value noise. hash3 returns a 32-bit uint folded to float
// 0..1. Trilinear interpolation over the integer grid smooths the
// output enough for "clustered spike lengths" without needing
// Perlin's gradient table.
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (x | 0) ^ seed;
  h = Math.imul(h ^ (y | 0), 0x85ebca6b);
  h = Math.imul(h ^ (z | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise3D(
  x: number,
  y: number,
  z: number,
  seed: number,
): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = smoothstep(x - xi);
  const yf = smoothstep(y - yi);
  const zf = smoothstep(z - zi);
  const c000 = hash3(xi,     yi,     zi,     seed);
  const c100 = hash3(xi + 1, yi,     zi,     seed);
  const c010 = hash3(xi,     yi + 1, zi,     seed);
  const c110 = hash3(xi + 1, yi + 1, zi,     seed);
  const c001 = hash3(xi,     yi,     zi + 1, seed);
  const c101 = hash3(xi + 1, yi,     zi + 1, seed);
  const c011 = hash3(xi,     yi + 1, zi + 1, seed);
  const c111 = hash3(xi + 1, yi + 1, zi + 1, seed);
  const a = c000 + xf * (c100 - c000);
  const b = c010 + xf * (c110 - c010);
  const c = c001 + xf * (c101 - c001);
  const d = c011 + xf * (c111 - c011);
  const e = a + yf * (b - a);
  const f = c + yf * (d - c);
  return e + zf * (f - e);
}

interface Candidate {
  pos: THREE.Vector3;
  direction: THREE.Vector3;
}

// Position + inward direction for each candidate on a surface. `t` is
// the position along the perpendicular axis; `z` is depth along the
// straight. Both come from the sample rng so the placement is
// deterministic from noiseSeed.
function candidate(
  surface: Surface,
  t: number,
  z: number,
): Candidate {
  switch (surface) {
    case "left":
      return {
        pos: new THREE.Vector3(-SURFACE_COORD, t, z),
        direction: new THREE.Vector3(1, 0, 0),
      };
    case "right":
      return {
        pos: new THREE.Vector3(SURFACE_COORD, t, z),
        direction: new THREE.Vector3(-1, 0, 0),
      };
    case "floor":
      return {
        pos: new THREE.Vector3(t, -SURFACE_COORD, z),
        direction: new THREE.Vector3(0, 1, 0),
      };
    case "ceiling":
      return {
        pos: new THREE.Vector3(t, SURFACE_COORD, z),
        direction: new THREE.Vector3(0, -1, 0),
      };
  }
}

export const spike: FixtureType<SpikeParams> = {
  name: "spike",
  ranges,

  specFor({
    kindSeed,
    sectionSeed,
    phraseBlockSeed,
  }: VariationSeeds): SpikeParams {
    const rngKind = mulberry32(kindSeed);
    const pulse = pickFrom(PULSES, rngKind);
    const baseLength = randomInRange(rngKind, ranges.baseLength!);
    const radiusRatio = randomInRange(rngKind, ranges.radiusRatio!);

    const rngSection = mulberry32(sectionSeed);
    const density = pickFrom(DENSITIES, rngSection);

    const rngPhrase = mulberry32(phraseBlockSeed);
    const threshold = randomInRange(rngPhrase, ranges.threshold!);
    const noiseScale = randomInRange(rngPhrase, ranges.noiseScale!);
    const noiseSeed = Math.floor(rngPhrase() * 0x7fffffff);

    return {
      density,
      threshold,
      noiseScale,
      noiseSeed,
      pulse,
      baseLength,
      radiusRatio,
    };
  },

  build(params: SpikeParams, colorHex: number): BuiltFixture {
    const straightLen = TUNNEL_DEPTH * CELL;
    const candidatesPerSurface = BEATS_PER_STRAIGHT * params.density;

    // Seeded sampling so placements are stable across frames / reloads.
    // noiseSeed doubles as both the sampling seed and the noise hash
    // salt — one source of randomness per spike set.
    const sampleRng = mulberry32(params.noiseSeed);

    // Gather candidates → evaluate noise → keep accepted ones with
    // their length and orientation baked into a Matrix4. Using scratch
    // objects outside the loop to avoid per-candidate allocations.
    const accepted: THREE.Matrix4[] = [];
    const tempQuat = new THREE.Quaternion();
    const tempScale = new THREE.Vector3();
    const upY = new THREE.Vector3(0, 1, 0);

    for (const surface of ALL_SURFACES) {
      for (let i = 0; i < candidatesPerSurface; i++) {
        const t = (sampleRng() * 2 - 1) * PERP_EXTENT;
        const z = -sampleRng() * straightLen;
        const c = candidate(surface, t, z);

        const n = valueNoise3D(
          c.pos.x / params.noiseScale,
          c.pos.y / params.noiseScale,
          c.pos.z / params.noiseScale,
          params.noiseSeed,
        );
        if (n < params.threshold) continue;

        // Remap noise (threshold..1) → (0..1) so accepted spikes span
        // the full length range — otherwise the shortest accepted
        // spike still has length threshold×baseLength, looking clipped.
        const remapped = (n - params.threshold) / (1 - params.threshold);
        const length = 0.04 + remapped * params.baseLength;

        // Rotate the cone's +Y axis onto the inward direction.
        tempQuat.setFromUnitVectors(upY, c.direction);
        // Scale Y to match target length. PROTO_HEIGHT = 0.1 so the
        // Y-scale factor is length / 0.1. X/Z stay 1 — radius is
        // fixed per-set (params.radiusRatio), not per-spike.
        tempScale.set(1, length / PROTO_HEIGHT, 1);

        accepted.push(
          new THREE.Matrix4().compose(c.pos, tempQuat, tempScale),
        );
      }
    }

    // Prototype cone. Base at origin, tip at +Y — so the instance
    // matrix anchors rotation at the surface (spike extends from wall
    // toward center, not through it).
    const protoRadius = PROTO_HEIGHT * params.radiusRatio;
    const geometry = new THREE.ConeGeometry(
      protoRadius,
      PROTO_HEIGHT,
      CONE_RADIAL_SEGMENTS,
    );
    geometry.translate(0, PROTO_HEIGHT * 0.5, 0);

    const material = new THREE.MeshBasicMaterial({ color: colorHex });
    material.color.multiplyScalar(FIXTURE_BASE_STRENGTH);

    // InstancedMesh with count=0 is valid (renders nothing) but still
    // holds its geometry + material. Acceptable edge case when a kind
    // lands a threshold high enough to reject every candidate.
    const mesh = new THREE.InstancedMesh(geometry, material, accepted.length);
    for (let i = 0; i < accepted.length; i++) {
      mesh.setMatrixAt(i, accepted[i] as THREE.Matrix4);
    }
    mesh.instanceMatrix.needsUpdate = true;

    return {
      object: mesh,
      material,
      baseHex: colorHex,
      pulse: params.pulse,
    };
  },

  describe(params: SpikeParams): string {
    return (
      `spike[density=${params.density} ` +
      `threshold=${params.threshold.toFixed(2)} ` +
      `noiseScale=${params.noiseScale.toFixed(1)} ` +
      `pulse=${params.pulse} length=${params.baseLength.toFixed(2)} ` +
      `radius=${params.radiusRatio.toFixed(2)}]`
    );
  },
};
