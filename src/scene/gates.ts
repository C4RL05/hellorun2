import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import type { Gate } from "../collision";
import {
  BARRIER_CELLS_WIDE,
  BARRIER_OPACITY,
  BEAT_LENGTH,
  CELL,
  COLOR_BARRIER,
  COLOR_BARRIER_EDGE,
  EDGE_WIDTH_PX,
  GATE_THICKNESS,
  SLOT_COUNT,
} from "../constants";

export interface BarrierInfo {
  readonly localCenter: THREE.Vector3;
  readonly size: THREE.Vector3;
}

export interface GatesScene {
  object: THREE.Object3D;
  data: Gate[];
  barriers: BarrierInfo[];
  edgeMaterial: LineMaterial;
}

// Builds all gates for the straight as a single merged mesh + fat-line
// edges. Each gate is SLOT_COUNT slots stacked vertically, with the open
// slot simply omitted from the merge (no barrier there).
//
// `openSlots[i]` is the open slot for gate i. `beats[i]` is the beat
// number (1-indexed from the straight's start) where gate i lands — gate
// z in the straight's local frame is `-beats[i] × BEAT_LENGTH`. The two
// arrays must be the same length and chronologically ordered (beats[0]
// is the earliest gate in the straight).
export function createGates(
  openSlots: readonly number[],
  beats: readonly number[],
): GatesScene {
  if (openSlots.length !== beats.length) {
    throw new Error(
      `createGates: openSlots length ${openSlots.length} !== beats length ${beats.length}`,
    );
  }
  const gateCount = openSlots.length;
  const data: Gate[] = [];
  const barriers: BarrierInfo[] = [];
  const fills: THREE.BufferGeometry[] = [];
  const edges: THREE.BufferGeometry[] = [];

  const slotHeight = CELL / SLOT_COUNT;
  const barrierWidth = BARRIER_CELLS_WIDE * slotHeight;
  const barrierSize = new THREE.Vector3(barrierWidth, slotHeight, GATE_THICKNESS);
  const baseBarrier = new THREE.BoxGeometry(
    barrierWidth,
    slotHeight,
    GATE_THICKNESS,
  );
  const baseEdges = buildBarrierEdgeGeometry(
    barrierWidth,
    slotHeight,
    GATE_THICKNESS,
    BARRIER_CELLS_WIDE,
  );
  const matrix = new THREE.Matrix4();

  // Build chart data in logical order (gate 0 = first chronologically).
  for (let i = 0; i < gateCount; i++) {
    const z = -beats[i] * BEAT_LENGTH;
    data.push({ z, openSlot: openSlots[i] });
  }

  // Build geometry far→near so the merged transparent mesh composites
  // correctly back-to-front. (three.js doesn't sort triangles within a
  // single mesh; it draws them in index order.)
  for (let i = gateCount - 1; i >= 0; i--) {
    const gate = data[i];
    for (let s = 0; s < SLOT_COUNT; s++) {
      if (s === gate.openSlot) continue;
      const slotCenterY = -CELL * 0.5 + slotHeight * (s + 0.5);
      matrix.makeTranslation(0, slotCenterY, gate.z);
      fills.push(baseBarrier.clone().applyMatrix4(matrix));
      edges.push(baseEdges.clone().applyMatrix4(matrix));
      barriers.push({
        localCenter: new THREE.Vector3(0, slotCenterY, gate.z),
        size: barrierSize.clone(),
      });
    }
  }

  baseBarrier.dispose();
  baseEdges.dispose();

  const mergedFill = mergeGeometries(fills, false);
  const mergedEdgeSegments = mergeGeometries(edges, false);
  if (!mergedFill || !mergedEdgeSegments) {
    throw new Error("Failed to merge gate geometry");
  }

  for (const g of fills) g.dispose();
  for (const g of edges) g.dispose();

  const edgeGeometry = new LineSegmentsGeometry();
  edgeGeometry.setPositions(
    mergedEdgeSegments.attributes.position.array as Float32Array,
  );
  mergedEdgeSegments.dispose();

  const fillMaterial = new THREE.MeshLambertMaterial({
    color: COLOR_BARRIER,
    transparent: true,
    opacity: BARRIER_OPACITY,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const edgeMaterial = new LineMaterial({
    color: COLOR_BARRIER_EDGE,
    linewidth: EDGE_WIDTH_PX,
  });

  const group = new THREE.Group();
  group.add(new THREE.Mesh(mergedFill, fillMaterial));
  group.add(new LineSegments2(edgeGeometry, edgeMaterial));
  return { object: group, data, barriers, edgeMaterial };
}

// Barrier edges: the 12 edges of the box (same set `EdgesGeometry` would
// give at threshold 40°) plus (cellsWide − 1) internal vertical dividers on
// both the front and back faces, so the slab reads as a row of square cells
// from any viewing angle.
function buildBarrierEdgeGeometry(
  width: number,
  height: number,
  depth: number,
  cellsWide: number,
): THREE.BufferGeometry {
  const box = new THREE.BoxGeometry(width, height, depth);
  const boxEdges = new THREE.EdgesGeometry(box, 40);
  const positions: number[] = Array.from(
    boxEdges.attributes.position.array as Float32Array,
  );
  box.dispose();
  boxEdges.dispose();
  const halfH = height * 0.5;
  const halfD = depth * 0.5;
  for (let k = 1; k < cellsWide; k++) {
    const x = -width * 0.5 + (k * width) / cellsWide;
    // Front face divider (z = -halfD) and back face divider (z = +halfD).
    positions.push(x, -halfH, -halfD, x, halfH, -halfD);
    positions.push(x, -halfH, halfD, x, halfH, halfD);
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  return geom;
}
