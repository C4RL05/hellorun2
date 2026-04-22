import * as THREE from "three";
import { TURN_ARC_LENGTH, TURN_RADIUS, TUNNEL_DEPTH, CELL } from "./constants";

// Length of one straight section's path span (world units). Uniform across
// all straights — both initial and generated. At the beat-locked forward
// speed this equals BEATS_PER_STRAIGHT beats exactly (derivable from
// GATE_SPACING × BEATS_PER_STRAIGHT / BEATS_PER_GATE).
export const STRAIGHT_LENGTH = TUNNEL_DEPTH * CELL;

// A section is one span of the infinite corridor. The path scalar pathS
// advances monotonically through sections in order; given any pathS, a
// linear scan of the section list finds which section owns it and converts
// to local coordinates for sampling.
//
// Straights carry gameplay (gates). Turns are pure transitions — no gates,
// plan §2. Both are BPM-independent in world units — at the beat-locked
// forward speed, traversal time = (length / forward_speed), which scales
// correctly with BPM because forward_speed does.
export type TurnDirection = 1 | -1; // +1 right (yaw decreases), -1 left

interface SectionBase {
  readonly pathStart: number;
  readonly length: number;
}

export interface StraightSection extends SectionBase {
  readonly kind: "straight";
  // World position of the section's entry point (where pathS = pathStart
  // puts the camera). Forward is along (-sin(yaw), 0, -cos(yaw)).
  readonly position: THREE.Vector3;
  readonly yaw: number;
}

export interface TurnSection extends SectionBase {
  readonly kind: "turn";
  readonly center: THREE.Vector3;
  readonly radius: number;
  readonly startYaw: number;
  readonly direction: TurnDirection;
}

export type Section = StraightSection | TurnSection;

export interface Pose {
  readonly pos: THREE.Vector3;
  readonly yaw: number;
}

const _samplePos = new THREE.Vector3();

// Returns the camera world pose at pathS along the section chain. Reuses
// an internal Vector3 — read it immediately; don't retain across frames.
// Clamps to the last section's end if pathS exceeds all generated sections.
export function samplePath(
  sections: readonly Section[],
  s: number,
): Pose {
  const sec = findSection(sections, s);
  if (!sec) {
    _samplePos.set(0, 0, 0);
    return { pos: _samplePos, yaw: 0 };
  }
  const localS = Math.max(0, Math.min(sec.length, s - sec.pathStart));
  if (sec.kind === "straight") {
    const fx = -Math.sin(sec.yaw);
    const fz = -Math.cos(sec.yaw);
    _samplePos.set(
      sec.position.x + fx * localS,
      0,
      sec.position.z + fz * localS,
    );
    return { pos: _samplePos, yaw: sec.yaw };
  }
  const t = localS / sec.length;
  const yaw = sec.startYaw - t * Math.PI * 0.5 * sec.direction;
  // Vector from center to camera rotates rigidly with yaw (derivation:
  // the camera's body frame rotates by Δyaw around +Y, and the position
  // vector v = camera − center is perpendicular to forward, so it rotates
  // by the same Δyaw). Closed-form: v(yaw) = R·direction·(−cos(yaw), 0, sin(yaw)).
  _samplePos.set(
    sec.center.x + sec.radius * sec.direction * -Math.cos(yaw),
    0,
    sec.center.z + sec.radius * sec.direction * Math.sin(yaw),
  );
  return { pos: _samplePos, yaw };
}

function findSection(
  sections: readonly Section[],
  s: number,
): Section | null {
  if (sections.length === 0) return null;
  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    if (s < sec.pathStart + sec.length) return sec;
  }
  return sections[sections.length - 1];
}

// Builds the next section in the chain given the previous one. For a
// straight→turn transition, the turn starts where the straight ended, at
// the same yaw. For a turn→straight transition, the straight starts where
// the turn ended, at the post-turn yaw.
export function nextStraightAfter(
  turn: TurnSection,
): StraightSection {
  const endLocalS = turn.length;
  const endT = endLocalS / turn.length;
  const yaw = turn.startYaw - endT * Math.PI * 0.5 * turn.direction;
  const x = turn.center.x + turn.radius * turn.direction * -Math.cos(yaw);
  const z = turn.center.z + turn.radius * turn.direction * Math.sin(yaw);
  return {
    kind: "straight",
    pathStart: turn.pathStart + turn.length,
    length: STRAIGHT_LENGTH,
    position: new THREE.Vector3(x, 0, z),
    yaw,
  };
}

export function nextTurnAfter(
  straight: StraightSection,
  direction: TurnDirection,
): TurnSection {
  // Camera at end of straight:
  const fx = -Math.sin(straight.yaw);
  const fz = -Math.cos(straight.yaw);
  const endX = straight.position.x + fx * straight.length;
  const endZ = straight.position.z + fz * straight.length;
  // "Right" vector relative to the straight's yaw (see samplePath derivation).
  const rx = Math.cos(straight.yaw);
  const rz = -Math.sin(straight.yaw);
  // Center lies `direction × radius` along the right vector from the end
  // point: right for a right turn, left for a left turn.
  const cx = endX + rx * TURN_RADIUS * direction;
  const cz = endZ + rz * TURN_RADIUS * direction;
  return {
    kind: "turn",
    pathStart: straight.pathStart + straight.length,
    length: TURN_ARC_LENGTH,
    center: new THREE.Vector3(cx, 0, cz),
    radius: TURN_RADIUS,
    startYaw: straight.yaw,
    direction,
  };
}
