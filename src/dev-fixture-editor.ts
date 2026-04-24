import { getCatalog } from "./scene/fixtures";
import type { FixtureType, ParamRange } from "./scene/fixtures/shared";

// Dev-only fixture parameter editor. Side-docked panel that
// introspects the catalog, lets the user edit min/max ranges per
// numeric param, regenerate visible corridors to see the result, and
// export per-type JSON to drop into public/setup/.
//
// Editor state (toggle open/closed) is persisted by main.ts; in-
// memory range edits are NOT auto-persisted — "Export" is the only
// way to checkpoint. Iterate → Export → replace file in repo →
// reload is the persistence path.

export interface EditorHost {
  // Fired when the user clicks "Generate". Main.ts wires this to
  // regenerateAllRigs — which rebuilds every visible
  // corridor's rigs with ONLY the named type, using fresh
  // random rolls from the current ranges. Isolates the selected type
  // so the user sees exactly what they're tuning.
  onGenerate: (typeName: string) => void;
}

export function mountRigEditor(
  container: HTMLElement,
  host: EditorHost,
): void {
  container.innerHTML = "";
  container.classList.add("fixture-editor");

  const catalog = getCatalog();
  if (catalog.length === 0) {
    container.textContent = "(no fixture types registered)";
    return;
  }

  const header = document.createElement("div");
  header.className = "fixture-editor-header";
  header.textContent = "rig editor";
  container.appendChild(header);

  // --- type selector --- //
  const selectorRow = document.createElement("div");
  selectorRow.className = "fixture-editor-selector";
  const selectorLabel = document.createElement("label");
  selectorLabel.textContent = "type";
  const selector = document.createElement("select");
  for (const t of catalog) {
    const opt = document.createElement("option");
    opt.value = t.name;
    opt.textContent = t.name;
    selector.appendChild(opt);
  }
  selectorRow.append(selectorLabel, selector);
  container.appendChild(selectorRow);

  // --- ranges body (re-rendered on type change) --- //
  const body = document.createElement("div");
  body.className = "fixture-editor-body";
  container.appendChild(body);

  // --- bottom action row --- //
  const actions = document.createElement("div");
  actions.className = "fixture-editor-actions";
  const genBtn = document.createElement("button");
  genBtn.type = "button";
  genBtn.textContent = "generate";
  genBtn.addEventListener("click", () => host.onGenerate(selector.value));
  const exportBtn = document.createElement("button");
  exportBtn.type = "button";
  exportBtn.textContent = "export json";
  exportBtn.addEventListener("click", () => {
    const t = findType(catalog, selector.value);
    if (t) downloadTypeRanges(t);
  });
  actions.append(genBtn, exportBtn);
  container.appendChild(actions);

  // --- body rendering --- //
  const renderBody = (): void => {
    body.innerHTML = "";
    const t = findType(catalog, selector.value);
    if (!t) return;
    const keys = Object.keys(t.ranges).sort();
    if (keys.length === 0) {
      const none = document.createElement("div");
      none.className = "fixture-editor-empty";
      none.textContent = "(no tunable numeric params)";
      body.appendChild(none);
      return;
    }
    for (const key of keys) {
      body.appendChild(rangeRow(key, t.ranges[key] as ParamRange));
    }
  };

  selector.addEventListener("change", renderBody);
  renderBody();
}

// Each range row: label + min stepper + max stepper. Editing either
// mutates the type's `ranges` record directly; specFor picks it up
// on the next call. Not persisted — user must click Export to
// checkpoint.
function rangeRow(name: string, range: ParamRange): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "fixture-editor-row";

  const label = document.createElement("label");
  label.textContent = name;
  row.appendChild(label);

  const inputs = document.createElement("div");
  inputs.className = "fixture-editor-minmax";
  inputs.appendChild(stepper("min", () => range.min, (v) => (range.min = v)));
  inputs.appendChild(stepper("max", () => range.max, (v) => (range.max = v)));
  row.appendChild(inputs);

  return row;
}

// Compact label + stepped number input. Mirrors the Post panel's
// stepper for consistency; kept local so the editor is self-contained.
function stepper(
  label: string,
  get: () => number,
  set: (v: number) => void,
): HTMLDivElement {
  const wrap = document.createElement("div");
  wrap.className = "fixture-editor-stepper";

  const lab = document.createElement("span");
  lab.className = "fixture-editor-stepper-label";
  lab.textContent = label;
  wrap.appendChild(lab);

  const group = document.createElement("div");
  group.className = "fixture-editor-stepper-group";

  const input = document.createElement("input");
  input.type = "number";
  input.step = "0.01";
  input.value = String(get());
  input.addEventListener("input", () => {
    const v = parseFloat(input.value);
    if (!Number.isFinite(v)) return;
    set(v);
  });

  const dec = document.createElement("button");
  dec.type = "button";
  dec.className = "fixture-editor-step";
  dec.textContent = "<";
  dec.addEventListener("click", () => {
    const v = parseFloat((get() - 0.01).toFixed(4));
    set(v);
    input.value = String(v);
  });

  const inc = document.createElement("button");
  inc.type = "button";
  inc.className = "fixture-editor-step";
  inc.textContent = ">";
  inc.addEventListener("click", () => {
    const v = parseFloat((get() + 0.01).toFixed(4));
    set(v);
    input.value = String(v);
  });

  group.append(input, dec, inc);
  wrap.appendChild(group);
  return wrap;
}

function findType(
  catalog: ReadonlyArray<FixtureType<unknown>>,
  name: string,
): FixtureType<unknown> | undefined {
  return catalog.find((t) => t.name === name);
}

function downloadTypeRanges(t: FixtureType<unknown>): void {
  const text = JSON.stringify(t.ranges, null, 2) + "\n";
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${t.name}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
