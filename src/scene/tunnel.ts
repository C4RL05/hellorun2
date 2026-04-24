import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import {
  CELL,
  COLOR_EDGE,
  COLOR_FACE,
  CUBE_JITTER_DEG,
  EDGE_WIDTH_PX,
  TUNNEL_DEPTH,
  TUNNEL_HEIGHT,
  TUNNEL_WIDTH,
} from "../constants";
import { setHdrEdgeColor } from "../hdr-edges";

export interface TunnelScene {
  object: THREE.Object3D;
  // LineMaterial needs viewport size for its screen-space width calc.
  // Caller must keep this in sync with the renderer on resize.
  edgeMaterial: LineMaterial;
  // Per-cube local transforms (translation + jitter rotation). A debug
  // visualization that wants oriented bboxes matching the rendered cubes
  // uses these directly; one per cube that actually exists (hollow cell
  // omitted).
  cubeTransforms: readonly THREE.Matrix4[];
}

// Builds a straight section of corridor: a 3D grid of cubes with a 1-cell
// hollow column running along -Z through the center. Geometry is merged into
// one fill mesh + one fat-line segments mesh so the whole section is a
// bounded number of draw calls.
export function createTunnel(): TunnelScene {
  const cellCenters = computeCellCenters();

  const baseBox = new THREE.BoxGeometry(CELL, CELL, CELL);
  const baseEdges = new THREE.EdgesGeometry(baseBox, 40);

  const boxes: THREE.BufferGeometry[] = [];
  const edges: THREE.BufferGeometry[] = [];

  const cubeTransforms: THREE.Matrix4[] = [];
  const matrix = new THREE.Matrix4();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scale = new THREE.Vector3(1, 1, 1);
  const jitter = THREE.MathUtils.degToRad(CUBE_JITTER_DEG);
  for (const p of cellCenters) {
    euler.set(
      (Math.random() * 2 - 1) * jitter,
      (Math.random() * 2 - 1) * jitter,
      (Math.random() * 2 - 1) * jitter,
    );
    quat.setFromEuler(euler);
    matrix.compose(p, quat, scale);
    boxes.push(baseBox.clone().applyMatrix4(matrix));
    edges.push(baseEdges.clone().applyMatrix4(matrix));
    cubeTransforms.push(matrix.clone());
  }

  baseBox.dispose();
  baseEdges.dispose();

  const mergedFill = mergeGeometries(boxes, false);
  const mergedEdgeSegments = mergeGeometries(edges, false);
  if (!mergedFill || !mergedEdgeSegments) {
    throw new Error("Failed to merge tunnel geometry");
  }

  for (const g of boxes) g.dispose();
  for (const g of edges) g.dispose();

  const edgeGeometry = new LineSegmentsGeometry();
  edgeGeometry.setPositions(
    mergedEdgeSegments.attributes.position.array as Float32Array,
  );
  mergedEdgeSegments.dispose();

  const fillMaterial = new THREE.MeshLambertMaterial({ color: COLOR_FACE });
  const edgeMaterial = new LineMaterial({ linewidth: EDGE_WIDTH_PX });
  // HDR: lift color past bloom threshold. setHdrEdgeColor also
  // registers the material so the Post settings panel's emissive slider
  // can refresh it live.
  setHdrEdgeColor(edgeMaterial, COLOR_EDGE);

  const group = new THREE.Group();
  group.add(new THREE.Mesh(mergedFill, fillMaterial));
  group.add(new LineSegments2(edgeGeometry, edgeMaterial));
  return { object: group, edgeMaterial, cubeTransforms };
}

function computeCellCenters(): THREE.Vector3[] {
  const centers: THREE.Vector3[] = [];
  const halfW = (TUNNEL_WIDTH - 1) / 2;
  const halfH = (TUNNEL_HEIGHT - 1) / 2;

  for (let zi = 0; zi < TUNNEL_DEPTH; zi++) {
    for (let yi = 0; yi < TUNNEL_HEIGHT; yi++) {
      for (let xi = 0; xi < TUNNEL_WIDTH; xi++) {
        const cx = xi - halfW;
        const cy = yi - halfH;
        if (cx === 0 && cy === 0) continue;
        centers.push(
          new THREE.Vector3(cx * CELL, cy * CELL, -(zi + 0.5) * CELL),
        );
      }
    }
  }
  return centers;
}
