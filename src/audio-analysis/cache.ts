// Persistent cache for analysis results, keyed by SHA-256 of the audio
// file's bytes. Skips the ~15s Essentia worker pass when a song has been
// analyzed before. Storage is localStorage (5MB ≈ 100 songs at ~50KB
// each). Schema changes bump CACHE_VERSION so old entries are orphaned;
// the clear-cache button sweeps every version.

import type { SongAnalysis } from "./analyzer";

const CACHE_VERSION = 2;
const CACHE_PREFIX = `hr2-analysis-v${CACHE_VERSION}:`;
// Match-anything prefix used by clearAnalysisCache so it also evicts
// orphaned entries from previous CACHE_VERSION values.
const CACHE_FAMILY_PREFIX = "hr2-analysis-v";

export async function hashArrayBuffer(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export function getCachedAnalysis(hash: string): SongAnalysis | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + hash);
    if (!raw) return null;
    return JSON.parse(raw) as SongAnalysis;
  } catch (err) {
    console.warn("analysis cache read failed:", err);
    return null;
  }
}

export function setCachedAnalysis(hash: string, analysis: SongAnalysis): void {
  try {
    localStorage.setItem(CACHE_PREFIX + hash, JSON.stringify(analysis));
  } catch (err) {
    // Most likely cause: quota exceeded. Don't propagate — the analysis
    // result is fine in memory; the next page load will just re-run.
    console.warn("analysis cache write failed:", err);
  }
}

// Removes the cached analysis for one specific track (current
// CACHE_VERSION only — orphaned entries from older versions are reaped
// by clearAnalysisCache). Used when the user deletes a track from the
// music tab so the localStorage entry doesn't linger forever.
export function removeAnalysisFromCache(hash: string): void {
  try {
    localStorage.removeItem(CACHE_PREFIX + hash);
  } catch (err) {
    console.warn("analysis cache delete failed:", err);
  }
}

// Removes every cached analysis (current and prior CACHE_VERSIONs).
// Returns the count of removed entries.
export function clearAnalysisCache(): number {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(CACHE_FAMILY_PREFIX)) keysToRemove.push(k);
  }
  for (const k of keysToRemove) localStorage.removeItem(k);
  return keysToRemove.length;
}
