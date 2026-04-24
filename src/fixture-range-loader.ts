import { getCatalog } from "./scene/fixtures";

// Boot-time loader for fixture parameter ranges. Each type in the
// catalog has a mutable `ranges` record (default values baked in its
// own module); this fetcher overlays whatever the repo ships at
// public/setup/<name>.json, so tuning happens in JSON without
// touching the code.
//
// Per-type JSON format:
//   { "paramName": { "min": N, "max": N }, ... }
// Unknown keys are ignored; keys not present in the JSON keep their
// code-default. Malformed entries are skipped silently (no crash).

export async function loadRigRanges(): Promise<void> {
  await Promise.all(
    getCatalog().map(async (type) => {
      try {
        const res = await fetch(`/setup/${type.name}.json`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = (await res.json()) as Record<string, unknown>;
        for (const key of Object.keys(data)) {
          const entry = data[key];
          if (
            entry !== null &&
            typeof entry === "object" &&
            "min" in entry &&
            "max" in entry &&
            typeof (entry as { min: unknown }).min === "number" &&
            typeof (entry as { max: unknown }).max === "number"
          ) {
            type.ranges[key] = {
              min: (entry as { min: number }).min,
              max: (entry as { max: number }).max,
            };
          }
        }
      } catch {
        // Missing file / malformed JSON / network error: fall back to
        // code defaults silently. Not worth surfacing — this is a
        // dev-time tuning feature, and absence just means "use code".
      }
    }),
  );
}
