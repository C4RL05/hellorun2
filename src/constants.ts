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

// Tunnel length in cells. 7 beats × BEAT_LENGTH(5) = 35 cells. The last
// beat of each 2-bar phrase is the turn; the straight takes 7 beats and
// the turn takes 1, so the next straight's beat 1 = beat 1 of the next
// 2-bar phrase. Extends from z=0 into -Z.
export const TUNNEL_DEPTH = 35;

// Camera.
export const CAMERA_FOV = 70;
export const CAMERA_NEAR = 0.1;
export const CAMERA_FAR = 200;

// Camera spawns at the tunnel mouth. z=0 keeps straights uniform 40 units
// across the whole rolling corridor — no special first-section "approach"
// offset that would make beat math drift between the initial straight and
// subsequent ones.
export const CAMERA_START = { x: 0, y: 0, z: 0 };

// Default forward speed (world units / second), corresponding to DEFAULT_BPM
// at the current GATE_SPACING and BEATS_PER_GATE. Used when no song has been
// analyzed yet (fallback for wall-clock tests) or as a baseline before
// analysis completes. Runtime speed is derived from detected BPM — see
// `forwardSpeedForBpm` below and `currentForwardSpeed` in `main.ts`.
export const DEFAULT_BPM = 120;
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

// Gates (plan §2, milestones 4 and 7).
//
// Each 2-bar phrase (8 beats at 4/4) breaks into 7 straight-beats + 1
// turn-beat, so BEATS_PER_STRAIGHT = 7. BEATS_PER_GATE is the gate cadence:
// 4 means one gate every 4 beats, giving 2 gates per straight at beats
// FIRST_GATE_BEAT (= 2) and FIRST_GATE_BEAT + BEATS_PER_GATE (= 6). Drop
// BEATS_PER_GATE to 2 for a denser feel once M8 section energy wires in.
//
// BEAT_LENGTH is the primitive that couples world units to beats —
// TUNNEL_DEPTH × CELL / BEATS_PER_STRAIGHT = 35/7 = 5 u/beat. Everything
// beat-related (gate spacing, turn length, marker intervals) derives from
// it, so swapping BEATS_PER_STRAIGHT propagates cleanly.
export const BEATS_PER_STRAIGHT = 7;
export const BEAT_LENGTH = (TUNNEL_DEPTH * CELL) / BEATS_PER_STRAIGHT;
export const BEATS_PER_GATE = 4;
export const FIRST_GATE_BEAT = 2;
export const GATE_SPACING = BEATS_PER_GATE * BEAT_LENGTH;
export const GATE_COUNT =
  Math.floor((BEATS_PER_STRAIGHT - FIRST_GATE_BEAT) / BEATS_PER_GATE) + 1;
export const FIRST_GATE_Z = -FIRST_GATE_BEAT * BEAT_LENGTH;
export const GATE_THICKNESS = 0.15;
export const SLOT_COUNT = 3;

// Plan §5: closed-barrier color is fixed (red or amber) regardless of scene
// palette. Danger must mean the same thing visually in every section.
export const COLOR_BARRIER = 0xaa2020;
export const COLOR_BARRIER_EDGE = 0xff2020;

// Turn / corner geometry (plan §2 milestone 5, §8 feel spec).
//
// Source of truth is TURN_BEATS — how many beats the turn takes. Plan §7 M5:
// "camera arc during beat 4" → 1 beat. At the beat-locked forward speed the
// camera covers `GATE_SPACING × TURN_BEATS / BEATS_PER_GATE` world units per
// turn (BPM-independent: FORWARD_SPEED scales with BPM, and so does the
// wall-clock time, so distance cancels). Given the arc is a quarter circle,
// `TURN_RADIUS = 2 × arc / π` — so the turn lands exactly on the next beat
// regardless of tempo. Bump TURN_BEATS to 2 for a gentler (bigger radius)
// sweep at the cost of a longer musical rest between sections.
export const TURN_BEATS = 1;
export const TURN_ARC_LENGTH = (GATE_SPACING * TURN_BEATS) / BEATS_PER_GATE;
export const TURN_RADIUS = (2 * TURN_ARC_LENGTH) / Math.PI;

// Fill opacity for barrier slabs. The bright red edges are opaque so the
// barrier shape stays legible at distance; the fill is see-through so you
// can read the next gate's open slot through nearer barriers.
export const BARRIER_OPACITY = 0.3;

// Musical-structure markers. Square borders placed perpendicular to the
// path at every beat / bar / phrase / section boundary so the player flies
// through a visual hierarchy of musical time.
//
// 4× nesting both temporally (beats per bar, bars per phrase, …) and
// visually (each marker is 4× the last). Intervals are BPM-independent in
// world units — all derived from BEAT_LENGTH above.
export const BEATS_PER_BAR = 4;
export const BARS_PER_PHRASE = 4;
export const PHRASES_PER_SECTION = 4;
export const BAR_LENGTH = BEAT_LENGTH * BEATS_PER_BAR;
export const PHRASE_LENGTH = BAR_LENGTH * BARS_PER_PHRASE;
export const SECTION_MARKER_LENGTH = PHRASE_LENGTH * PHRASES_PER_SECTION;

export const MARKER_BEAT_SIZE = 1;
export const MARKER_BAR_SIZE = MARKER_BEAT_SIZE * 4;
export const MARKER_PHRASE_SIZE = MARKER_BAR_SIZE * 4;
export const MARKER_SECTION_SIZE = MARKER_PHRASE_SIZE * 4;

export const MARKER_BEAT_COLOR = 0xff0000;
export const MARKER_BAR_COLOR = 0x00ff00;
export const MARKER_PHRASE_COLOR = 0x0000ff;
export const MARKER_SECTION_COLOR = 0xffffff;

// Marker line thickness in CSS pixels (LineSegments2). Thicker than the
// 2px tunnel edges so the musical-structure grid reads clearly over the
// tunnel geometry.
export const MARKER_EDGE_WIDTH_PX = 4;

if (TUNNEL_WIDTH % 2 === 0 || TUNNEL_HEIGHT % 2 === 0) {
  throw new Error(
    "TUNNEL_WIDTH and TUNNEL_HEIGHT must be odd so the hollow line has a true center column.",
  );
}

// World-space forward speed needed for gates to land on beats at the given
// BPM. Derivation: time between gates = BEATS_PER_GATE × (60/bpm); that time
// must equal GATE_SPACING / speed, so speed = GATE_SPACING × bpm / (BEATS_PER_GATE × 60).
// At bpm=DEFAULT_BPM this returns FORWARD_SPEED by construction.
export function forwardSpeedForBpm(bpm: number): number {
  return (GATE_SPACING * bpm) / (BEATS_PER_GATE * 60);
}
