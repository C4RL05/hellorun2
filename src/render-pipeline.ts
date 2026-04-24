import * as THREE from "three";
import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectComposer,
  EffectPass,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
} from "postprocessing";
import type { PostSettings, ToneMappingName } from "./post-settings";
import { setEdgeEmissiveStrength } from "./hdr-edges";

// HDR pipeline for the main game view. Reference: docs/hdr-pipeline.md.
//
// Pass order (priority ascending): Render → Bloom → Exposure → ACES tone
// map → ColorGrade. Bloom runs BEFORE exposure so BLOOM_THRESHOLD
// compares against raw scene luminance, not exposure-gained luminance —
// the two knobs stay decoupled. Exposure + tone map share one
// EffectPass so there's one fullscreen draw for the SDR compression
// step. ColorGrade is neutral by default and is kept as its own pass
// so the user can tweak it live from the dev panel.
//
// The returned composer.render() REPLACES renderer.render(scene, camera)
// in the main RAF. The debug-overlay pass (`renderer.render(scene,
// debugView.camera)` on layer 1) stays on the bare renderer and runs
// AFTER composer.render(), so debug bboxes never bloom.
export interface HdrPipeline {
  composer: EffectComposer;
  bloom: BloomEffect;
  exposure: ExposureEffect;
  toneMapping: ToneMappingEffect;
  colorGrade: ColorGradeEffect;
  setSize: (width: number, height: number) => void;
}

// Exposure as a one-line shader. renderer.toneMappingExposure is disabled
// by setting renderer.toneMapping = NoToneMapping, and pmndrs'
// ToneMappingEffect has no exposure uniform, so we do the HDR gain in a
// custom effect between Bloom and tone map. BlendFunction.SET replaces
// the input outright (no alpha blending) — standard for a pre-tone-map
// multiplier.
class ExposureEffect extends Effect {
  constructor(exposure: number) {
    super(
      "ExposureEffect",
      /* glsl */ `
        uniform float uExposure;
        void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
          outputColor = vec4(inputColor.rgb * uExposure, inputColor.a);
        }
      `,
      {
        blendFunction: BlendFunction.SET,
        uniforms: new Map([["uExposure", new THREE.Uniform(exposure)]]),
      },
    );
  }

  set exposure(value: number) {
    const u = this.uniforms.get("uExposure");
    if (u) u.value = value;
  }

  get exposure(): number {
    return (this.uniforms.get("uExposure")?.value as number) ?? 1.0;
  }
}

// Color grade pass from docs/hdr-pipeline.md §4.4. Neutral defaults are
// a no-op, so leaving it in the chain while untouched costs one
// fullscreen pass. Kept as its own effect (not fused with tone map)
// because the user will want to toggle and tweak it independently.
class ColorGradeEffect extends Effect {
  constructor(init: PostSettings["colorGrade"]) {
    super(
      "ColorGradeEffect",
      /* glsl */ `
        uniform float uContrast;
        uniform float uContrastPivot;
        uniform float uSaturation;
        uniform float uTemperature;
        uniform float uTint;
        uniform float uTemperatureStrength;
        uniform float uLift;
        uniform float uGamma;
        uniform float uGain;
        uniform float uBlackLevel;
        uniform float uWhiteLevel;
        uniform vec3  uShadowTint;
        uniform vec3  uHighlightTint;
        uniform float uVignette;
        uniform float uVignetteSoftness;
        uniform float uVignetteRadius;

        void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
          vec3 color = inputColor.rgb;

          color = color * uGain + vec3(uLift);
          color = (color - uContrastPivot) * uContrast + uContrastPivot;

          float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
          color = mix(vec3(lum), color, uSaturation);

          color.r += uTemperature * uTemperatureStrength;
          color.b -= uTemperature * uTemperatureStrength;
          color.g += uTint        * uTemperatureStrength;

          float lumForTint = dot(color, vec3(0.2126, 0.7152, 0.0722));
          vec3 shadowColor    = color * uShadowTint;
          vec3 highlightColor = color * uHighlightTint;
          color = mix(shadowColor, highlightColor, clamp(lumForTint, 0.0, 1.0));

          color = (color - uBlackLevel) / max(uWhiteLevel - uBlackLevel, 0.001);

          float gammaInv = 1.0 / max(uGamma, 0.01);
          color = pow(max(color, vec3(0.0)), vec3(gammaInv));

          vec2 vignetteCoord = uv - 0.5;
          float vignetteDist = length(vignetteCoord) * 2.0 / max(uVignetteRadius, 0.01);
          float vignetteMask = smoothstep(
            1.0 - uVignetteSoftness,
            1.0 + uVignetteSoftness,
            vignetteDist
          );
          color = mix(color, color * (1.0 - uVignette), vignetteMask);

          color = max(color, vec3(0.0));
          outputColor = vec4(color, inputColor.a);
        }
      `,
      {
        blendFunction: BlendFunction.SET,
        uniforms: new Map<string, THREE.Uniform>([
          ["uContrast",            new THREE.Uniform(init.contrast)],
          ["uContrastPivot",       new THREE.Uniform(init.contrastPivot)],
          ["uSaturation",          new THREE.Uniform(init.saturation)],
          ["uTemperature",         new THREE.Uniform(init.temperature)],
          ["uTint",                new THREE.Uniform(init.tint)],
          ["uTemperatureStrength", new THREE.Uniform(init.temperatureStrength)],
          ["uLift",                new THREE.Uniform(init.lift)],
          ["uGamma",               new THREE.Uniform(init.gamma)],
          ["uGain",                new THREE.Uniform(init.gain)],
          ["uBlackLevel",          new THREE.Uniform(init.blackLevel)],
          ["uWhiteLevel",          new THREE.Uniform(init.whiteLevel)],
          ["uShadowTint",          new THREE.Uniform(new THREE.Vector3(...init.shadowTint))],
          ["uHighlightTint",       new THREE.Uniform(new THREE.Vector3(...init.highlightTint))],
          ["uVignette",            new THREE.Uniform(init.vignette)],
          ["uVignetteSoftness",    new THREE.Uniform(init.vignetteSoftness)],
          ["uVignetteRadius",      new THREE.Uniform(init.vignetteRadius)],
        ]),
      },
    );
  }

