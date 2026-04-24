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
// at one beat per BEAT_LENGTH world units. Used when no song has been
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

// Per-section edge palette. Each unique audio Section.kind gets a hue from
// this list (kind 0 = first entry). Songs with more kinds than colors cycle
// via modulo. Closed-barrier red (COLOR_BARRIER_EDGE) is fixed by plan §5
// and intentionally absent here so danger never collides with section hue.
// Kept in the cyan/magenta/amber family to stay on the Tron-Recognizer
// aesthetic; faces stay COLOR_FACE across all kinds.
export const SECTION_EDGE_PALETTE: readonly number[] = [
  0x00aaff, // cyan — same as COLOR_EDGE so kind 0 keeps the default look
  0xff66cc, // pink
  0xffaa22, // amber
  0x44ddaa, // teal-green
  0x9966ff, // violet
];

// Per-cube random rotation range, applied independently on X/Y/Z. Gives the
// tunnel a subtle hand-built jitter instead of a perfectly regular grid.
export const CUBE_JITTER_DEG = 10;

// Edge line thickness in CSS pixels (LineSegments2/LineMaterial). The plain
// LineBasicMaterial linewidth is capped at 1px in every browser, so we use
// screen-space triangle-strip lines instead.
export const EDGE_WIDTH_PX = 2;

// HDR pipeline (plan §5/§6, docs/hdr-pipeline.md).
//
// The composer uses a HalfFloatType framebuffer so colors > 1.0 survive
// between passes. Edge LineMaterials get their RGB multiplied by
// EDGE_EMISSIVE_STRENGTH on creation / recolor so the Bloom pass (which
// only extracts luminance > BLOOM_THRESHOLD) picks them up while the
// Lambert-shaded faces stay ≤ 1.0 and don't bloom. Bloom runs BEFORE
// exposure + tone-mapping — threshold is compared against raw scene
// colors, so BLOOM_THRESHOLD is decoupled from EXPOSURE as a knob.
// ACES Filmic is the SDR compressor; rolls saturated neon to white at
// the bloom core instead of hard-clipping to a primary.
export const EDGE_EMISSIVE_STRENGTH = 2.5;
export const BLOOM_STRENGTH = 0.6;
export const BLOOM_THRESHOLD = 1.0;
export const BLOOM_RADIUS = 0.5;
export const BLOOM_SMOOTHING = 0.03;
export const BLOOM_LEVELS = 8;
// Exposure held at 1.0: the emissive multiplier above already pushes
// edges well into HDR, and ACES Filmic tone mapping desaturates hard if
// we additionally gain by 2× — cyan tunnel edges would bleach to white.
// The "high in the moment" reference at exposure=2 is going for that
// bleached look; we want the Tron neon to keep its hue.
export const HDR_EXPOSURE = 1.0;

// Gates (plan §2, milestones 4 and 7; §5 section-driven density).
//
// Each 2-bar phrase (8 beats at 4/4) breaks into 7 straight-beats + 1
// turn-beat, so BEATS_PER_STRAIGHT = 7. BEAT_LENGTH is the primitive that
// couples world units to beats — TUNNEL_DEPTH × CELL / BEATS_PER_STRAIGHT
// = 35/7 = 5 u/beat. Everything beat-related (gate z, turn length, marker
// intervals) derives from it, so swapping BEATS_PER_STRAIGHT propagates
// cleanly.
//
// Gate placement is no longer a uniform global. Each straight picks a
// density tier (from audio-section loudness + per-kind repeat count) that
// names the exact beats to place gates on. See DENSITY_TIERS below and
// the wiring in main.ts::appendSection.
export const BEATS_PER_STRAIGHT = 7;
export const BEAT_LENGTH = (TUNNEL_DEPTH * CELL) / BEATS_PER_STRAIGHT;
export const GATE_THICKNESS = 0.15;
export const SLOT_COUNT = 3;

