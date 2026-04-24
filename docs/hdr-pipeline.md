# HDR Pipeline — "High in the Moment" look

A self-contained reference for replicating the reference project's HDR rendering pipeline in another Three.js project. Captures the exact effect stack, values, pass ordering, and custom shader code used by the `high-in-the-moment` composition so the same look can be reproduced outside this codebase.

The look depends on four things working together:

1. **A truly HDR render target** (half-float framebuffer + `NoToneMapping` on the renderer).
2. **Emissive values above 1.0** baked into material output to push pixels past the bloom threshold.
3. **A fixed pass order** where bloom extracts HDR brights BEFORE exposure, tone mapping, and color grade.
4. **ACES Filmic tone mapping** as the HDR→SDR compression.

---

## 1. Renderer and composer setup

Three.js' built-in tone mapper and pmndrs' `ToneMappingEffect` must not both run. This project does tone mapping in the post chain, so the renderer is explicitly set to `NoToneMapping`. The `EffectComposer` uses a `HalfFloatType` framebuffer — this is what keeps values above 1.0 from clipping between passes.

```js
import * as THREE from 'three'
import { EffectComposer, RenderPass } from 'postprocessing'

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setClearColor(0x000000, 1)

// Critical: tone mapping happens in the post chain, not here.
renderer.toneMapping = THREE.NoToneMapping
renderer.toneMappingExposure = 1.0

// Critical: half-float so color values > 1.0 survive between passes.
const composer = new EffectComposer(renderer, {
  frameBufferType: THREE.HalfFloatType,
})
composer.addPass(new RenderPass(scene, camera))
```

Output color space is left at the Three.js default (`SRGBColorSpace` on the renderer output). pmndrs' `EffectComposer` handles the linear→sRGB conversion on its final write, so no `OutputPass` is needed.

Source of this setup: `src/core/VisualEngine.js:87-131`.

---

## 2. Pass order

the reference project assigns each post-effect a fixed priority; lower runs first. The subset active in `high-in-the-moment` is:

| #   | Pass             | Priority | Library                      | Role                                  |
| --- | ---------------- | -------- | ---------------------------- | ------------------------------------- |
| 1   | `RenderPass`     | implicit | pmndrs                       | Scene render into HDR buffer          |
| 2   | SSR (+ temporal) | 30 / 40  | custom `SSREffect`           | Screen-space reflections (optional)   |
| 3   | **Bloom**        | 90       | `BloomEffect` (pmndrs)       | Extract + blur values above threshold |
| 4   | **Exposure**     | 100      | custom `ExposureEffect`      | HDR multiplier before tone map        |
| 5   | **Tone Map**     | 110      | `ToneMappingEffect` (pmndrs) | HDR → SDR (ACES Filmic)               |
| 6   | **Color Grade**  | 120      | custom `ColorGradeEffect`    | Final look (contrast/sat/lift/etc.)   |

Why bloom runs before exposure: the bloom `threshold` is compared against the raw scene colors. Moving exposure earlier would change which pixels bloom whenever exposure changed, coupling the two sliders. With this order, exposure is a pure brightness dial.

Source of priorities: `src/content/handlers/PostProcessHandler.js:42-57`.

---

## 3. Emissive as the HDR driver

Materials in the reference project output `final_rgb = color * intensity * uEmissive`. Values of `uEmissive > 1.0` produce HDR pixels — they have no visible effect in the raw render because the display can only show up to 1.0, but they *do* cross the bloom `threshold` of 1.0 and get extracted as bloom.

Minimal reproduction in a vanilla Three.js material:

```js
// ShaderMaterial equivalent — note the output can exceed 1.0
const material = new THREE.ShaderMaterial({
  uniforms: {
    uColor:    { value: new THREE.Color(0xff00ff) },
    uEmissive: { value: 2.0 },   // "high in the moment" uses 2.0
  },
  fragmentShader: /* glsl */`
    uniform vec3  uColor;
    uniform float uEmissive;
    void main() {
      gl_FragColor = vec4(uColor * uEmissive, 1.0);
    }
  `,
})
```

