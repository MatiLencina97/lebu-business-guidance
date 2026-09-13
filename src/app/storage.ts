const DB_NAME = 'lebu-local';
const DB_VERSION = 1;
const STORE_NAME = 'state';
const STATE_KEY = 'current';

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB no está disponible'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('No se pudo abrir IndexedDB'));
    request.onblocked = () => reject(new Error('IndexedDB está bloqueada por otra pestaña'));
  });
}

export async function readLocalState<T>(): Promise<T | null> {
  const db = await openDatabase();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(STATE_KEY);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error ?? new Error('No se pudo leer IndexedDB'));
    });
  } finally {
    db.close();
  }
}

export async function writeLocalState(value: unknown): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(value, STATE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('No se pudo guardar en IndexedDB'));
      tx.onabort = () => reject(tx.error ?? new Error('Se canceló el guardado en IndexedDB'));
    });
  } finally {
    db.close();
  }
}

export async function clearLocalState(): Promise<void> {
  const db = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(STATE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('No se pudo borrar IndexedDB'));
      tx.onabort = () => reject(tx.error ?? new Error('Se canceló el borrado en IndexedDB'));
    });
  } finally {
    db.close();
  }
}
