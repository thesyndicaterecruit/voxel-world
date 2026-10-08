/* ============================ INDEXEDDB ============================ */
// A thin promise wrapper over IndexedDB: just what the save files need.

const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => {
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

export interface DB {
  get<T>(store: string, key: IDBValidKey): Promise<T | undefined>;
  getAll<T>(store: string): Promise<T[]>;
  keys(store: string, range?: IDBKeyRange): Promise<IDBValidKey[]>;
  /** Run `fn` in one read-write transaction over `stores`; resolves when it has committed. */
  write(stores: string[], fn: (tx: IDBTransaction) => void): Promise<void>;
}

/** Open (and create/upgrade) a database. Rejects if IndexedDB is unavailable, e.g. some private modes. */
export function openDB(name: string, version: number, upgrade: (db: IDBDatabase, oldVersion: number) => void): Promise<DB> {
  return new Promise((resolve, reject) => {
    let r: IDBOpenDBRequest;
    try { r = indexedDB.open(name, version); } catch (e) { reject(e); return; }
    r.onupgradeneeded = (e) => upgrade(r.result, e.oldVersion);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('database blocked by another tab'));
    r.onsuccess = () => {
      const db = r.result;
      db.onversionchange = () => db.close();                    // let a newer tab upgrade
      const read = (store: string) => db.transaction(store, 'readonly').objectStore(store);
      resolve({
        get: (store, key) => req(read(store).get(key)),
        getAll: (store) => req(read(store).getAll()),
        keys: (store, range) => req(read(store).getAllKeys(range)),
        write: (stores, fn) => new Promise((res, rej) => {
          const tx = db.transaction(stores, 'readwrite');
          tx.oncomplete = () => res();
          tx.onerror = tx.onabort = () => rej(tx.error || new Error('transaction aborted'));
          fn(tx);
        }),
      });
    };
  });
}
