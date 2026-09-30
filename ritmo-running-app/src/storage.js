const DATABASE = 'paceup-local';
const STORE = 'workbooks';
const KEY = 'current';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('Almacenamiento local no disponible'));
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Cerrá las otras pestañas de PaceUp para guardar el archivo'));
    request.onsuccess = () => resolve(request.result);
  });
}

async function transaction(mode, operation) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction(STORE, mode);
      const request = operation(tx.objectStore(STORE));
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
