// Archivio locale (IndexedDB): tutto resta sul telefono, niente cloud.
//  places  - i posti salvati con il GPS
//  entries - il diario delle uscite (foto comprese, come Blob)
//  kv      - cache delle previsioni, per consultarle offline

const DB_NAME = 'porcini-radar';
let dbPromise;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('places', { keyPath: 'id' });
      db.createObjectStore('entries', { keyPath: 'id' });
      db.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
  });
}

export const getAll = (store) => run(store, 'readonly', (s) => s.getAll());
export const put = (store, value, key) => run(store, 'readwrite', (s) => s.put(value, key));
export const del = (store, key) => run(store, 'readwrite', (s) => s.delete(key));
export const get = (store, key) => run(store, 'readonly', (s) => s.get(key));

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
