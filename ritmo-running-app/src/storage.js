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

export function saveWorkbook(name, buffer, metadata = {}) {
  if (metadata.source !== 'drive') return Promise.reject(new Error('Los Excel importados manualmente son temporales y no se guardan'));
  return transaction('readwrite', store => store.put({ name, buffer, savedAt: Date.now(), source:'drive',
    driveFileId:metadata.driveFileId,driveRevision:metadata.driveRevision,driveCheckedAt:metadata.driveCheckedAt }, KEY));
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

// Apply each date once, preserving notes and any later manual undo. The reads
// and writes share a transaction so another tab cannot overwrite a user change.
export async function seedHistoricalSessions(candidates) {
  if (!candidates.length) return 0;
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const tx = database.transaction('sessions', 'readwrite');
      const store = tx.objectStore('sessions');
      let marked = 0;
      for (const candidate of candidates) {
        const request = store.get(candidate.date);
        request.onsuccess = () => {
          const existing = request.result;
          if (existing?.historicalCutoff === candidate.historicalCutoff) return;
          // A session already completed keeps the original Excel snapshot.
          store.put(existing?.done ? { ...candidate, ...existing, historicalCutoff: candidate.historicalCutoff }
            : { ...existing, ...candidate, updatedAt: Date.now() });
          if (!existing?.done) marked += 1;
        };
      }
      tx.oncomplete = () => resolve(marked);
      tx.onerror = () => reject(tx.error || new Error('No se pudieron marcar las actividades anteriores'));
      tx.onabort = () => reject(tx.error || new Error('No se pudieron marcar las actividades anteriores'));
    });
  } finally { database.close(); }
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
