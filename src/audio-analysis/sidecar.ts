// Pre-computed analysis sidecar files. A built-in track shipped at
// `/public/foo.mp3` can also ship `/public/foo.mp3.analysis.json` —
// when present, first-time visitors get instant analysis instead of
// waiting ~15s for the Essentia worker to chew through the audio.
//
// Format: a thin envelope around SongAnalysis with a schema version
// (so we can evolve the analyzer without silently using stale data)
// and the original audio's SHA-256 hash (so a sidecar paired with the
// wrong mp3 is detected and ignored). Float32Arrays inside `framewise`
// are base64-encoded — JSON's only practical way to carry typed-array
// bytes intact.
//
// Generation: the dev tab has an "export analysis" button that
// downloads the current track's analysis as a sidecar JSON. Drop the
// downloaded file next to the mp3 in `public/` and commit.

import type { SongAnalysis } from "./analyzer";

// Bump when SongAnalysis or framewise structure changes in a way that
// makes old sidecars unsafe to load.
const SIDECAR_FORMAT = "hellorun2-analysis-v1";
const F32_MARKER = "__f32_b64__";

interface SidecarFile {
  readonly format: string;
  readonly audioHash: string;
  readonly analysis: SongAnalysis;
}

type EncodedF32 = { readonly [F32_MARKER]: string };

function encodeF32(arr: Float32Array): EncodedF32 {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let bin = "";
  // Chunked because String.fromCharCode(...bytes) blows the stack on
  // arrays larger than ~100k bytes.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK) as unknown as number[],
    );
  }
  return { [F32_MARKER]: btoa(bin) };
}

function decodeF32(s: string): Float32Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Float32Array) return encodeF32(value);
  return value;
}

function jsonReviver(_key: string, value: unknown): unknown {
  if (
    value !== null &&
    typeof value === "object" &&
    F32_MARKER in (value as object)
  ) {
    return decodeF32((value as EncodedF32)[F32_MARKER]);
  }
  return value;
}

// Network half of the sidecar load. Returns the raw JSON text if
// `${audioUrl}.analysis.json` exists, or null on 404 / network error.
// Split from the parse step so callers can kick off the fetch in
// parallel with the audio download + hash compute (the hash is only
// needed at validate time).
export async function fetchSidecarText(
  audioUrl: string,
): Promise<string | null> {
  try {
    const resp = await fetch(`${audioUrl}.analysis.json`);
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  }
}

// Parse + validate a sidecar payload against the freshly-computed
// audio hash. Returns null on parse failure, format-version mismatch
// (analyzer pipeline evolved), or hash mismatch (sidecar paired with
// a different mp3) — caller falls through to the fresh-analyze path.
export function parseSidecar(
  text: string,
  audioHash: string,
): SongAnalysis | null {
  let parsed: SidecarFile;
  try {
    parsed = JSON.parse(text, jsonReviver) as SidecarFile;
  } catch (err) {
    console.warn(`sidecar parse failed:`, err);
    return null;
  }
  if (parsed.format !== SIDECAR_FORMAT) {
    console.warn(
      `sidecar format mismatch: got ${parsed.format}, expected ${SIDECAR_FORMAT} — ignoring`,
    );
    return null;
  }
  if (parsed.audioHash !== audioHash) {
    console.warn(
      `sidecar audio hash mismatch — sidecar is for a different mp3`,
    );
    return null;
  }
  return parsed.analysis;
}

// Triggers a browser download of the sidecar JSON. Used by the dev-tab
// "export analysis" button: capture the currently-active track's
// analysis to a file Carlos can drop next to the mp3 in public/.
export function downloadSidecar(
  analysis: SongAnalysis,
  audioHash: string,
  baseFilename: string,
): void {
  const sidecar: SidecarFile = {
    format: SIDECAR_FORMAT,
    audioHash,
    analysis,
  };
  const json = JSON.stringify(sidecar, jsonReplacer);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${baseFilename}.analysis.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
