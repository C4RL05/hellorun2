import * as THREE from "three";
import {
  CAMERA_START,
  CELL,
  TUNNEL_DEPTH,
  TURN_ARC_LENGTH,
  TURN_RADIUS,
} from "./constants";

// A "straight" spans from spawn (CAMERA_START.z units in front of the
// tunnel mouth) all the way through the tunnel to its far end, so its path
// length is the approach plus the tunnel depth.
export const STRAIGHT_LENGTH = CAMERA_START.z + TUNNEL_DEPTH * CELL;

// Corridor: straight 1 → right-turn arc → straight 2 → wraps to start.
export const PATH_TOTAL = STRAIGHT_LENGTH + TURN_ARC_LENGTH + STRAIGHT_LENGTH;

// World-space placement of the second straight's group. Its local -Z
// (the direction the tunnel/gates extend into) is aligned with world +X
// via a -π/2 yaw, and its local origin sits at the turn exit point.
export const STRAIGHT2_POS = new THREE.Vector3(
  TURN_RADIUS,
  0,
  CAMERA_START.z - STRAIGHT_LENGTH - TURN_RADIUS,
);
export const STRAIGHT2_YAW = -Math.PI * 0.5;

export interface Pose {
  readonly pos: THREE.Vector3;
  readonly yaw: number; // radians around +Y; 0 = facing -Z
}

// Center of the right-turn arc between straight 1's exit and straight 2's
// entry. At the end of straight 1 the camera is at (0, 0, exit_z) facing
// -Z; a right turn puts the arc center TURN_RADIUS to the right (+X).
const TURN_CENTER_X = TURN_RADIUS;
const TURN_CENTER_Z = CAMERA_START.z - STRAIGHT_LENGTH;

const _sampleOut = new THREE.Vector3();

// Returns the camera world pose at distance s along the corridor path.
// s is wrapped to [0, PATH_TOTAL). Reuses an internal Vector3 for pos —
// read it immediately and don't retain a reference across frames.
export function samplePath(s: number): Pose {
  const w = ((s % PATH_TOTAL) + PATH_TOTAL) % PATH_TOTAL;

  if (w < STRAIGHT_LENGTH) {
    _sampleOut.set(0, 0, CAMERA_START.z - w);
    return { pos: _sampleOut, yaw: 0 };
  }

  if (w < STRAIGHT_LENGTH + TURN_ARC_LENGTH) {
    const t = (w - STRAIGHT_LENGTH) / TURN_ARC_LENGTH;
    const angle = t * Math.PI * 0.5;
    _sampleOut.set(
      TURN_CENTER_X - TURN_RADIUS * Math.cos(angle),
      0,
      TURN_CENTER_Z - TURN_RADIUS * Math.sin(angle),
    );
    return { pos: _sampleOut, yaw: -angle };
  }

  const s2 = w - STRAIGHT_LENGTH - TURN_ARC_LENGTH;
  _sampleOut.set(STRAIGHT2_POS.x + s2, 0, STRAIGHT2_POS.z);
  return { pos: _sampleOut, yaw: STRAIGHT2_YAW };
}
