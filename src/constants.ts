// Feel-spec constants. Single source of truth for every number that governs
// how the game looks and feels. See docs/hellorun2-plan.md §8.
//
// Axis convention:
//   -Z = forward, +X = right, +Y = up

// One world unit per grid cell. All corridor geometry is cube-grid aligned.
export const CELL = 1;

// Tunnel cross-section in cells. Must be odd so a true center column exists
// for the hollow line.
export const TUNNEL_WIDTH = 5;
export const TUNNEL_HEIGHT = 5;

// Tunnel length in cells. Extends from z=0 into -Z.
export const TUNNEL_DEPTH = 40;

// Camera.
export const CAMERA_FOV = 70;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 200;

// Camera sits inside the hollow, just in front of the tunnel entrance.
export const CAMERA_START = { x: 0, y: 0, z: 2 };

// Auto-forward scroll speed (world units / second). With CELL=1 and one gate
// per beat, BPM = FORWARD_SPEED * 60 / gate_spacing_in_cells. 10 u/s with a
// 5-cell gate spacing ≈ 120 BPM. Tune by feel during milestones 2–4, then
// lock before procedural generation (plan §8).
export const FORWARD_SPEED = 10;

// Player vertical movement (plan §1, milestone 3).
// Input pipeline: all sources feed a normalized `inputTarget` in [-1, +1],
// which an eased `inputNow` follows for rendering. Final camera Y is
// inputNow mapped to [PLAYER_Y_MIN, PLAYER_Y_MAX].
export const PLAYER_Y_MIN = -0.4;
export const PLAYER_Y_MAX = 0.4;

// Keyboard rate: normalized units/second while a key is held. 8 means a full
// clamp-to-clamp traversal in 0.25s of continuous input (before easing).
export const KEY_SENSITIVITY = 8;

// Mouse sensitivity: normalized units per viewport-half of mouse Y movement.
// 2 means moving the mouse half the viewport height pushes inputTarget by 1
// (half the corridor). Resolution-independent by construction.
export const MOUSE_SENSITIVITY = 2;

// Exponential smoothing rate (1/s) for inputNow → inputTarget. Higher =
// snappier, lower = floatier. 15 ≈ 67ms time constant.
export const INPUT_EASE_RATE = 15;

// Placeholder palette. Aesthetic is deliberately not locked yet (plan §7 —
// aesthetic decisions come after the game is working).
export const COLOR_BACKGROUND = 0x000000;
export const COLOR_FACE = 0x0a1420;
export const COLOR_EDGE = 0x00aaff;

// Per-cube random rotation range, applied independently on X/Y/Z. Gives the
// tunnel a subtle hand-built jitter instead of a perfectly regular grid.
export const CUBE_JITTER_DEG = 10;

// Edge line thickness in CSS pixels (LineSegments2/LineMaterial). The plain
// LineBasicMaterial linewidth is capped at 1px in every browser, so we use
// screen-space triangle-strip lines instead.
export const EDGE_WIDTH_PX = 2;

// Gates (plan §2, milestone 4).
// "Two bars = one straight. Fixed number of gates per straight, one gate per
// beat." In 4/4 that's 8 gates per straight.
export const GATE_COUNT = 8;
export const GATE_SPACING = (TUNNEL_DEPTH * CELL) / GATE_COUNT;
export const FIRST_GATE_Z = -GATE_SPACING * 0.5;
export const GATE_THICKNESS = 0.15;
export const SLOT_COUNT = 3;

// Gate open-slot pattern (0=bottom, 1=mid, 2=top). Hardcoded chart per plan
// §7 milestone 6 — procedural generation comes later. First gate is mid so
// the spawn position (y=0) is safe; the rest force vertical movement.
export const GATE_OPEN_SLOTS = [1, 2, 0, 1, 2, 0, 1, 2];

// Plan §5: closed-barrier color is fixed (red or amber) regardless of scene
// palette. Danger must mean the same thing visually in every section.
export const COLOR_BARRIER = 0xaa2020;
export const COLOR_BARRIER_EDGE = 0xff2020;

// Turn / corner geometry (plan §2 milestone 5, §8 feel spec).
// TURN_RADIUS is in world units; TURN_ARC_LENGTH is a quarter-circle.
// At FORWARD_SPEED=10 a radius-5 turn takes ~0.785s to traverse.
// Plan prescribes arcing during "beat 4" of the bar; at 120 BPM that's
// 0.5s/beat, so the numbers don't line up yet — tune during M5 before
// procedural generation locks them in.
export const TURN_RADIUS = 5;
export const TURN_ARC_LENGTH = Math.PI * TURN_RADIUS * 0.5;

// Fill opacity for barrier slabs. The bright red edges are opaque so the
// barrier shape stays legible at distance; the fill is see-through so you
// can read the next gate's open slot through nearer barriers.
export const BARRIER_OPACITY = 0.3;

if (TUNNEL_WIDTH % 2 === 0 || TUNNEL_HEIGHT % 2 === 0) {
  throw new Error(
    "TUNNEL_WIDTH and TUNNEL_HEIGHT must be odd so the hollow line has a true center column.",
  );
}
