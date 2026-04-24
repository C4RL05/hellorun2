import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import { MARKER_EDGE_WIDTH_PX } from "../constants";
import { setHdrEdgeColor } from "../hdr-edges";

// Square border (no fill) in the local XY plane, centered at origin.
// Caller positions/rotates the result to align perpendicular to the path.
//
// Fat-line rendering via LineSegments2 so the thickness is CSS pixels
// (plain LineBasicMaterial's linewidth is hard-capped at 1px in every
// browser). depthTest: false + renderOrder: 1 so markers draw over the
// tunnel walls — phrase/section markers are larger than the 1×1 hollow
// and would otherwise be entirely occluded.

// One shared LineMaterial per color — all beat markers share a material,
// all bar markers share a material, etc. Lets `updateMarkerResolution`
// update just four materials instead of iterating every marker in the
// scene on each resize.
const sharedMaterials = new Map<number, LineMaterial>();

function getMaterial(color: number): LineMaterial {
  let mat = sharedMaterials.get(color);
  if (!mat) {
    mat = new LineMaterial({
      linewidth: MARKER_EDGE_WIDTH_PX,
      depthTest: false,
      transparent: true,
    });
    // HDR: musical-structure markers bloom hardest — pure-channel
    // primaries hit luminance > 1.0 at strength 2.5.
    setHdrEdgeColor(mat, color);
    sharedMaterials.set(color, mat);
  }
  return mat;
}

export function createMarker(size: number, color: number): LineSegments2 {
  const h = size * 0.5;
  // Four segments (bottom → right → top → left), expressed as 8 points.
  const positions = [
    -h, -h, 0,   h, -h, 0,
     h, -h, 0,   h,  h, 0,
     h,  h, 0,  -h,  h, 0,
    -h,  h, 0,  -h, -h, 0,
  ];
  const geometry = new LineSegmentsGeometry();
  geometry.setPositions(positions);
  const seg = new LineSegments2(geometry, getMaterial(color));
  seg.renderOrder = 1;
  // Layer 0 (game view) + layer 1 (debug overlay). Same perpendicular
  // square shows in both passes; debug ortho camera is layer-1-only.
  seg.layers.enable(1);
  return seg;
}

export function updateMarkerResolution(width: number, height: number): void {
  for (const m of sharedMaterials.values()) m.resolution.set(width, height);
}
