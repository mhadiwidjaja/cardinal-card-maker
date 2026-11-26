/**
 * Remembers the last opened workspace folder between sessions. Browsers allow
 * storing a FileSystemDirectoryHandle in IndexedDB; permission still has to be
 * re-granted with a click after a restart.
 */
const DB_NAME = 'card-maker';
const STORE = 'handles';
const KEY = 'lastWorkspace';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = op(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function saveLastWorkspace(handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(handle, KEY));
  } catch {
  }
}

export async function loadLastWorkspace(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return ((await run('readonly', (s) => s.get(KEY))) as FileSystemDirectoryHandle | undefined) ?? null;
  } catch {
    return null;
  }
}
