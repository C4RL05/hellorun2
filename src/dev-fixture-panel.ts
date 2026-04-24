import {
  listCatalogTypeNames,
  setEnabledFixtureTypes,
} from "./scene/fixtures";

// Dev-tab checkbox panel for toggling individual fixture types on/
// off. Persists to localStorage so toggles survive reloads. Changes
// take effect for corridors built AFTER the toggle — the current
// corridor (built at analysis time) keeps its baked rigs until
// a beat-sync teardown rebuilds.
//
// Storage value is either null (all types enabled — the default) or
// an array of enabled type names. Empty array = no fixtures.

const LS_KEY = "hellorun2.fixtures.enabled";

function loadEnabledFromStorage(): readonly string[] | null {
  const raw = localStorage.getItem(LS_KEY);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null) return null;
    if (
      Array.isArray(parsed) &&
      parsed.every((x): x is string => typeof x === "string")
    ) {
      return parsed;
    }
  } catch {
    // fall through to clearing the bad entry
  }
  localStorage.removeItem(LS_KEY);
  return null;
}

function saveEnabledToStorage(enabled: readonly string[] | null): void {
  if (enabled === null) {
    localStorage.removeItem(LS_KEY);
  } else {
    localStorage.setItem(LS_KEY, JSON.stringify(enabled));
  }
}

// Apply the stored filter before any corridor is built. Call early in
// main.ts (at module init) so boot-time straights respect the toggle
// state even without the dev menu being opened.
export function applyStoredRigFilter(): void {
  setEnabledFixtureTypes(loadEnabledFromStorage());
}

// Mount the checkbox panel inside the dev pane. Builds the "all" +
// per-type rows from the live catalog so adding a new fixture
// type appears here automatically.
export function mountRigDevPanel(container: HTMLElement): void {
  container.innerHTML = "";
  container.classList.add("fixture-toggle-panel");

  const title = document.createElement("div");
  title.className = "fixture-toggle-title";
  title.textContent = "fixtures";
  container.appendChild(title);

  const allNames = listCatalogTypeNames();
  const stored = loadEnabledFromStorage();
  const isAll = stored === null;
  const enabledSet = new Set<string>(stored ?? allNames);

  const allRow = document.createElement("label");
  allRow.className = "fixture-toggle-row fixture-toggle-all";
  const allInput = document.createElement("input");
  allInput.type = "checkbox";
  allInput.checked = isAll;
  allRow.appendChild(allInput);
  allRow.appendChild(document.createTextNode(" all"));
  container.appendChild(allRow);

  const list = document.createElement("div");
  list.className = "fixture-toggle-list";
  container.appendChild(list);

  const perTypeInputs: HTMLInputElement[] = [];
  for (const name of allNames) {
    const row = document.createElement("label");
    row.className = "fixture-toggle-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = isAll || enabledSet.has(name);
    input.disabled = isAll;
    row.appendChild(input);
    row.appendChild(document.createTextNode(" " + name));
    list.appendChild(row);
    perTypeInputs.push(input);
  }

  // Rebuilds the in-memory enabled set from the current checkbox
  // state, applies to the fixture module, and persists.
  const flush = (): void => {
    if (allInput.checked) {
      setEnabledFixtureTypes(null);
      saveEnabledToStorage(null);
      for (const inp of perTypeInputs) {
        inp.disabled = true;
        inp.checked = true;
      }
      return;
    }
    const enabled: string[] = [];
    for (let i = 0; i < allNames.length; i++) {
      const inp = perTypeInputs[i] as HTMLInputElement;
      inp.disabled = false;
      if (inp.checked) enabled.push(allNames[i] as string);
    }
    setEnabledFixtureTypes(enabled);
    saveEnabledToStorage(enabled);
  };

  allInput.addEventListener("change", flush);
  for (const inp of perTypeInputs) {
    inp.addEventListener("change", flush);
  }
}
