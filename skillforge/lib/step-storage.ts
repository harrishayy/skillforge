/**
 * IndexedDB-backed incremental storage for recording session steps.
 *
 * Persists video blobs, transcripts, and notes per step so that data
 * survives tab crashes or accidental navigation. Cleared after a
 * successful upload or when a new session starts.
 */

const DB_NAME = "skillforge-recording";
const DB_VERSION = 1;
const STEPS_STORE = "steps";
const META_STORE = "meta";

export interface SavedStep {
  stepNumber: number;
  blob: Blob;
  transcript: string;
  note: string;
  durationMs: number;
}

export interface SessionMeta {
  title: string;
  description: string;
  createdAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STEPS_STORE)) {
        db.createObjectStore(STEPS_STORE, { keyPath: "stepNumber" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSessionMeta(meta: SessionMeta): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readwrite");
    tx.objectStore(META_STORE).put(meta, "config");
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function getSessionMeta(): Promise<SessionMeta | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readonly");
    const req = tx.objectStore(META_STORE).get("config");
    req.onsuccess = () => { db.close(); resolve(req.result ?? null); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function saveStep(step: SavedStep): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STEPS_STORE, "readwrite");
    tx.objectStore(STEPS_STORE).put(step);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function getAllSteps(): Promise<SavedStep[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STEPS_STORE, "readonly");
    const req = tx.objectStore(STEPS_STORE).getAll();
    req.onsuccess = () => {
      db.close();
      const steps = (req.result as SavedStep[]).sort(
        (a, b) => a.stepNumber - b.stepNumber
      );
      resolve(steps);
    };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function getStepCount(): Promise<number> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STEPS_STORE, "readonly");
    const req = tx.objectStore(STEPS_STORE).count();
    req.onsuccess = () => { db.close(); resolve(req.result); };
    req.onerror = () => { db.close(); reject(req.error); };
  });
}

export async function clearSession(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction([STEPS_STORE, META_STORE], "readwrite");
    tx.objectStore(STEPS_STORE).clear();
    tx.objectStore(META_STORE).clear();
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function hasRecoveryData(): Promise<boolean> {
  try {
    const [meta, count] = await Promise.all([getSessionMeta(), getStepCount()]);
    return meta !== null && count > 0;
  } catch (err) {
    console.warn("[StepStorage] Failed to check recovery data availability:", err);
    return false;
  }
}
