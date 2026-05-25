/**
 * Blitz - Disk Worker (OPFS)
 * Handles high-speed, zero-RAM disk I/O using the Origin Private File System.
 * This runs in a separate thread to keep the UI responsive during 3GB+ transfers.
 */

let fileHandle = null;
let accessHandle = null;
const CHUNK_SIZE = 65536;

self.onmessage = async (e) => {
  const { type, payload } = e.data;

  try {
    switch (type) {
      case 'INIT': {
        const { fileName, fileSize } = payload;
        
        // Get OPFS root
        const root = await navigator.storage.getDirectory();
        
        // Create a unique temporary file
        const tempName = `blitz_temp_${Date.now()}_${fileName}`;
        fileHandle = await root.getFileHandle(tempName, { create: true });
        
        // Get access handle (requires worker context for sync access)
        if (fileHandle.createSyncAccessHandle) {
          accessHandle = await fileHandle.createSyncAccessHandle();
          // Pre-allocate space to avoid fragmentation
          accessHandle.truncate(fileSize);
        } else {
          // Fallback for browsers that don't support sync access handle (rare in workers)
          console.warn('[DiskWorker] SyncAccessHandle not supported, performance may be reduced');
        }

        self.postMessage({ type: 'READY', payload: { tempName } });
        break;
      }

      case 'WRITE_CHUNK': {
        const { index, data } = payload;
        const offset = index * CHUNK_SIZE;

        if (accessHandle) {
          accessHandle.write(new Uint8Array(data), { at: offset });
        } else {
          // Fallback to standard writable stream if sync access is missing
          const writable = await fileHandle.createWritable({ keepExistingData: true });
          await writable.write({ type: 'write', position: offset, data });
          await writable.close();
        }

        self.postMessage({ type: 'CHUNK_WRITTEN', payload: { index } });
        break;
      }

      case 'FINALIZE': {
        if (accessHandle) {
          accessHandle.flush();
          accessHandle.close();
          accessHandle = null;
        }

        // Return the final file handle (as a blob or reference)
        const finalFile = await fileHandle.getFile();
        self.postMessage({ type: 'COMPLETE', payload: { file: finalFile } });
        break;
      }

      case 'CLEANUP': {
        if (accessHandle) {
          accessHandle.close();
          accessHandle = null;
        }
        if (fileHandle) {
          // We don't delete here; we keep it until the user downloads
          fileHandle = null;
        }
        break;
      }
    }
  } catch (err) {
    self.postMessage({ type: 'ERROR', payload: err.message });
  }
};
