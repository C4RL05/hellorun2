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

if (TUNNEL_WIDTH % 2 === 0 || TUNNEL_HEIGHT % 2 === 0) {
  throw new Error(
    "TUNNEL_WIDTH and TUNNEL_HEIGHT must be odd so the hollow line has a true center column.",
  );
}
