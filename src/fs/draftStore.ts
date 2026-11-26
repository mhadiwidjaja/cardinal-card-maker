/**
 * Keeps crash-recovery drafts (see ui/draft.ts) in the browser's IndexedDB,
 * one record per workspace, keyed by FileStore.key. Same style as
 * handleStore.ts, but its own small database, so the two never need a shared
 * version upgrade.
 *
 * Failures are ignored: the draft is a safety net, never a reason to block
 * editing or saving.
 */
import type { Draft } from '../ui/draft';

const DB_NAME = 'card-maker-drafts';
const STORE = 'drafts';

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

export async function saveDraft(draft: Draft): Promise<void> {
  try {
    await run('readwrite', (s) => s.put(draft, draft.key));
  } catch {
  }
}

export async function loadDraft(key: string): Promise<Draft | null> {
  try {
    const d = (await run('readonly', (s) => s.get(key))) as Draft | undefined;
    return d && d.formatVersion === 1 && Array.isArray(d.files) && d.files.length ? d : null;
  } catch {
    return null;
  }
}

export async function clearDraft(key: string): Promise<void> {
  try {
    await run('readwrite', (s) => s.delete(key));
  } catch {
  }
}
