// Procedural chart generation (plan §7 milestone 7).
//
// A "phrase" is a 3-gate sequence through vertical space — the atom of
// chart composition. The full chart for N gates is built by concatenating
// phrases, obeying:
//
//   - First-phrase spawn-safety: phrase[0].slots[0] === 1 (player spawns
//     at mid, can't react to gate 0 in time if it's at top/bottom).
//   - Corner continuity (plan §2): gate 1 of each subsequent phrase lies
//     within one slot of the previous phrase's last gate — the player
//     doesn't have to traverse two slots in the time between phrases.
//
// Difficulty tiers 1–4 rate phrases by how many / how large the vertical
// transitions are; the generator's `maxDifficulty` caps what phrases it
// will pick from (wired from audio-section energy at milestone 9).

export interface Phrase {
  readonly slots: readonly number[];
  readonly difficulty: number;
}

// Slot values: 0 = bottom, 1 = mid, 2 = top.
export const PHRASES: readonly Phrase[] = [
  // D=1: no or minimal transitions. Recovery / breathing-room phrases.
  { slots: [1, 1, 1], difficulty: 1 },
  { slots: [0, 0, 1], difficulty: 1 },
  { slots: [2, 2, 1], difficulty: 1 },
  { slots: [1, 0, 0], difficulty: 1 },
  { slots: [1, 2, 2], difficulty: 1 },
  // D=2: one-step transitions or held extremes.
  { slots: [0, 1, 2], difficulty: 2 },
  { slots: [2, 1, 0], difficulty: 2 },
  { slots: [1, 0, 1], difficulty: 2 },
  { slots: [1, 2, 1], difficulty: 2 },
  { slots: [0, 0, 0], difficulty: 2 },
  { slots: [2, 2, 2], difficulty: 2 },
  // D=3: single two-slot jump.
  { slots: [0, 0, 2], difficulty: 3 },
  { slots: [2, 2, 0], difficulty: 3 },
  { slots: [1, 0, 2], difficulty: 3 },
  { slots: [1, 2, 0], difficulty: 3 },
  { slots: [0, 2, 1], difficulty: 3 },
  { slots: [2, 0, 1], difficulty: 3 },
  // D=4: alternating extremes — full bounces within the phrase.
  { slots: [0, 2, 0], difficulty: 4 },
  { slots: [2, 0, 2], difficulty: 4 },
];

export interface GenerateOptions {
  readonly maxDifficulty?: number;
  // Explicit PRNG for deterministic charts in tests. Defaults to
  // Math.random for fresh procedural output every page load.
  readonly rand?: () => number;
}

// Builds a chart of `gateCount` slot indices by concatenating phrases.
export function generateChart(
  gateCount: number,
  options: GenerateOptions = {},
): number[] {
  const maxDifficulty = options.maxDifficulty ?? 4;
  const rand = options.rand ?? Math.random;

  const out: number[] = [];
  let prevEndSlot = 1;
  let isFirst = true;

  while (out.length < gateCount) {
    const phrase = isFirst
      ? pickFirstPhrase(maxDifficulty, rand)
      : pickContinuationPhrase(prevEndSlot, maxDifficulty, rand);
    for (const s of phrase.slots) {
      if (out.length >= gateCount) break;
      out.push(s);
    }
    prevEndSlot = phrase.slots[phrase.slots.length - 1];
    isFirst = false;
  }
  return out;
}

// First phrase must start at slot 1 so the player, spawning at y=0,
// doesn't have to react to an off-center gate before moving.
function pickFirstPhrase(maxDifficulty: number, rand: () => number): Phrase {
  const candidates = PHRASES.filter(
    (p) => p.slots[0] === 1 && p.difficulty <= maxDifficulty,
  );
  return pickRandom(candidates, rand);
}

function pickContinuationPhrase(
  prevEndSlot: number,
  maxDifficulty: number,
  rand: () => number,
): Phrase {
  const candidates = PHRASES.filter(
    (p) =>
      p.difficulty <= maxDifficulty &&
      Math.abs(p.slots[0] - prevEndSlot) <= 1,
  );
  // Our vocabulary has phrases starting with every slot, so the
  // difficulty+continuity filter always has candidates. Falls back to the
  // continuity-only filter if someone picks a maxDifficulty too strict.
  if (candidates.length > 0) return pickRandom(candidates, rand);
  return pickRandom(
    PHRASES.filter((p) => Math.abs(p.slots[0] - prevEndSlot) <= 1),
    rand,
  );
}

function pickRandom<T>(xs: readonly T[], rand: () => number): T {
  return xs[Math.floor(rand() * xs.length)];
}

// Seeded PRNG (mulberry32). Tests pass { rand: mulberry32(seed) } to get
// deterministic chart output.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