// Beats where a gate is allowed to live. Beat 1 is excluded because the
// camera has just exited a turn and the hard-reveal rule (plan §2) means
// the player needs a beat to read the straight. Beat 7 (= BEATS_PER_STRAIGHT)
// lands right at the turn mouth — deliberately kept eligible so peak-density
// straights can punch a last decision into the corner entry.
export const GATE_ELIGIBLE_BEATS: readonly number[] = [2, 3, 4, 5, 6, 7];

// Density tiers. Each straight's audio section maps (normalized loudness +
// repeat-count ramp) to one of these. The beats array IS the placement —
// gate i lands at z = -tier.beats[i] × BEAT_LENGTH. maxDifficulty caps the
// phrase-vocabulary difficulty. preferSweeps gates whether the generator
// reaches for SWEEP_PHRASES (long monotone atoms) first; paired with high
// counts so 5–6 gates read as smooth rushes rather than random walls.
//
// Rationale for the high-count caps: at 5–6 gates, stitching random 3-gate
// phrases tends toward middling zig-zag. Low maxDifficulty + preferSweeps
// keeps peak density readable — the difficulty signal comes from "so many
// decisions" rather than "each decision is a 2-slot jump."
export interface DensityTier {
  readonly count: number;
  readonly beats: readonly number[];
  readonly maxDifficulty: number;
  readonly preferSweeps: boolean;
}
export const DENSITY_TIERS: readonly DensityTier[] = [
  { count: 2, beats: [2, 6],             maxDifficulty: 2, preferSweeps: false }, // quiet
  { count: 3, beats: [2, 4, 6],          maxDifficulty: 3, preferSweeps: false }, // low-med
  { count: 4, beats: [2, 4, 6, 7],       maxDifficulty: 3, preferSweeps: false }, // med-high
  { count: 5, beats: [2, 3, 5, 6, 7],    maxDifficulty: 2, preferSweeps: true  }, // high
  { count: 6, beats: [2, 3, 4, 5, 6, 7], maxDifficulty: 2, preferSweeps: true  }, // peak
];

// Default tier index (used on the first straight or two before analysis lands,
// and as the neutral fallback when no audio section covers a given pathS).
// Tier 1 gives 3 gates at beats 2/4/6 — the most "normal" feel.
export const DEFAULT_DENSITY_TIER = 1;

// Per-kind ramp. Each time the same audio-section kind is entered again,
// we bump the tier index and/or maxDifficulty. Keeps a repeating chorus
// from feeling identical on each pass without changing its palette.
//  - TIER_BUMP_EVERY = 2 → second repeat +0, third repeat +1, fourth +1, fifth +2.
//  - DIFFICULTY_BUMP_EVERY = 1 → every repeat nudges the pattern cap +1.
// Both bumps are clamped against DENSITY_TIERS.length - 1 and maxDifficulty 4.
export const SAME_KIND_TIER_BUMP_EVERY = 2;
export const SAME_KIND_DIFFICULTY_BUMP_EVERY = 1;
// Number of horizontal cells per barrier slab. At BARRIER_CELLS_WIDE=4 and
// slotHeight=CELL/SLOT_COUNT, the barrier is 4 × slotHeight wide × slotHeight
// tall — visible face is 4 square cells outlined by the edge material
// (box outline + 3 internal vertical dividers). Purely visual: collision
// only cares about the player's Y slot, not the barrier's X extent.
export const BARRIER_CELLS_WIDE = 4;

// Plan §5: closed-barrier color is fixed (red or amber) regardless of scene
// palette. Danger must mean the same thing visually in every section.
export const COLOR_BARRIER = 0xaa2020;
export const COLOR_BARRIER_EDGE = 0xff2020;

