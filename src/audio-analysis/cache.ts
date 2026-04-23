// IndexedDB-backed cache for analysis results, keyed by SHA-256 of the
// audio file's bytes. Skips the ~15s Essentia worker pass when a song
// has been analyzed before.
//
// Lives in the shared hellorun2 IDB (see track-storage.ts) so the
// ~1MB framewise prefix-sum data stores natively as Float32Arrays —
// no base64 overhead, no localStorage 5MB quota. Easily holds 20+
// songs.
//
// Schema is owned by track-storage.ts (it bumps DB_VERSION when adding
// stores). The legacy localStorage cache (versions v1–v3) is no longer
// written; clearAnalysisCache() still sweeps any leftover entries as a
// one-time courtesy migration.

import type { SongAnalysis } from "./analyzer";
import { ANALYSIS_STORE, openDb } from "../track-storage";

const LEGACY_LOCAL_PREFIX = "hr2-analysis-v";

export async function hashArrayBuffer(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  const bytes = new Uint8Array(digest);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export async function getCachedAnalysis(
  hash: string,
): Promise<SongAnalysis | null> {
  try {
    const db = await openDb();
    return await new Promise<SongAnalysis | null>((resolve, reject) => {
      const tx = db.transaction(ANALYSIS_STORE, "readonly");
      const req = tx.objectStore(ANALYSIS_STORE).get(hash);
      req.onsuccess = () => {
        const rec = req.result as
          | { hash: string; analysis: SongAnalysis }
          | undefined;
        resolve(rec?.analysis ?? null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch (err) {
    console.warn("analysis cache read failed:", err);
    return null;
  }
}

export async function setCachedAnalysis(
  hash: string,
  analysis: SongAnalysis,
): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ANALYSIS_STORE, "readwrite");
      tx.objectStore(ANALYSIS_STORE).put({ hash, analysis });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    // Most likely cause: quota exceeded. Don't propagate — analysis is
    // already in memory and the next page load will just re-run.
    console.warn("analysis cache write failed:", err);
  }
}

export async function removeAnalysisFromCache(hash: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ANALYSIS_STORE, "readwrite");
      tx.objectStore(ANALYSIS_STORE).delete(hash);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn("analysis cache delete failed:", err);
  }
}

// Removes every cached analysis: IDB store + any legacy localStorage
// entries from v1–v3. Returns total entries removed.
export async function clearAnalysisCache(): Promise<number> {
  let removed = 0;
  // Legacy localStorage sweep — keeps the courtesy migration after the
  // IDB cutover so old entries don't sit forever on user machines.
  const legacyKeys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith(LEGACY_LOCAL_PREFIX)) legacyKeys.push(k);
  }
  for (const k of legacyKeys) {
    localStorage.removeItem(k);
    removed++;
  }
  // IDB sweep.
  try {
    const db = await openDb();
    const idbCount = await new Promise<number>((resolve, reject) => {
      const tx = db.transaction(ANALYSIS_STORE, "readwrite");
      const store = tx.objectStore(ANALYSIS_STORE);
      const countReq = store.count();
      countReq.onsuccess = () => {
        store.clear();
        tx.oncomplete = () => resolve(countReq.result);
      };
      countReq.onerror = () => reject(countReq.error);
    });
    removed += idbCount;
  } catch (err) {
    console.warn("analysis cache clear (idb) failed:", err);
  }
  return removed;
}
