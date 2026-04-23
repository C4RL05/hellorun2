// IndexedDB-backed persistence for user-uploaded tracks. Two stores:
//
// - `track-meta`: lightweight {hash, name, durationSec, bpm, addedAt}
//   per track. Read at boot to populate the music-tab list cheaply
//   (~tens of bytes per record).
// - `track-bytes`: raw mp3 ArrayBuffer per track, keyed by hash. Only
//   read when the user clicks a row to play that track (multi-MB per
//   record — never iterated at boot).
//
// Splitting the two avoids loading every track's full audio into memory
// just to render the list. Writes go to both stores in one transaction
// so a quota failure on bytes also rolls back the metadata insert and
// we never end up with a "ghost" listing for a track we can't play.

const DB_NAME = "hellorun2";
const DB_VERSION = 1;
const META_STORE = "track-meta";
const BYTES_STORE = "track-bytes";

export interface TrackMeta {
  readonly hash: string;
  readonly name: string;
  readonly durationSec: number;
  readonly bpm: number;
  readonly addedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
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
