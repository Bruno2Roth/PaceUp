const DATABASE = 'paceup-local';
const STORE = 'workbooks';
const KEY = 'current';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('Almacenamiento local no disponible'));
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE);
      if (!request.result.objectStoreNames.contains('sessions')) request.result.createObjectStore('sessions', { keyPath: 'date' });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Cerrá las otras pestañas de PaceUp para guardar el archivo'));
    request.onsuccess = () => resolve(request.result);
  });
}

async function transaction(mode, operation, storeName = STORE) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, mode);
      const request = operation(tx.objectStore(storeName));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = () => reject(tx.error || request.error);
      tx.onabort = () => reject(tx.error || new Error('No se pudo guardar el archivo'));
    });
  } finally {
    database.close();
  }
}

export function saveWorkbook(name, buffer) {
  return transaction('readwrite', store => store.put({ name, buffer, savedAt: Date.now() }, KEY));
}

export function readWorkbook() {
  return transaction('readonly', store => store.get(KEY));
}

export function deleteWorkbook() {
  return transaction('readwrite', store => store.delete(KEY));
}

// The Excel and personal session records deliberately use separate stores.
// Replacing or removing a workbook never deletes completed sessions or notes.
export function readSessionRecords() {
  return transaction('readonly', store => store.getAll(), 'sessions');
}

export async function updateSessionRecord(date, patch) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction('sessions', 'readwrite');
      const store = tx.objectStore('sessions');
      const request = store.get(date);
      let record;
      request.onsuccess = () => {
        record = { ...request.result, ...patch, date, updatedAt: Date.now() };
        store.put(record);
      };
      tx.oncomplete = () => resolve(record);
      tx.onerror = () => reject(tx.error || request.error);
      tx.onabort = () => reject(tx.error || new Error('No se pudo guardar el registro'));
    });
  } finally { database.close(); }
}
