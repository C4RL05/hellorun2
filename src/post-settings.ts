// Dev-only post-processing knob state. Lives as a JSON file at
// public/post-settings.json so the user can tune values in the dev
// panel, download the resulting file, and drop it back into the repo
// to ship. No localStorage — the repo's JSON is the single source of
// truth so changes are reviewable via git.
//
// Schema drift policy: on load, we shallow-merge the JSON with
// DEFAULT_POST_SETTINGS. Missing keys fall through to defaults; unknown
// keys are ignored. Adding a new field requires bumping DEFAULT_*.
//
// HDR feel-spec defaults (edge emissive, bloom, exposure) live in
// constants.ts per CLAUDE.md; this module re-exports them through
// DEFAULT_POST_SETTINGS so there's one source of truth. Color-grade
// uniforms start at neutral (identity) and are tuned only through the
// dev panel, so their defaults live here.

import {
  BLOOM_RADIUS,
  BLOOM_SMOOTHING,
  BLOOM_STRENGTH,
  BLOOM_THRESHOLD,
  EDGE_EMISSIVE_STRENGTH,
  HDR_EXPOSURE,
} from "./constants";

export interface PostBloomSettings {
  intensity: number;
  threshold: number;
  smoothing: number;
  radius: number;
}

export interface PostColorGradeSettings {
  contrast: number;
  contrastPivot: number;
  saturation: number;
  temperature: number;
  tint: number;
  temperatureStrength: number;
  lift: number;
  gamma: number;
  gain: number;
  blackLevel: number;
  whiteLevel: number;
  shadowTint: [number, number, number];
  highlightTint: [number, number, number];
  vignette: number;
  vignetteRadius: number;
  vignetteSoftness: number;
}

// Mirrors pmndrs ToneMappingMode. String keys keep the JSON readable
// and avoid depending on enum numeric values (which are an
// implementation detail of postprocessing's build).
export type ToneMappingName =
  | "linear"
  | "reinhard"
  | "reinhard2"
  | "reinhard2_adaptive"
  | "uncharted2"
  | "optimized_cineon"
  | "cineon"
  | "aces"
  | "agx"
  | "neutral";

export interface PostSettings {
  edgeEmissiveStrength: number;
  exposure: number;
  toneMapping: ToneMappingName;
  bloom: PostBloomSettings;
  colorGrade: PostColorGradeSettings;
}

// Initial values come from constants.ts (HDR feel-spec) + neutral
// color-grade defaults from docs/hdr-pipeline.md §4.4.
export const DEFAULT_POST_SETTINGS: PostSettings = {
  edgeEmissiveStrength: EDGE_EMISSIVE_STRENGTH,
  exposure: HDR_EXPOSURE,
  toneMapping: "aces",
  bloom: {
    intensity: BLOOM_STRENGTH,
    threshold: BLOOM_THRESHOLD,
    smoothing: BLOOM_SMOOTHING,
    radius: BLOOM_RADIUS,
  },
  colorGrade: {
    contrast: 1.0,
    contrastPivot: 0.5,
    saturation: 1.0,
    temperature: 0.0,
    tint: 0.0,
    temperatureStrength: 0.1,
    lift: 0.0,
    gamma: 1.0,
    gain: 1.0,
    blackLevel: 0.0,
    whiteLevel: 1.0,
    shadowTint: [1, 1, 1],
    highlightTint: [1, 1, 1],
    vignette: 0.0,
    vignetteRadius: 1.0,
    vignetteSoftness: 0.5,
  },
};

// Fetch /post-settings.json and merge into defaults. A missing file is
// the steady-state boot path before the user has ever saved — return
// defaults silently. Malformed JSON is a user error; log and fall
// through so the game still boots.
export async function loadPostSettings(): Promise<PostSettings> {
  try {
    const res = await fetch("/post-settings.json", { cache: "no-store" });
    if (!res.ok) return DEFAULT_POST_SETTINGS;
    const parsed = (await res.json()) as Partial<PostSettings>;
    return mergeSettings(parsed);
  } catch (err) {
    console.warn("Failed to load post-settings.json, using defaults:", err);
    return DEFAULT_POST_SETTINGS;
  }
}

// Shallow per-section merge: overlay caller-provided values on top of
// defaults so partial JSON (one slider changed) still loads.
function mergeSettings(partial: Partial<PostSettings>): PostSettings {
  return {
    edgeEmissiveStrength:
      partial.edgeEmissiveStrength ?? DEFAULT_POST_SETTINGS.edgeEmissiveStrength,
    exposure: partial.exposure ?? DEFAULT_POST_SETTINGS.exposure,
    toneMapping: partial.toneMapping ?? DEFAULT_POST_SETTINGS.toneMapping,
    bloom: { ...DEFAULT_POST_SETTINGS.bloom, ...(partial.bloom ?? {}) },
    colorGrade: {
      ...DEFAULT_POST_SETTINGS.colorGrade,
      ...(partial.colorGrade ?? {}),
    },
  };
}

export function serializePostSettings(s: PostSettings): string {
  return JSON.stringify(s, null, 2) + "\n";
}
