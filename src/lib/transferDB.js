/* ═══════════════════════════════════════════════════════════
   Flash - IndexedDB Transfer Storage
   Persists received chunks to IndexedDB so transfers can resume
   after connection drops, page reloads, or tab closures.

   Schema:
     - 'chunks' store: { fileId, chunkIndex, data } (compound key)
     - 'transfers' store: { fileId, name, size, type, totalChunks,
                            receivedChunks, updatedAt }
   ═══════════════════════════════════════════════════════════ */

const DB_NAME = 'flash-transfers';
const DB_VERSION = 1;
const CHUNKS_STORE = 'chunks';
const TRANSFERS_STORE = 'transfers';

// Keep partial transfers for 24 hours
const STALE_TRANSFER_MS = 24 * 60 * 60 * 1000;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB not supported'));
      return;
    }

    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        db.createObjectStore(CHUNKS_STORE, {
          keyPath: ['fileId', 'chunkIndex'],
        });
      }
      if (!db.objectStoreNames.contains(TRANSFERS_STORE)) {
        const store = db.createObjectStore(TRANSFERS_STORE, {
          keyPath: 'fileId',
        });
        store.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

function tx(db, stores, mode = 'readonly') {
  return db.transaction(stores, mode);
}

function awaitRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Generate a stable fileId from file metadata so reconnects can
 * resume the same transfer.
 */
export function makeFileId(roomCode, fileName, fileSize) {
  return `${roomCode}::${fileName}::${fileSize}`;
}

/**
 * Initialize transfer metadata. Returns existing transfer state if found.
 */
export async function initTransfer({ fileId, name, size, type, totalChunks }) {
  try {
    const db = await openDB();
    const t = tx(db, [TRANSFERS_STORE], 'readwrite');
    const store = t.objectStore(TRANSFERS_STORE);
    const existing = await awaitRequest(store.get(fileId));

    if (
      existing &&
      existing.size === size &&
      existing.totalChunks === totalChunks
    ) {
      // Resume existing transfer
      existing.updatedAt = Date.now();
      await awaitRequest(store.put(existing));
      return existing;
    }

    // New (or mismatched) transfer — start fresh
    if (existing) {
      // Different file with same id — clear old chunks
      await clearChunks(fileId);
    }

    const fresh = {
      fileId,
      name,
      size,
      type,
      totalChunks,
      receivedChunks: [],
      updatedAt: Date.now(),
    };
    await awaitRequest(store.put(fresh));
    return fresh;
  } catch (err) {
    console.warn('[transferDB] initTransfer failed:', err);
    return null;
  }
}

/**
 * Save a chunk to IndexedDB.
 */
export async function saveChunk(fileId, chunkIndex, data) {
  try {
    const db = await openDB();
    const t = tx(db, [CHUNKS_STORE], 'readwrite');
    const store = t.objectStore(CHUNKS_STORE);
    await awaitRequest(store.put({ fileId, chunkIndex, data }));
    return true;
  } catch (err) {
    console.warn('[transferDB] saveChunk failed:', err);
    return false;
  }
}

/**
 * Update the receivedChunks list for a transfer (batched for performance).
 */
export async function updateReceivedChunks(fileId, receivedChunks) {
  try {
    const db = await openDB();
    const t = tx(db, [TRANSFERS_STORE], 'readwrite');
    const store = t.objectStore(TRANSFERS_STORE);
    const existing = await awaitRequest(store.get(fileId));
    if (!existing) return false;
    existing.receivedChunks = receivedChunks;
    existing.updatedAt = Date.now();
    await awaitRequest(store.put(existing));
    return true;
  } catch (err) {
    console.warn('[transferDB] updateReceivedChunks failed:', err);
    return false;
  }
}

/**
 * Get all chunks for a transfer, ordered by index.
 */
export async function getAllChunks(fileId) {
  try {
    const db = await openDB();
    const t = tx(db, [CHUNKS_STORE], 'readonly');
    const store = t.objectStore(CHUNKS_STORE);
    const range = IDBKeyRange.bound(
      [fileId, 0],
      [fileId, Number.MAX_SAFE_INTEGER]
    );
    const chunks = await awaitRequest(store.getAll(range));
    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
    return chunks.map((c) => c.data);
  } catch (err) {
    console.warn('[transferDB] getAllChunks failed:', err);
    return [];
  }
}

/**
 * Clear all chunks for a fileId.
 */
export async function clearChunks(fileId) {
  try {
    const db = await openDB();
    const t = tx(db, [CHUNKS_STORE], 'readwrite');
    const store = t.objectStore(CHUNKS_STORE);
    const range = IDBKeyRange.bound(
      [fileId, 0],
      [fileId, Number.MAX_SAFE_INTEGER]
    );
    await awaitRequest(store.delete(range));
    return true;
  } catch (err) {
    console.warn('[transferDB] clearChunks failed:', err);
    return false;
  }
}

/**
 * Delete a transfer entirely (chunks + metadata).
 */
export async function deleteTransfer(fileId) {
  try {
    await clearChunks(fileId);
    const db = await openDB();
    const t = tx(db, [TRANSFERS_STORE], 'readwrite');
    const store = t.objectStore(TRANSFERS_STORE);
    await awaitRequest(store.delete(fileId));
    return true;
  } catch (err) {
    console.warn('[transferDB] deleteTransfer failed:', err);
    return false;
  }
}

/**
 * Cleanup transfers older than STALE_TRANSFER_MS.
 */
export async function cleanupStaleTransfers() {
  try {
    const db = await openDB();
    const t = tx(db, [TRANSFERS_STORE], 'readonly');
    const store = t.objectStore(TRANSFERS_STORE);
    const all = await awaitRequest(store.getAll());
    const cutoff = Date.now() - STALE_TRANSFER_MS;

    for (const transfer of all) {
      if (transfer.updatedAt < cutoff) {
        await deleteTransfer(transfer.fileId);
      }
    }
    return true;
  } catch (err) {
    console.warn('[transferDB] cleanupStaleTransfers failed:', err);
    return false;
  }
}

/**
 * Check if IndexedDB is available and has sufficient quota.
 */
export async function isAvailable() {
  if (typeof indexedDB === 'undefined') return false;
  try {
    await openDB();
    return true;
  } catch {
    return false;
  }
}
