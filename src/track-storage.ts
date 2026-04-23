// IndexedDB-backed persistence for the app. Three object stores share a
// single DB:
//
// - `track-meta`: lightweight {hash, name, durationSec, bpm, addedAt}
//   per track. Read at boot to populate the music-tab list cheaply
//   (~tens of bytes per record).
// - `track-bytes`: raw mp3 ArrayBuffer per track, keyed by hash. Only
//   read when the user clicks a row to play that track (multi-MB per
//   record — never iterated at boot).
// - `analysis-cache`: full SongAnalysis (including ~1MB framewise
//   prefix-sum arrays) per track. IDB stores the typed arrays
//   natively — no base64 overhead, no localStorage 5MB quota. Easily
//   holds 20+ songs.
//
// Splitting bytes vs meta avoids loading every track's full audio into
// memory just to render the list. Each cross-store write goes in a
// single transaction so a quota failure rolls back the whole insert
// and we never end up with a "ghost" listing for a track we can't play.

const DB_NAME = "hellorun2";
// v2: added `analysis-cache` store so framewise data can leave
// localStorage. The onupgradeneeded handler is idempotent — adds only
// the missing stores, preserves existing track-meta / track-bytes data.
const DB_VERSION = 2;
const META_STORE = "track-meta";
const BYTES_STORE = "track-bytes";
export const ANALYSIS_STORE = "analysis-cache";

export interface TrackMeta {
  readonly hash: string;
  readonly name: string;
  readonly durationSec: number;
  readonly bpm: number;
  readonly addedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

// Shared DB opener — also used by audio-analysis/cache.ts for the
// analysis-cache store. Idempotent across reentrant calls; the same
// promise is returned on every call.
export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "hash" });
      }
      if (!db.objectStoreNames.contains(BYTES_STORE)) {
        db.createObjectStore(BYTES_STORE, { keyPath: "hash" });
      }
      if (!db.objectStoreNames.contains(ANALYSIS_STORE)) {
        db.createObjectStore(ANALYSIS_STORE, { keyPath: "hash" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error ?? new Error("indexedDB open failed"));
  });
  return dbPromise;
}

export async function putTrack(
  meta: TrackMeta,
  bytes: ArrayBuffer,
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, BYTES_STORE], "readwrite");
    tx.objectStore(META_STORE).put(meta);
    tx.objectStore(BYTES_STORE).put({ hash: meta.hash, bytes });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getTrackBytes(hash: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BYTES_STORE, "readonly");
    const req = tx.objectStore(BYTES_STORE).get(hash);
    req.onsuccess = () => {
      const rec = req.result as
        | { hash: string; bytes: ArrayBuffer }
        | undefined;
      resolve(rec?.bytes ?? null);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteTrack(hash: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([META_STORE, BYTES_STORE], "readwrite");
    tx.objectStore(META_STORE).delete(hash);
    tx.objectStore(BYTES_STORE).delete(hash);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listTrackMeta(): Promise<TrackMeta[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readonly");
    const req = tx.objectStore(META_STORE).getAll();
    req.onsuccess = () => {
      const records = (req.result ?? []) as TrackMeta[];
      // Chronological (oldest first) so the list order matches the
      // upload order across reloads — matches the in-memory append
      // order that drag-drop produces in the same session.
      records.sort((a, b) => a.addedAt - b.addedAt);
      resolve(records);
    };
    req.onerror = () => reject(req.error);
  });
}
