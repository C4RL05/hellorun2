import * as THREE from "three";
import { mulberry32 } from "../../chart";
import { cateye } from "./cateye";
import { spike } from "./spike";
import type { BuiltFixture, FixtureType } from "./shared";
import { pulseIntensity } from "./shared";

// Catalog of fixture types. Add a new type with two lines: import
// the module, append it here. Types are self-contained (see each
// type's own file) so ordering / removal is safe.
const CATALOG: ReadonlyArray<FixtureType<unknown>> = [cateye, spike];

// Runtime filter — lets the dev panel disable individual types. Null
// = all enabled (default); set = only these names can be picked. If
// the set is empty (all disabled), corridors get no fixtures.
let enabledFilter: ReadonlySet<string> | null = null;

export function setEnabledFixtureTypes(
  names: readonly string[] | null,
): void {
  enabledFilter = names === null ? null : new Set(names);
}

export function listCatalogTypeNames(): readonly string[] {
  return CATALOG.map((t) => t.name);
}

// Exposed for the rig editor — lets the panel introspect each
// type's ranges and log/describe params. Readonly at the array level;
// each type's .ranges record is still mutable (editor writes to it).
export function getCatalog(): ReadonlyArray<FixtureType<unknown>> {
  return CATALOG;
}

// Kind-level hash picks an integer in [MIN_TYPES, min(MAX_TYPES,
// CATALOG.length)] for each straight. Single-type catalog ⇒ every
// straight uses 1.
const MIN_TYPES = 1;
const MAX_TYPES = 3;

export type { PulsePattern } from "./shared";

export interface Fixture extends BuiltFixture {
  readonly typeName: string;
}

export interface RigSpec {
  readonly sets: ReadonlyArray<{
    readonly type: FixtureType<unknown>;
    readonly params: unknown;
  }>;
  // Joined list of per-type describe() outputs. Prebuilt at spec time
  // so the RAF entry detector just logs the string.
  readonly summary: string;
}

export function specForRig(
  kind: number | null,
  sectionKey: number,
  phraseIndex: number,
): RigSpec {
  const k = kind ?? -1;
  const baseKindSeed = (k + 1) * 131 + 7;
  const baseSectionSeed = baseKindSeed * 17 + Math.floor(sectionKey) * 73;
  const basePhraseBlockSeed =
    baseSectionSeed * 11 + Math.floor(phraseIndex / 2) * 97;

  const pool =
    enabledFilter === null
      ? CATALOG
      : CATALOG.filter((t) => enabledFilter!.has(t.name));
  if (pool.length === 0) {
    return { sets: [], summary: "(disabled)" };
  }

  const rngCount = mulberry32(baseKindSeed);
  const maxPossible = Math.min(MAX_TYPES, pool.length);
  const countRange = maxPossible - MIN_TYPES + 1;
  const count = MIN_TYPES + Math.floor(rngCount() * countRange);

  // Separate rng stream for type selection so the count pick doesn't
  // shift which types get picked for a given kind.
  const rngPick = mulberry32(baseKindSeed * 7);
  const picked = pickDistinct(pool, count, rngPick);

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

export function buildRig(
  spec: RigSpec,
  colorHex: number,
): ReadonlyArray<Fixture> {
  return spec.sets.map((s) => {
    const built = s.type.build(s.params, colorHex);
    return { ...built, typeName: s.type.name };
  });
}

// Editor-only: non-deterministic spec containing just the one named
// type. Used when the user wants to iterate on a single type in
// isolation — ignores the enabled-types filter (user is explicitly
// requesting this type via the editor selector) and the MIN/MAX type
// count (the spec always has exactly 1 set).
export function randomSingleSpec(typeName: string): RigSpec {
  const type = CATALOG.find((t) => t.name === typeName);
  if (!type) return { sets: [], summary: "(unknown type)" };
  const randSeed = (): number => Math.floor(Math.random() * 0x7fffffff);
  const params = type.specFor({
    kindSeed: randSeed(),
    sectionSeed: randSeed(),
    phraseBlockSeed: randSeed(),
  });
  return {
    sets: [{ type, params }],
    summary: type.describe(params),
  };
}

// Editor-only: non-deterministic spec generation. Bypasses the
// kind/section/phrase seed hierarchy — each call produces fresh
// random rolls, sampling each type's current ranges record. Used by
// the "Generate" button to show live range changes.
export function randomRigSpec(): RigSpec {
  const pool =
    enabledFilter === null
      ? CATALOG
      : CATALOG.filter((t) => enabledFilter!.has(t.name));
  if (pool.length === 0) return { sets: [], summary: "(disabled)" };

  const maxPossible = Math.min(MAX_TYPES, pool.length);
  const countRange = maxPossible - MIN_TYPES + 1;
  const count = MIN_TYPES + Math.floor(Math.random() * countRange);

  // Reuse each type's specFor by feeding it random seeds — types
  // read their mutable `ranges` record via randomInRange, so
  // fresh random seeds map to fresh random in-range values.
  const randSeed = (): number => Math.floor(Math.random() * 0x7fffffff);
  const picked: FixtureType<unknown>[] = [];
  const remaining = [...pool];
  for (let i = 0; i < count && remaining.length > 0; i++) {
    const idx = Math.floor(Math.random() * remaining.length);
    picked.push(remaining.splice(idx, 1)[0] as FixtureType<unknown>);
  }
  const sets = picked.map((type) => ({
    type,
    params: type.specFor({
      kindSeed: randSeed(),
      sectionSeed: randSeed(),
      phraseBlockSeed: randSeed(),
    }),
  }));
  const summary = sets.map((s) => s.type.describe(s.params)).join(" + ");
  return { sets, summary };
}

const registry: Fixture[] = [];

export function registerFixture(set: Fixture): void {
  registry.push(set);
}

export function unregisterFixture(set: Fixture): void {
  const i = registry.indexOf(set);
  if (i !== -1) registry.splice(i, 1);
}

export function clearFixtureRegistry(): void {
  registry.length = 0;
}

// Dispose GPU resources owned by a set. Call when removing from the
// scene (e.g., the editor's Generate replacing existing sets).
export function disposeFixture(set: Fixture): void {
  const mesh = set.object as THREE.Mesh;
  mesh.geometry?.dispose();
  set.material.dispose();
}

export function updateFixturePulses(
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