The actual reference in this project is `public/shaders/features/color_frag.glsl:177-181`:

```glsl
// Apply emissive intensity (for HDR bloom)
// Values > 1.0 push pixels above bloom threshold
vec3 applyEmissive(vec3 color) {
  if (uColorEnabled < 0.5) return color;
  return color * uEmissive;
}
```

If you use Three.js' `MeshStandardMaterial` instead, the equivalent is `emissive` color × `emissiveIntensity` — setting `emissiveIntensity = 2.0` on an emissive-colored material produces the same effect.

In `high-in-the-moment`, nearly every visible clip sets `emissive: 2` in its param overrides (`public/compositions/high-in-the-moment.json:284`, 368, and many more).

---

## 4. The effects, with exact values

### 4.1 Bloom (pmndrs `BloomEffect`)

pmndrs bloom is a multi-level mipmap blur applied to pixels whose luminance exceeds `threshold`, mixed back additively.

```js
import { EffectPass, BloomEffect } from 'postprocessing'

const bloom = new BloomEffect({
  intensity:           0.5,  // "strength" in the composition
  luminanceThreshold:  1.0,  // "threshold"
  luminanceSmoothing:  0.03, // default from bloom.json
  radius:              0.5,  // "radius"
  levels:              8,    // mip levels for blur quality
  mipmapBlur:          true, // required for `levels`/`radius` to work
})
composer.addPass(new EffectPass(camera, bloom))
```

**Values from `high-in-the-moment.json:199-205`:**

| Param       | Value                              |
| ----------- | ---------------------------------- |
| `strength`  | `0.5`                              |
| `threshold` | `1.0`                              |
| `radius`    | `0.5`                              |
| `smoothing` | `0.03` *(default, not overridden)* |
| `levels`    | `8` *(default, not overridden)*    |

The key number is `threshold: 1.0`. Any pixel whose luminance is ≤ 1.0 contributes zero bloom; only the HDR range (above SDR white) blooms. Combined with `emissive: 2`, an emissive pixel at base color `(1, 0, 1)` becomes `(2, 0, 2)` — luminance ~0.85, so even magenta at emissive=2 is *just* above threshold and blooms softly. Pure white at emissive=2 becomes luminance 2.0, and the bloom bite is hard.

Defaults reference: `public/content/post/bloom.json`.

### 4.2 Exposure (custom `ExposureEffect`)

A one-line shader that multiplies the HDR buffer before tone mapping.

```js
// ExposureEffect.js
import { Uniform } from 'three'
import { Effect, BlendFunction } from 'postprocessing'

const fragmentShader = /* glsl */`
  uniform float uExposure;
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    outputColor = vec4(inputColor.rgb * uExposure, inputColor.a);
  }
`

export class ExposureEffect extends Effect {
  constructor() {
    super('ExposureEffect', fragmentShader, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map([['uExposure', new Uniform(1.0)]]),
    })
  }
}
```

Wiring:

```js
import { EffectPass } from 'postprocessing'
const exposure = new ExposureEffect()
exposure.uniforms.get('uExposure').value = 2.0
composer.addPass(new EffectPass(camera, exposure))
```

**Value from `high-in-the-moment.json:192-196`:**

| Param      | Value |
| ---------- | ----- |
| `exposure` | `2.0` |

Source: `src/postprocessing/ExposureEffect.js`.

> Why a custom effect and not `renderer.toneMappingExposure`? Because the renderer's exposure multiplies only during its tone-map step, which is disabled here. And pmndrs' `ToneMappingEffect` doesn't expose an exposure knob. A 12-line custom pass is the cleanest place to put the HDR gain.

### 4.3 Tone Mapping — ACES Filmic (pmndrs `ToneMappingEffect`)

