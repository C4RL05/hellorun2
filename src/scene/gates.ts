import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { LineSegments2 } from "three/addons/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/addons/lines/LineSegmentsGeometry.js";
import type { Gate } from "../collision";
import {
  BARRIER_OPACITY,
  CELL,
  COLOR_BARRIER,
  COLOR_BARRIER_EDGE,
  EDGE_WIDTH_PX,
  FIRST_GATE_Z,
  GATE_COUNT,
  GATE_OPEN_SLOTS,
  GATE_SPACING,
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
export function createGates(): GatesScene {
  const data: Gate[] = [];
  const barriers: BarrierInfo[] = [];
  const fills: THREE.BufferGeometry[] = [];
  const edges: THREE.BufferGeometry[] = [];

  const slotHeight = CELL / SLOT_COUNT;
  const barrierSize = new THREE.Vector3(CELL, slotHeight, GATE_THICKNESS);
  const baseBarrier = new THREE.BoxGeometry(CELL, slotHeight, GATE_THICKNESS);
  const baseEdges = new THREE.EdgesGeometry(baseBarrier, 40);
  const matrix = new THREE.Matrix4();

  // Build chart data in logical order (gate 0 = first chronologically).
  for (let i = 0; i < GATE_COUNT; i++) {
    const z = FIRST_GATE_Z - i * GATE_SPACING;
    const openSlot = GATE_OPEN_SLOTS[i % GATE_OPEN_SLOTS.length];
    data.push({ z, openSlot });
  }

  // Build geometry far→near so the merged transparent mesh composites
  // correctly back-to-front. (three.js doesn't sort triangles within a
  // single mesh; it draws them in index order.)
  for (let i = GATE_COUNT - 1; i >= 0; i--) {
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