  setScalar(name: string, value: number): void {
    const u = this.uniforms.get(name);
    if (u) u.value = value;
  }

  setVec3(name: string, value: [number, number, number]): void {
    const u = this.uniforms.get(name);
    if (u && u.value instanceof THREE.Vector3) u.value.set(...value);
  }
}

const TONE_MAPPING_MODE: Record<ToneMappingName, ToneMappingMode> = {
  linear: ToneMappingMode.LINEAR,
  reinhard: ToneMappingMode.REINHARD,
  reinhard2: ToneMappingMode.REINHARD2,
  reinhard2_adaptive: ToneMappingMode.REINHARD2_ADAPTIVE,
  uncharted2: ToneMappingMode.UNCHARTED2,
  optimized_cineon: ToneMappingMode.OPTIMIZED_CINEON,
  cineon: ToneMappingMode.CINEON,
  aces: ToneMappingMode.ACES_FILMIC,
  agx: ToneMappingMode.AGX,
  neutral: ToneMappingMode.NEUTRAL,
};

export function createHdrPipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  settings: PostSettings,
): HdrPipeline {
  // Tone mapping must happen in the post chain, not the renderer — else
  // we double-tone-map and the image goes muddy. setClearColor stays on
  // the renderer; HalfFloatType lets emissive values > 1.0 survive
  // between passes so the bloom threshold can find them.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.0;

  const composer = new EffectComposer(renderer, {
    frameBufferType: THREE.HalfFloatType,
  });
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new BloomEffect({
    intensity: settings.bloom.intensity,
    luminanceThreshold: settings.bloom.threshold,
    luminanceSmoothing: settings.bloom.smoothing,
    radius: settings.bloom.radius,
    // levels + mipmapBlur are init-only — changing them requires
    // rebuilding the pass. Fix at the hdr-pipeline.md defaults.
    levels: 8,
    mipmapBlur: true,
  });
  composer.addPass(new EffectPass(camera, bloom));

  const exposure = new ExposureEffect(settings.exposure);
  const toneMapping = new ToneMappingEffect({
    mode: TONE_MAPPING_MODE[settings.toneMapping],
  });
  composer.addPass(new EffectPass(camera, exposure, toneMapping));

  const colorGrade = new ColorGradeEffect(settings.colorGrade);
  composer.addPass(new EffectPass(camera, colorGrade));

  return {
    composer,
    bloom,
    exposure,
    toneMapping,
    colorGrade,
    setSize: (width, height) => composer.setSize(width, height),
  };
}

// Apply a new settings object to a live pipeline. Safe to call per
// keystroke from the Post settings panel — each field maps to a
// cheap property/uniform write.
export function applyPostSettings(
  pipeline: HdrPipeline,
  s: PostSettings,
): void {
  setEdgeEmissiveStrength(s.edgeEmissiveStrength);

  pipeline.exposure.exposure = s.exposure;
  pipeline.toneMapping.mode = TONE_MAPPING_MODE[s.toneMapping];

  pipeline.bloom.intensity = s.bloom.intensity;
  pipeline.bloom.luminanceMaterial.threshold = s.bloom.threshold;
  pipeline.bloom.luminanceMaterial.smoothing = s.bloom.smoothing;
  pipeline.bloom.mipmapBlurPass.radius = s.bloom.radius;

  const g = s.colorGrade;
  pipeline.colorGrade.setScalar("uContrast", g.contrast);
  pipeline.colorGrade.setScalar("uContrastPivot", g.contrastPivot);
  pipeline.colorGrade.setScalar("uSaturation", g.saturation);
  pipeline.colorGrade.setScalar("uTemperature", g.temperature);
  pipeline.colorGrade.setScalar("uTint", g.tint);
  pipeline.colorGrade.setScalar("uTemperatureStrength", g.temperatureStrength);
  pipeline.colorGrade.setScalar("uLift", g.lift);
  pipeline.colorGrade.setScalar("uGamma", g.gamma);
  pipeline.colorGrade.setScalar("uGain", g.gain);
  pipeline.colorGrade.setScalar("uBlackLevel", g.blackLevel);
  pipeline.colorGrade.setScalar("uWhiteLevel", g.whiteLevel);
  pipeline.colorGrade.setScalar("uVignette", g.vignette);
  pipeline.colorGrade.setScalar("uVignetteSoftness", g.vignetteSoftness);
  pipeline.colorGrade.setScalar("uVignetteRadius", g.vignetteRadius);
  pipeline.colorGrade.setVec3("uShadowTint", g.shadowTint);
  pipeline.colorGrade.setVec3("uHighlightTint", g.highlightTint);
}
