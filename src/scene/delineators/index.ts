import { mulberry32 } from "../../chart";
import { cateye } from "./cateye";
import type { BuiltDelineators, DelineatorType } from "./shared";
import { pulseIntensity } from "./shared";

// Catalog of delineator types. Add a new type with two lines: import
// the module, append it here. Types are self-contained (see each
// type's own file) so ordering / removal is safe.
const CATALOG: ReadonlyArray<DelineatorType<unknown>> = [cateye];

// Kind-level hash picks an integer in [MIN_TYPES, min(MAX_TYPES,
// CATALOG.length)] for each straight. Single-type catalog ⇒ every
// straight uses 1.
const MIN_TYPES = 1;
const MAX_TYPES = 3;

export type { PulsePattern } from "./shared";

export interface DelineatorSet extends BuiltDelineators {
  readonly typeName: string;
}

export interface DelineatorMultiSpec {
  readonly sets: ReadonlyArray<{
    readonly type: DelineatorType<unknown>;
    readonly params: unknown;
  }>;
  // Joined list of per-type describe() outputs. Prebuilt at spec time
  // so the RAF entry detector just logs the string.
  readonly summary: string;
}

export function specForDelineators(
  kind: number | null,
  sectionKey: number,
  phraseIndex: number,
): DelineatorMultiSpec {
  const k = kind ?? -1;
  const baseKindSeed = (k + 1) * 131 + 7;
  const baseSectionSeed = baseKindSeed * 17 + Math.floor(sectionKey) * 73;
  const basePhraseBlockSeed =
    baseSectionSeed * 11 + Math.floor(phraseIndex / 2) * 97;

  const rngCount = mulberry32(baseKindSeed);
  const maxPossible = Math.min(MAX_TYPES, CATALOG.length);
  const countRange = maxPossible - MIN_TYPES + 1;
  const count = MIN_TYPES + Math.floor(rngCount() * countRange);

  // Separate rng stream for type selection so the count pick doesn't
  // shift which types get picked for a given kind.
  const rngPick = mulberry32(baseKindSeed * 7);
  const picked = pickDistinct(CATALOG, count, rngPick);

  // Salt each picked type's seeds with its name so two types in the
  // same straight don't roll identical params from identical seeds.
  const sets = picked.map((type) => {
    const salt = hashName(type.name);
    const params = type.specFor({
      kindSeed: baseKindSeed ^ salt,
      sectionSeed: baseSectionSeed ^ salt,
      phraseBlockSeed: basePhraseBlockSeed ^ salt,
    });
    return { type, params };
  });

  const summary = sets.map((s) => s.type.describe(s.params)).join(" + ");
  return { sets, summary };
}

export function createDelineatorsFromSpec(
  spec: DelineatorMultiSpec,
  colorHex: number,
): ReadonlyArray<DelineatorSet> {
  return spec.sets.map((s) => {
    const built = s.type.build(s.params, colorHex);
    return { ...built, typeName: s.type.name };
  });
}

const registry: DelineatorSet[] = [];

export function registerDelineatorSet(set: DelineatorSet): void {
  registry.push(set);
}

export function clearDelineatorRegistry(): void {
  registry.length = 0;
}

export function updateDelineatorPulses(
  beatPhase: number,
  barPhase: number,
  phrasePhase: number,
): void {
  for (const set of registry) {
    // Steady sets never change color after build — skip the write.
    if (set.pulse === "steady") continue;
    const strength = pulseIntensity(
      set.pulse,
      beatPhase,
      barPhase,
      phrasePhase,
    );
    set.material.color.setHex(set.baseHex);
    set.material.color.multiplyScalar(strength);
  }
}

function pickDistinct<T>(
  arr: ReadonlyArray<T>,
  count: number,
  rng: () => number,
): T[] {
  const pool = [...arr];
  const out: T[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const idx = Math.floor(rng() * pool.length);
    out.push(pool.splice(idx, 1)[0] as T);
  }
  return out;
}

// djb2 over a string, folded to 32-bit int. Deterministic salt so two
// types picked for the same straight get independent param rolls.
function hashName(name: string): number {
  let h = 5381;
  for (let i = 0; i < name.length; i++) {
    h = ((h << 5) + h + name.charCodeAt(i)) | 0;
  }
  return h;
}
