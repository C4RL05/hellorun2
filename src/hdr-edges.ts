import type { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { DEFAULT_POST_SETTINGS } from "./post-settings";

// HDR edge material registry.
//
// Every edge LineMaterial in the scene gets `color = baseHex × strength`
// applied at creation and whenever the post-settings strength changes.
// Storing the baseHex on the material (userData) lets us re-derive color
// on live updates without remembering the sequence of palette recolors
// each material has been through — the current color is always
// base × strength, so we only need the base.
//
// Why not a custom ShaderMaterial with an `uEmissive` uniform? Rewriting
// the LineSegments2 shader is a larger blast radius; this keeps init
// identical to the original path (setHex + multiplyScalar) and makes
// the strength knob a registry walk instead of a per-draw uniform.

let currentStrength = DEFAULT_POST_SETTINGS.edgeEmissiveStrength;
const registry = new Set<LineMaterial>();

interface HdrEdgeUserData {
  hdrBaseHex?: number;
}

// Set-and-scale helper. Use at every site that would have previously
// done `mat.color.setHex(hex); mat.color.multiplyScalar(STRENGTH)`. The
// first call also registers the material so future strength changes
// reach it.
export function setHdrEdgeColor(mat: LineMaterial, hex: number): void {
  (mat.userData as HdrEdgeUserData).hdrBaseHex = hex;
  mat.color.setHex(hex);
  mat.color.multiplyScalar(currentStrength);
  registry.add(mat);
}

// Live-update all registered materials to a new emissive strength.
// Called by the Post settings panel.
export function setEdgeEmissiveStrength(strength: number): void {
  currentStrength = strength;
  for (const mat of registry) {
    const base = (mat.userData as HdrEdgeUserData).hdrBaseHex;
    if (base === undefined) continue;
    mat.color.setHex(base);
    mat.color.multiplyScalar(strength);
  }
}

export function getEdgeEmissiveStrength(): number {
  return currentStrength;
}
