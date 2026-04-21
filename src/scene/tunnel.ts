import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import {
  CELL,
  COLOR_EDGE,
  COLOR_FACE,
  TUNNEL_DEPTH,
  TUNNEL_HEIGHT,
  TUNNEL_WIDTH,
} from "../constants";

// Builds a straight section of corridor: a 3D grid of cubes with a 1-cell
// hollow column running along -Z through the center. Geometry is merged into
// one fill mesh + one edge LineSegments so the whole section is 2 draw calls.
export function createTunnel(): THREE.Group {
  const cellCenters = computeCellCenters();

  const baseBox = new THREE.BoxGeometry(CELL, CELL, CELL);
  const baseEdges = new THREE.EdgesGeometry(baseBox, 40);

  const boxes: THREE.BufferGeometry[] = [];
  const edges: THREE.BufferGeometry[] = [];

  const matrix = new THREE.Matrix4();
  for (const p of cellCenters) {
    matrix.makeTranslation(p.x, p.y, p.z);
    boxes.push(baseBox.clone().applyMatrix4(matrix));
    edges.push(baseEdges.clone().applyMatrix4(matrix));
  }

  baseBox.dispose();
  baseEdges.dispose();

  const mergedFill = mergeGeometries(boxes, false);
  const mergedEdge = mergeGeometries(edges, false);
  if (!mergedFill || !mergedEdge) {
    throw new Error("Failed to merge tunnel geometry");
  }

  for (const g of boxes) g.dispose();
  for (const g of edges) g.dispose();

  const fillMaterial = new THREE.MeshLambertMaterial({ color: COLOR_FACE });
  const edgeMaterial = new THREE.LineBasicMaterial({ color: COLOR_EDGE });

  const group = new THREE.Group();
  group.add(new THREE.Mesh(mergedFill, fillMaterial));
  group.add(new THREE.LineSegments(mergedEdge, edgeMaterial));
  return group;
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