// Turn / corner geometry (plan §2 milestone 5, §8 feel spec).
//
// Source of truth is TURN_BEATS — how many beats the turn takes. Plan §7 M5:
// "camera arc during beat 4" → 1 beat. At the beat-locked forward speed the
// camera covers `BEAT_LENGTH × TURN_BEATS` world units per turn
// (BPM-independent: FORWARD_SPEED scales with BPM, and so does the
// wall-clock time, so distance cancels). Given the arc is a quarter circle,
// `TURN_RADIUS = 2 × arc / π` — so the turn lands exactly on the next beat
// regardless of tempo. Bump TURN_BEATS to 2 for a gentler (bigger radius)
// sweep at the cost of a longer musical rest between sections.
export const TURN_BEATS = 1;
export const TURN_ARC_LENGTH = BEAT_LENGTH * TURN_BEATS;
export const TURN_RADIUS = (2 * TURN_ARC_LENGTH) / Math.PI;

// Fill opacity for barrier slabs. The bright red edges are opaque so the
// barrier shape stays legible at distance; the fill is see-through so you
// can read the next gate's open slot through nearer barriers.
export const BARRIER_OPACITY = 0.5;

// Musical-structure markers. Square borders placed perpendicular to the
// path at every beat / bar / phrase / period boundary so the player flies
// through a visual hierarchy of musical time.
//
// 4× nesting both temporally (beats per bar, bars per phrase, …) and
// visually (each marker is 4× the last). Intervals are BPM-independent in
// world units — all derived from BEAT_LENGTH above.
//
// Note: "period" here is a fixed-cadence visual marker (every 4 phrases =
// 64 beats), not a game "section". Game sections are variable-length
// 16-beat-aligned blocks that drive palette/density and live elsewhere.
export const BEATS_PER_BAR = 4;
export const BARS_PER_PHRASE = 4;
export const PHRASES_PER_PERIOD = 4;
export const BAR_LENGTH = BEAT_LENGTH * BEATS_PER_BAR;
export const PHRASE_LENGTH = BAR_LENGTH * BARS_PER_PHRASE;
export const PERIOD_LENGTH = PHRASE_LENGTH * PHRASES_PER_PERIOD;

export const MARKER_BEAT_SIZE = 1;
export const MARKER_BAR_SIZE = MARKER_BEAT_SIZE * 4;
export const MARKER_PHRASE_SIZE = MARKER_BAR_SIZE * 4;
export const MARKER_PERIOD_SIZE = MARKER_PHRASE_SIZE * 4;

export const MARKER_BEAT_COLOR = 0xff0000;
export const MARKER_BAR_COLOR = 0x00ff00;
export const MARKER_PHRASE_COLOR = 0x0000ff;
export const MARKER_PERIOD_COLOR = 0xffffff;

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
// BPM. Derivation: time between beats = 60/bpm; that time must equal
// BEAT_LENGTH / speed, so speed = BEAT_LENGTH × bpm / 60.
// At bpm=DEFAULT_BPM this returns FORWARD_SPEED by construction.
export function forwardSpeedForBpm(bpm: number): number {
  return (BEAT_LENGTH * bpm) / 60;
}

// Game-over effects (see docs/game-over-rewind-and-vinyl-audio.md).
//
// Camera "rewind": on death, the camera drifts backward along the path —
// initial recoil (RECOIL_SPEED) eases toward a small idle drift
// (DRIFT_SPEED) at exponential rate EASE_RATE. Both speeds are world u/s
// signed (negative = backward). Tuned relative to FORWARD_SPEED so the
// recoil reads as roughly half the forward speed and the drift is a slow
// continuous backward float. pathS is clamped at 0 since the corridor is
// monotonic — no wrap.
export const DEATH_REWIND_RECOIL_SPEED = -5;
export const DEATH_REWIND_DRIFT_SPEED = -1;
export const DEATH_REWIND_EASE_RATE = 2;

// Vinyl stop: on death, the audio source's playbackRate is ramped down
// linearly at RAMP_PER_SEC units/sec. When the rate falls below
// CUT_THRESHOLD the source is stopped (cutting at exactly 0 can produce
// clicks / DC offset). Default is a ~1s slowdown — set RAMP_PER_SEC to
// 0.5 for ~2s ("more tired"), 2.0 for ~0.5s ("snappier glitch").
export const DEATH_VINYL_RAMP_PER_SEC = 1.0;
export const DEATH_VINYL_CUT_THRESHOLD = 0.01;