```js
import { EffectPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing'

const toneMapping = new ToneMappingEffect({
  mode: ToneMappingMode.ACES_FILMIC,
})
composer.addPass(new EffectPass(camera, toneMapping))
```

**Value from `high-in-the-moment.json:208-213`:**

| Param         | Value    |
| ------------- | -------- |
| `toneMapping` | `"aces"` |

The string→enum mapping used by the reference project (`src/content/handlers/PostProcessHandler.js:26-33`):

```js
const TONE_MAPPING_MODE = {
  linear:   ToneMappingMode.LINEAR,
  reinhard: ToneMappingMode.REINHARD,
  cineon:   ToneMappingMode.CINEON,
  aces:     ToneMappingMode.ACES_FILMIC,
  agx:      ToneMappingMode.AGX,
  neutral:  ToneMappingMode.NEUTRAL,
}
```

ACES Filmic is the right default for a saturated neon look: it crushes shadows gently and rolls off bright saturated colors into white, so emissive bloom centers bleach cleanly instead of clipping to a primary.

### 4.4 Color Grade (custom `ColorGradeEffect`)

In `high-in-the-moment` this pass is **present but fully neutral** (`paramOverrides: {}`), so all uniforms keep their defaults and the pass is effectively a no-op. It is included so the composition can be tweaked live without re-adding the effect.

The full shader, which you can drop into any Three.js project verbatim:

```glsl
// ColorGradeEffect fragment shader
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

  // 1. Lift / Gain (shadow offset + highlight multiplier)
  color = color * uGain + vec3(uLift);

  // 2. Contrast around pivot
  color = (color - uContrastPivot) * uContrast + uContrastPivot;

  // 3. Saturation (Rec.709 luma)
  float lum = dot(color, vec3(0.2126, 0.7152, 0.0722));
  color = mix(vec3(lum), color, uSaturation);

  // 4. Temperature (R/B) and Tint (G)
  color.r += uTemperature * uTemperatureStrength;
  color.b -= uTemperature * uTemperatureStrength;
  color.g += uTint        * uTemperatureStrength;

  // 5. Shadow/Highlight tint (luminance-weighted)
  float lumForTint = dot(color, vec3(0.2126, 0.7152, 0.0722));
  vec3 shadowColor    = color * uShadowTint;
  vec3 highlightColor = color * uHighlightTint;
  color = mix(shadowColor, highlightColor, clamp(lumForTint, 0.0, 1.0));

  // 6. Levels (black/white point)
  color = (color - uBlackLevel) / max(uWhiteLevel - uBlackLevel, 0.001);

  // 7. Gamma
  float gammaInv = 1.0 / max(uGamma, 0.01);
  color = pow(max(color, vec3(0.0)), vec3(gammaInv));

  // 8. Vignette
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
```

**Neutral defaults (the values in `high-in-the-moment`):**

| Uniform                | Value       |
| ---------------------- | ----------- |
| `uContrast`            | `1.0`       |
| `uContrastPivot`       | `0.5`       |
| `uSaturation`          | `1.0`       |
| `uTemperature`         | `0.0`       |
| `uTint`                | `0.0`       |
| `uTemperatureStrength` | `0.1`       |
| `uLift`                | `0.0`       |
| `uGamma`               | `1.0`       |
| `uGain`                | `1.0`       |
| `uBlackLevel`          | `0.0`       |
| `uWhiteLevel`          | `1.0`       |
| `uShadowTint`          | `(1, 1, 1)` |
| `uHighlightTint`       | `(1, 1, 1)` |
| `uVignette`            | `0.0`       |
| `uVignetteRadius`      | `1.0`       |
| `uVignetteSoftness`    | `0.5`       |

If you don't need a tweakable grade, you can omit this pass entirely — the output is identical.

Source: `src/postprocessing/ColorGradeEffect.js`, defaults in `public/content/post/color-grade.json`.

