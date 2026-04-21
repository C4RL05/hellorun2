import { CELL, SLOT_COUNT } from "./constants";

export interface Gate {
  readonly z: number;
  readonly openSlot: number;
}

// Maps a world Y in [-CELL/2, +CELL/2] to a slot index in [0, SLOT_COUNT-1].
// Slot 0 = bottom, SLOT_COUNT-1 = top. Out-of-range values are clamped.
export function slotForY(y: number): number {
  const slotHeight = CELL / SLOT_COUNT;
  const fromBottom = y + CELL * 0.5;
  const idx = Math.floor(fromBottom / slotHeight);
  if (idx < 0) return 0;
  if (idx >= SLOT_COUNT) return SLOT_COUNT - 1;
  return idx;
}

// Z-crossing collision check. Returns the first gate the camera passed
// through this frame with the wrong slot, or null if none were hit.
//
// Camera travels in -Z, so a crossing is prevZ > gate.z && currZ <= gate.z.
// A loop-back (prev way less than curr) fails the prev > gate.z side and
// therefore never triggers a false hit.
export function checkCollision(
  y: number,
  currZ: number,
  prevZ: number,
  gates: readonly Gate[],
): Gate | null {
  for (const gate of gates) {
    if (prevZ > gate.z && currZ <= gate.z) {
      if (slotForY(y) !== gate.openSlot) return gate;
    }
  }
  return null;
}
