import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { BEATS_PER_STRAIGHT, TUNNEL_DEPTH, CELL } from "../../constants";
import { mulberry32 } from "../../chart";
import type {
  BuiltDelineators,
  DelineatorType,
  PulsePattern,
  VariationSeeds,
} from "./shared";
import {
  DELINEATOR_BASE_STRENGTH,
  PULSES,
  pickFrom,
  pickRotation,
} from "./shared";

// Cat's-eye delineators: small emissive markers (cubes, tetras, or
// capsules) placed along the corridor in one of 9 layouts. Purely
// visual. Geometry is merged so one type = one draw call per straight.

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
type Density = 1 | 2 | 4;

interface CateyeParams {
  shape: Shape;
  layout: Layout;
  density: Density;
  pulse: PulsePattern;
  sizeScale: number;
  rotation: [number, number, number];
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
const DENSITIES: readonly Density[] = [1, 2, 4];

// Hollow is 1 unit wide/tall; ±0.47 sits 0.03 in from the wall so
// markers don't z-fight the tunnel fill.
const HALF_W = 0.47;
const HALF_H = 0.47;
const INNER_ROW_Y = 0.25;
const FLOOR_ROW_X = 0.28;
const BASE_SIZE = 0.07;

function baseShapeGeometry(shape: Shape, size: number): THREE.BufferGeometry {
  switch (shape) {
    case "cube":
      return new THREE.BoxGeometry(size, size, size);
    case "tetra":
      return new THREE.TetrahedronGeometry(size * 0.7);
    case "capsule":
      return new THREE.CapsuleGeometry(size * 0.28, size * 1.1, 3, 6);
  }
}

interface Placement {
  x: number;
  y: number;
  z: number;
}

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

export const cateye: DelineatorType<CateyeParams> = {
  name: "cateye",

  specFor({ kindSeed, sectionSeed, phraseBlockSeed }: VariationSeeds): CateyeParams {
    const rngKind = mulberry32(kindSeed);
    const shape = pickFrom(SHAPES, rngKind);
    const pulse = pickFrom(PULSES, rngKind);

    const rngSection = mulberry32(sectionSeed);
    const layout = pickFrom(LAYOUTS, rngSection);
    const density = pickFrom(DENSITIES, rngSection);

    const rngPhrase = mulberry32(phraseBlockSeed);
    const sizeScale = 0.7 + rngPhrase() * 0.6; // 0.7–1.3
    const rotation = pickRotation(rngPhrase);

    return { shape, layout, density, pulse, sizeScale, rotation };
  },

  build(params: CateyeParams, colorHex: number): BuiltDelineators {
    const countAlongZ = BEATS_PER_STRAIGHT * params.density;
    const baseSize = BASE_SIZE * params.sizeScale;

    const proto = baseShapeGeometry(params.shape, baseSize);
    const rotMatrix = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(
        params.rotation[0],
        params.rotation[1],
        params.rotation[2],
      ),
    );
    proto.applyMatrix4(rotMatrix);

    const placements = placementsForLayout(params.layout, countAlongZ);
    const pieces: THREE.BufferGeometry[] = [];
    const placementMatrix = new THREE.Matrix4();
    for (const p of placements) {
      placementMatrix.makeTranslation(p.x, p.y, p.z);
      pieces.push(proto.clone().applyMatrix4(placementMatrix));
    }
    proto.dispose();

    const merged = mergeGeometries(pieces, false);
    for (const g of pieces) g.dispose();
    if (!merged) throw new Error("cateye: merge failed");

    const material = new THREE.MeshBasicMaterial({ color: colorHex });
    material.color.multiplyScalar(DELINEATOR_BASE_STRENGTH);

    const mesh = new THREE.Mesh(merged, material);
    return {
      object: mesh,
      material,
      baseHex: colorHex,
      pulse: params.pulse,
    };
  },

  describe(params: CateyeParams): string {
    const rotDeg = params.rotation.map((r) => Math.round((r * 180) / Math.PI));
    return (
      `cateye[shape=${params.shape} layout=${params.layout} ` +
      `density=${params.density} pulse=${params.pulse} ` +
      `size=${params.sizeScale.toFixed(2)} rot=[${rotDeg.join(",")}]]`
    );
  },
};
