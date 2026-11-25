// Tiny promise-based IndexedDB key-value store (db "azcalc", store "kv").
// Every function degrades gracefully: when IndexedDB is unavailable, blocked or throws (private
// mode, disabled storage), reads resolve undefined/[] and writes are no-ops. Never rejects.

const DB_NAME = "azcalc";
const STORE = "kv";
const OPEN_TIMEOUT_MS = 4000;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function getFactory(): IDBFactory | undefined {
  try {
    return typeof indexedDB === "undefined" ? undefined : indexedDB;
  } catch {
    return undefined;
  }
}

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (db: IDBDatabase | null) => {
      if (timer !== undefined) clearTimeout(timer);
      if (settled) {
        db?.close();
        return;
      }
      settled = true;
      resolve(db);
    };
    const factory = getFactory();
    if (!factory) {
      finish(null);
      return;
    }
    // Some browsers never answer open() (broken profiles): give up and run without a cache.
    timer = setTimeout(() => finish(null), OPEN_TIMEOUT_MS);
    try {
      const req = factory.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        try {
          if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
        } catch {
          // The open request will fail and resolve null.
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        db.onclose = () => {
          dbPromise = null;
        };
        finish(db);
      };
      req.onerror = (event) => {
        event.preventDefault();
        finish(null);
      };
    } catch {
      finish(null);
    }
  });
  return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const db = await openDb();
  if (!db) return undefined;
  return new Promise<T | undefined>((resolve) => {
    try {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = (event) => {
        event.preventDefault();
        resolve(undefined);
      };
      tx.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

export async function idbGet<T = unknown>(key: string): Promise<T | undefined> {
  return run<T>("readonly", (store) => store.get(key) as IDBRequest<T>);
}

export async function idbSet(key: string, value: unknown): Promise<void> {
  await run("readwrite", (store) => {
    store.put(value, key);
  });
}

export async function idbDelete(key: string): Promise<void> {
  await run("readwrite", (store) => {
    store.delete(key);
  });
}

/** Deletes several keys in one transaction. */
export async function idbDeleteMany(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await run("readwrite", (store) => {
    for (const key of keys) store.delete(key);
  });
}

/** All string keys of the store ([] when IndexedDB is unavailable). */
export async function idbKeys(): Promise<string[]> {
  const keys = await run<IDBValidKey[]>("readonly", (store) => store.getAllKeys());
  return (keys ?? []).filter((k): k is string => typeof k === "string");
}

export async function idbClear(): Promise<void> {
  await run("readwrite", (store) => {
    store.clear();
  });
}