---

## 5. Full standalone setup (copy-pasteable)

```js
import * as THREE from 'three'
import {
  EffectComposer,
  RenderPass,
  EffectPass,
  BloomEffect,
  ToneMappingEffect,
  ToneMappingMode,
  Effect,
  BlendFunction,
} from 'postprocessing'
import { Uniform } from 'three'

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.toneMapping = THREE.NoToneMapping        // tone map in the post chain
renderer.toneMappingExposure = 1.0

// --- Composer in half-float HDR ---
const composer = new EffectComposer(renderer, {
  frameBufferType: THREE.HalfFloatType,
})
composer.addPass(new RenderPass(scene, camera))

// --- Bloom (priority 90) ---
composer.addPass(new EffectPass(camera, new BloomEffect({
  intensity:          0.5,
  luminanceThreshold: 1.0,
  luminanceSmoothing: 0.03,
  radius:             0.5,
  levels:             8,
  mipmapBlur:         true,
})))

// --- Exposure (priority 100) ---
class ExposureEffect extends Effect {
  constructor(exposure = 2.0) {
    super('ExposureEffect',
      /* glsl */`
        uniform float uExposure;
        void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
          outputColor = vec4(inputColor.rgb * uExposure, inputColor.a);
        }
      `,
      {
        blendFunction: BlendFunction.SET,
        uniforms: new Map([['uExposure', new Uniform(exposure)]]),
      })
  }
}
composer.addPass(new EffectPass(camera, new ExposureEffect(2.0)))

// --- Tone mapping (priority 110) ---
composer.addPass(new EffectPass(camera,
  new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })
))

// --- Color grade (priority 120, neutral) ---
// Omit entirely unless you want live grading — defaults are a no-op.

// --- Render ---
function animate() {
  requestAnimationFrame(animate)
  composer.render()
}
animate()
```

For emissive materials, use `MeshStandardMaterial` with `emissiveIntensity` above 1.0, or a custom `ShaderMaterial` that outputs `color * emissive` with `emissive > 1.0`. Either way, the HDR buffer will carry those >1.0 values through to bloom.

---

## 6. What NOT to do (common mistakes)

- **Forgetting `HalfFloatType`.** Without it, color values clamp to 1.0 between passes — bloom threshold=1.0 will extract almost nothing.
- **Leaving `renderer.toneMapping = ACESFilmicToneMapping`.** You'll double tone-map and the image will look muddy/desaturated.
- **Putting bloom after tone mapping.** Bloom then extracts post-compression values — the threshold stops meaning "HDR ceiling" and the look becomes hazy/foggy instead of neon.
- **Baking exposure into the material.** If you raise emissive to "fake" exposure, you push pixels past the bloom threshold unevenly. Keep emissive for authoring what glows; use the exposure pass for overall brightness.
- **Using an `OutputPass`.** pmndrs' `EffectComposer` already handles the final linear→sRGB write.

---

## 7. Source references

| Concept                     | File                                                  |
| --------------------------- | ----------------------------------------------------- |
| Renderer + composer setup   | `src/core/VisualEngine.js:87-131`                     |
| Pass priority table         | `src/content/handlers/PostProcessHandler.js:42-57`    |
| Bloom wiring                | `src/content/handlers/PostProcessHandler.js:146-168`  |
| Exposure effect             | `src/postprocessing/ExposureEffect.js`                |
| Tone mapping mode map       | `src/content/handlers/PostProcessHandler.js:26-33`    |
| Color grade shader          | `src/postprocessing/ColorGradeEffect.js`              |
| Emissive→bloom contract     | `public/shaders/features/color_frag.glsl:177-190`     |
| Composition (effect values) | `public/compositions/high-in-the-moment.json:191-226` |
| Bloom defaults/presets      | `public/content/post/bloom.json`                      |
| Color grade presets         | `public/content/post/color-grade.json`                |
