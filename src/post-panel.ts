import type { PostSettings, ToneMappingName } from "./post-settings";
import {
  DEFAULT_POST_SETTINGS,
  loadPostSettings,
  serializePostSettings,
} from "./post-settings";
import type { HdrPipeline } from "./render-pipeline";
import { applyPostSettings } from "./render-pipeline";

// Dev-only Post panel. Schema-driven form that mutates a live
// PostSettings object + calls applyPostSettings on every input event.
// Nothing here persists to localStorage — the download button is the
// only way to checkpoint state. Ship the downloaded JSON by replacing
// public/post-settings.json.

const TONE_MAPPING_OPTIONS: readonly ToneMappingName[] = [
  "linear",
  "reinhard",
  "reinhard2",
  "reinhard2_adaptive",
  "uncharted2",
  "optimized_cineon",
  "cineon",
  "aces",
  "agx",
  "neutral",
];

export function mountPostPanel(
  container: HTMLElement,
  settings: PostSettings,
  pipeline: HdrPipeline,
): void {
  container.innerHTML = "";
  container.classList.add("post-panel");

  const update = (): void => applyPostSettings(pipeline, settings);

  // Builds the <button>< ·input· >button> trio inline. Shared by the
  // standalone number row and the vec3 row's 3-channel inputs.
  const numberStepper = (
    get: () => number,
    set: (v: number) => void,
    min: number | undefined,
    max: number | undefined,
    step: number,
  ): HTMLDivElement => {
    const wrap = document.createElement("div");
    wrap.className = "post-number";
    const prec = decimalsOf(step);

    const input = document.createElement("input");
    input.type = "number";
    if (min !== undefined) input.min = String(min);
    if (max !== undefined) input.max = String(max);
    input.step = String(step);
    input.value = String(get());
    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      if (!Number.isFinite(v)) return;
      set(v);
      update();
    });

    const stepBy = (delta: number): void => {
      let next = parseFloat((get() + delta).toFixed(prec));
      if (min !== undefined) next = Math.max(min, next);
      if (max !== undefined) next = Math.min(max, next);
      set(next);
      input.value = String(next);
      update();
    };

    const dec = document.createElement("button");
    dec.type = "button";
    dec.className = "post-step";
    dec.setAttribute("aria-label", "decrement");
    dec.textContent = "<";
    dec.addEventListener("click", () => stepBy(-step));

    const inc = document.createElement("button");
    inc.type = "button";
    inc.className = "post-step";
    inc.setAttribute("aria-label", "increment");
    inc.textContent = ">";
    inc.addEventListener("click", () => stepBy(step));

    wrap.append(input, dec, inc);
    return wrap;
  };

  // vec3 channels are space-constrained — three inputs sharing one row
  // don't have room for chevron steppers, so use a bare input inside the
  // same .post-number wrapper (keeps the border + focus-within styling).
  const rawNumberInput = (
    get: () => number,
    set: (v: number) => void,
    step: number,
  ): HTMLDivElement => {
    const wrap = document.createElement("div");
    wrap.className = "post-number";
    const input = document.createElement("input");
    input.type = "number";
    input.step = String(step);
    input.value = String(get());
    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      if (!Number.isFinite(v)) return;
      set(v);
      update();
    });
    wrap.append(input);
    return wrap;
  };

  const numberRow = (
    label: string,
    get: () => number,
    set: (v: number) => void,
    min?: number,
    max?: number,
    step = 0.01,
  ): HTMLDivElement => {
    const row = document.createElement("div");
    row.className = "post-row";
    const lab = document.createElement("label");
    lab.textContent = label;
    row.append(lab, numberStepper(get, set, min, max, step));
    return row;
  };

  const selectRow = <T extends string>(
    label: string,
    options: readonly T[],
    get: () => T,
    set: (v: T) => void,
  ): HTMLDivElement => {
    const row = document.createElement("div");
    row.className = "post-row";
    const lab = document.createElement("label");
    lab.textContent = label;
    const sel = document.createElement("select");
    for (const opt of options) {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      sel.append(o);
    }
    sel.value = get();
    sel.addEventListener("change", () => {
      set(sel.value as T);
      update();
    });
    row.append(lab, sel);
    return row;
  };

  const vec3Row = (
    label: string,
    get: () => [number, number, number],
    set: (v: [number, number, number]) => void,
    step = 0.01,
  ): HTMLDivElement => {
    const row = document.createElement("div");
    row.className = "post-row";
    const lab = document.createElement("label");
    lab.textContent = label;
    row.append(lab);
    const triplet = document.createElement("div");
    triplet.className = "post-vec3";
    for (let i = 0; i < 3; i++) {
      const channelGet = (): number => get()[i];
      const channelSet = (v: number): void => {
        const cur = get();
        const next: [number, number, number] = [cur[0], cur[1], cur[2]];
        next[i] = v;
        set(next);
      };
      triplet.append(rawNumberInput(channelGet, channelSet, step));
    }
    row.append(triplet);
    return row;
  };

  const header = (text: string): HTMLDivElement => {
    const h = document.createElement("div");
    h.className = "post-section-header";
    h.textContent = text;
    return h;
  };

  container.append(header("edge"));
  container.append(
    numberRow(
      "emissive strength",
      () => settings.edgeEmissiveStrength,
      (v) => {
        settings.edgeEmissiveStrength = v;
      },
      0,
      10,
      0.05,
    ),
  );

  container.append(header("exposure + tone map"));
  container.append(
    numberRow(
      "exposure",
      () => settings.exposure,
      (v) => {
        settings.exposure = v;
      },
      0,
      5,
      0.01,
    ),
  );
  container.append(
    selectRow(
      "tone mapping",
      TONE_MAPPING_OPTIONS,
      () => settings.toneMapping,
      (v) => {
        settings.toneMapping = v;
      },
    ),
  );

  container.append(header("bloom"));
  const bloomField = <K extends keyof PostSettings["bloom"]>(
    label: string,
    key: K,
    min: number,
    max: number,
    step: number,
  ) =>
    numberRow(
      label,
      () => settings.bloom[key],
      (v) => {
        settings.bloom[key] = v;
      },
      min,
      max,
      step,
    );
  container.append(bloomField("intensity", "intensity", 0, 5, 0.05));
  container.append(bloomField("threshold", "threshold", 0, 3, 0.01));
  container.append(bloomField("smoothing", "smoothing", 0, 1, 0.005));
  container.append(bloomField("radius", "radius", 0, 2, 0.01));

  container.append(header("color grade"));
  const cgField = <K extends keyof PostSettings["colorGrade"]>(
    label: string,
    key: K,
    min: number,
    max: number,
    step = 0.01,
  ) => {
    // Only number fields go through this helper; vec3 fields (shadow/
    // highlight tint) use vec3Row directly below.
    return numberRow(
      label,
      () => settings.colorGrade[key] as number,
      (v) => {
        (settings.colorGrade[key] as number) = v;
      },
      min,
      max,
      step,
    );
  };
  container.append(cgField("contrast", "contrast", 0, 3, 0.01));
  container.append(cgField("contrast pivot", "contrastPivot", 0, 1, 0.01));
  container.append(cgField("saturation", "saturation", 0, 3, 0.01));
  container.append(cgField("temperature", "temperature", -2, 2, 0.01));
  container.append(cgField("tint", "tint", -2, 2, 0.01));
  container.append(
    cgField("temperature strength", "temperatureStrength", 0, 1, 0.01),
  );
  container.append(cgField("lift", "lift", -1, 1, 0.01));
  container.append(cgField("gamma", "gamma", 0.1, 3, 0.01));
  container.append(cgField("gain", "gain", 0, 3, 0.01));
  container.append(cgField("black level", "blackLevel", -0.5, 0.5, 0.01));
  container.append(cgField("white level", "whiteLevel", 0.5, 2, 0.01));
  container.append(
    vec3Row(
      "shadow tint",
      () => settings.colorGrade.shadowTint,
      (v) => {
        settings.colorGrade.shadowTint = v;
      },
    ),
  );
  container.append(
    vec3Row(
      "highlight tint",
      () => settings.colorGrade.highlightTint,
      (v) => {
        settings.colorGrade.highlightTint = v;
      },
    ),
  );
  container.append(cgField("vignette", "vignette", 0, 1, 0.01));
  container.append(cgField("vignette radius", "vignetteRadius", 0, 2, 0.01));
  container.append(
    cgField("vignette softness", "vignetteSoftness", 0, 1, 0.01),
  );

  container.append(header("file"));
  const buttons = document.createElement("div");
  buttons.className = "post-buttons";

  const downloadBtn = document.createElement("button");
  downloadBtn.type = "button";
  downloadBtn.textContent = "download json";
  downloadBtn.addEventListener("click", () => downloadJson(settings));
  buttons.append(downloadBtn);

  const reloadBtn = document.createElement("button");
  reloadBtn.type = "button";
  reloadBtn.textContent = "reload from disk";
  reloadBtn.addEventListener("click", async () => {
    const fresh = await loadPostSettings();
    copyInto(settings, fresh);
    applyPostSettings(pipeline, settings);
    mountPostPanel(container, settings, pipeline);
  });
  buttons.append(reloadBtn);

  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.textContent = "reset to defaults";
  resetBtn.addEventListener("click", () => {
    copyInto(settings, DEFAULT_POST_SETTINGS);
    applyPostSettings(pipeline, settings);
    mountPostPanel(container, settings, pipeline);
  });
  buttons.append(resetBtn);

  container.append(buttons);
}

// Deep copy into an existing settings object. Callers hold references
// to the same settings object throughout the session, so we must mutate
// in place rather than replacing the whole object.
function copyInto(dst: PostSettings, src: PostSettings): void {
  dst.edgeEmissiveStrength = src.edgeEmissiveStrength;
  dst.exposure = src.exposure;
  dst.toneMapping = src.toneMapping;
  dst.bloom = { ...src.bloom };
  dst.colorGrade = {
    ...src.colorGrade,
    shadowTint: [...src.colorGrade.shadowTint],
    highlightTint: [...src.colorGrade.highlightTint],
  };
}

// Precision derived from the step string: "0.005" → 3. Lets the
// stepper round after arithmetic so the input never shows float noise
// like 0.030000000000000002.
function decimalsOf(step: number): number {
  const s = String(step);
  const dot = s.indexOf(".");
  return dot === -1 ? 0 : s.length - dot - 1;
}

function downloadJson(settings: PostSettings): void {
  const text = serializePostSettings(settings);
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "post-settings.json";
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
