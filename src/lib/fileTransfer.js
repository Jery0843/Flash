/* ═══════════════════════════════════════════════════════════
   Blitz - File Transfer Engine (Multi-File)
   Transport-agnostic chunking, reassembly, and progress.
   Works with both WebRTC DataChannel and WebSocket relay.
   ═══════════════════════════════════════════════════════════ */

import {
  CHUNK_SIZE,
  BUFFER_HIGH_WATER_MARK,
  BUFFER_LOW_WATER_MARK,
  SPEED_WINDOW_MS,
  MSG,
} from './constants';
import {
  makeFileId,
  initTransfer,
  saveChunk,
  updateReceivedChunks,
  getAllChunks,
  deleteTransfer,
  isAvailable as isDBAvailable,
} from './transferDB';

// ── Binary Header Protocol ─────────────────────────────────
// Each chunk: [4B chunk_index] [4B total_chunks] [payload]
const HEADER_SIZE = 8;
const CHUNKS_PER_BATCH = 16;
const RESUME_POLL_MS = 16;

function encodeChunk(index, total, data) {
  const header = new ArrayBuffer(HEADER_SIZE);
  const view = new DataView(header);
  view.setUint32(0, index);
  view.setUint32(4, total);
  const combined = new Uint8Array(HEADER_SIZE + data.byteLength);
  combined.set(new Uint8Array(header), 0);
  combined.set(new Uint8Array(data), HEADER_SIZE);
  return combined.buffer;
}

function decodeChunk(buffer) {
  const view = new DataView(buffer);
  const index = view.getUint32(0);
  const total = view.getUint32(4);
  const data = buffer.slice(HEADER_SIZE);
  return { index, total, data };
}

function waitForNextFrame() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

// ── Progress Tracker ───────────────────────────────────────
class ProgressTracker {
  constructor(totalBytes) {
    this.totalBytes = totalBytes;
    this.bytesTransferred = 0;
    this.startTime = Date.now();
    this.speedSamples = [];
    this.lastSampleTime = Date.now();
    this.lastSampleBytes = 0;
  }

  update(bytes) {
    this.bytesTransferred += bytes;
    const now = Date.now();

    if (now - this.lastSampleTime >= 200) {
      this.speedSamples.push({
        time: now,
        bytes: this.bytesTransferred,
      });
      const cutoff = now - SPEED_WINDOW_MS;
      this.speedSamples = this.speedSamples.filter((sample) => sample.time >= cutoff);
      this.lastSampleTime = now;
      this.lastSampleBytes = this.bytesTransferred;
    }
  }

  get progress() {
    return this.totalBytes > 0 ? this.bytesTransferred / this.totalBytes : 0;
  }

  get percentage() {
    return Math.min(100, Math.round(this.progress * 100));
  }

  get speed() {
    if (this.speedSamples.length < 2) return 0;
    const oldest = this.speedSamples[0];
    const newest = this.speedSamples[this.speedSamples.length - 1];
    const timeDiff = (newest.time - oldest.time) / 1000;
    if (timeDiff <= 0) return 0;
    return (newest.bytes - oldest.bytes) / timeDiff;
  }

  get eta() {
    const speed = this.speed;
    if (speed <= 0) return Infinity;
    const remaining = this.totalBytes - this.bytesTransferred;
    return remaining / speed;
  }

  get elapsed() {
    return (Date.now() - this.startTime) / 1000;
  }

  getStats() {
    return {
      bytesTransferred: this.bytesTransferred,
      totalBytes: this.totalBytes,
      progress: this.progress,
      percentage: this.percentage,
      speed: this.speed,
      eta: this.eta,
      elapsed: this.elapsed,
    };
  }
}

// ═══════════════════════════════════════════════════════════
// Multi-File Sender
// Sends files sequentially over a single DataChannel.
// Protocol:
//   TEXT: {"ctrl":"file_start", ...}
//   BINARY: chunk 0, chunk 1, ..., chunk N
//   TEXT: {"ctrl":"file_end", index: 0}
//   (repeat for next file)
//   TEXT: {"ctrl":"all_complete"}
// ═══════════════════════════════════════════════════════════

export class FileSender {
  /**
   * @param {File[]} files - Array of files to send
   * @param {object} transport - Must have .send(data), .bufferedAmount, .on('buffer-low', cb)
   */
  constructor(files, transport) {
    this.files = Array.isArray(files) ? files : [files];
    this.transport = transport;
    this.currentFileIndex = 0;
    this.currentChunk = 0;
    this.totalChunks = 0;
    this.paused = false;
    this.cancelled = false;
    this._sending = false;
    this._bufferCleanup = null;
    this._resumeTimer = null;

    // Resume support
    this._controlMessageHandler = null;

    // Overall progress across all files
    const totalBytes = this.files.reduce((sum, f) => sum + f.size, 0);
    this.tracker = new ProgressTracker(totalBytes);

    // Callbacks
    this.onProgress = null;
    this.onComplete = null;
    this.onError = null;
    this.onFileStart = null;

    // Listen for control messages from receiver
    this._setupControlListener();
  }

  _setupControlListener() {
    if (!this.transport.on) return;

    this._controlMessageHandler = (data) => {
      if (typeof data === 'string') {
        try {
          const msg = JSON.parse(data);
          if (msg.ctrl === MSG.FILE_RESUME_REQUEST) {
            this._handleResumeRequest(msg);
          }
        } catch (_) {
          // Ignore parse errors
        }
      }
    };

    this.transport.on('message', this._controlMessageHandler);
  }

  _handleResumeRequest(msg) {
    const { fileIndex, resumeFromChunk } = msg;
    console.log(`[FileSender] Resume request for file ${fileIndex} from chunk ${resumeFromChunk}`);

    // If we're currently sending the requested file, restart from the chunk
    if (fileIndex === this.currentFileIndex && this._sending) {
      this.currentChunk = resumeFromChunk;
      this._sending = false;
      this._scheduleResume(0);
    }

    // Send acknowledgment
    this._sendControl({
      ctrl: 'file_resume_ack',
      fileIndex,
      resumeFromChunk,
    });
  }

  getManifest() {
    return {
      files: this.files.map((f) => ({
        name: f.name,
        size: f.size,
        type: f.type || 'application/octet-stream',
        totalChunks: Math.ceil(f.size / CHUNK_SIZE),
      })),
      totalFiles: this.files.length,
      totalSize: this.files.reduce((sum, f) => sum + f.size, 0),
    };
  }

  async start(resumeFromChunk = 0) {
    if (this._sending) return;

    if (this._pendingResume) {
      resumeFromChunk = this._pendingResume.resumeFromChunk;
    }

    if (this.transport.setBufferThreshold) {
      this.transport.setBufferThreshold(BUFFER_LOW_WATER_MARK);
    }

    this._bufferCleanup = this.transport.on?.('buffer-low', () => {
      this._scheduleResume(0);
    });

    try {
      await this._sendAllFiles(resumeFromChunk);
    } catch (err) {
      if (!this.cancelled) {
        this.onError?.(err);
      }
    }
  }

  pause() {
    this.paused = true;
  }

  resume() {
    if (this.paused) {
      this.paused = false;
      this._scheduleResume(0);
    }
  }

  setResumePosition(fileIndex, resumeFromChunk) {
    console.log(`[FileSender] setResumePosition called for file ${fileIndex} from chunk ${resumeFromChunk}`);
    
    // Always update current position if it's the current file
    if (fileIndex === this.currentFileIndex) {
      this.currentChunk = resumeFromChunk;
      
      // Restart the pump regardless of current state
      this._sending = false;
      this._clearResumeTimer();
      
      // If we have an active pump promise, restart it
      if (this._currentPumpFile) {
        console.log('[FileSender] Restarting pump after resume request');
        this._doPump();
      }
    } else {
      // Store for when _sendAllFiles gets to this file index
      this._pendingResume = { fileIndex, resumeFromChunk };
    }
    
    // Always send ACK back to receiver
    this._sendControl({
      ctrl: MSG.FILE_RESUME_ACK,
      fileIndex,
      resumeFromChunk,
    });
  }

  cancel() {
    this.cancelled = true;
    this.paused = false;
    this._clearResumeTimer();
    this._bufferCleanup?.();
  }

  async _sendAllFiles(resumeFromChunk = 0) {
    let startFileIndex = 0;

    if (this._pendingResume) {
      startFileIndex = this._pendingResume.fileIndex;
      resumeFromChunk = this._pendingResume.resumeFromChunk;
      this._pendingResume = null;
    }

    for (let i = startFileIndex; i < this.files.length; i++) {
      if (this.cancelled) return;

      this.currentFileIndex = i;
      const file = this.files[i];
      this.totalChunks = Math.ceil(file.size / CHUNK_SIZE);

      this.currentChunk = (i === startFileIndex) ? Math.min(resumeFromChunk, this.totalChunks) : 0;

      // Send file_start control message
      this._sendControl({
        ctrl: 'file_start',
        index: i,
        name: file.name,
        size: file.size,
        type: file.type || 'application/octet-stream',
        totalChunks: this.totalChunks,
      });

      this.onFileStart?.(i, file.name);

      // If resuming, update tracker to reflect already-transferred bytes
      const alreadyTransferred = this.currentChunk * CHUNK_SIZE;
      if (alreadyTransferred > 0) {
        this.tracker.update(alreadyTransferred);
      }

      // Send all remaining chunks for this file
      await this._pumpFile(file);

      if (this.cancelled) return;

      // Send file_end control message
      this._sendControl({ ctrl: 'file_end', index: i });
    }

    if (!this.cancelled) {
      this._sendControl({ ctrl: 'all_complete' });
      this._bufferCleanup?.();
      this._clearResumeTimer();
      this.onComplete?.(this.tracker.getStats());
    }
  }

  /**
   * Re-send control messages after reconnection to sync receiver state.
   */
  async resync() {
    if (this.cancelled || !this._currentPumpFile) return;

    console.log('[FileSender] Resyncing state after reconnection...');
    
    // Re-send file_start
    this._sendControl({
      ctrl: 'file_start',
      index: this.currentFileIndex,
      name: this._currentPumpFile.name,
      size: this._currentPumpFile.size,
      type: this._currentPumpFile.type || 'application/octet-stream',
      totalChunks: this.totalChunks,
    });

    // Let the pump continue (it will handle the chunks)
    this._sending = false;
    this._clearResumeTimer();
    this._doPump();
  }

  _sendControl(obj) {
    this.transport.send(JSON.stringify(obj));
  }

  _pumpFile(file) {
    return new Promise((resolve, reject) => {
      this._pumpResolve = resolve;
      this._pumpReject = reject;
      this._currentPumpFile = file;
      this._doPump();
    });
  }

  _doPump() {
    if (this._sending || this.paused || this.cancelled) return;
    this._sending = true;

    const file = this._currentPumpFile;

    const run = async () => {
      try {
        while (this.currentChunk < this.totalChunks && !this.paused && !this.cancelled) {
          let sentInBatch = 0;

          while (
            sentInBatch < CHUNKS_PER_BATCH &&
            this.currentChunk < this.totalChunks &&
            !this.paused &&
            !this.cancelled
          ) {
            const buffered = this.transport.bufferedAmount ?? 0;
            if (buffered >= BUFFER_HIGH_WATER_MARK) {
              this._sending = false;
              this._scheduleResume();
              return;
            }

            const offset = this.currentChunk * CHUNK_SIZE;
            const end = Math.min(offset + CHUNK_SIZE, file.size);
            const blob = file.slice(offset, end);
            const arrayBuffer = await blob.arrayBuffer();
            const encoded = encodeChunk(this.currentChunk, this.totalChunks, arrayBuffer);
            const sent = this.transport.send(encoded);

            if (!sent) {
              throw new Error('Failed to send chunk');
            }

            this.tracker.update(end - offset);
            this.currentChunk += 1;
            sentInBatch += 1;

            this.onProgress?.({
              ...this.tracker.getStats(),
              currentFileIndex: this.currentFileIndex,
              currentFileName: file.name,
              totalFiles: this.files.length,
            });
          }

          if (this.currentChunk < this.totalChunks) {
            await waitForNextFrame();
          }
        }

        if (this.currentChunk >= this.totalChunks && !this.cancelled) {
          this._sending = false;
          this._pumpResolve?.();
        }
      } catch (err) {
        this._sending = false;
        if (!this.cancelled) {
          this._pumpReject?.(err);
        }
      }
    };

    run().catch((err) => {
      this._sending = false;
      if (!this.cancelled) {
        this._pumpReject?.(err);
      }
    });
  }

  _scheduleResume(delay = RESUME_POLL_MS) {
    if (this.paused || this.cancelled || this._resumeTimer) return;

    this._resumeTimer = setTimeout(() => {
      this._resumeTimer = null;
      if (this.paused || this.cancelled) return;

      const buffered = this.transport.bufferedAmount ?? 0;
      if (buffered >= BUFFER_LOW_WATER_MARK) {
        this._scheduleResume();
        return;
      }

      this._doPump();
    }, delay);
  }

  _clearResumeTimer() {
    if (this._resumeTimer) {
      clearTimeout(this._resumeTimer);
      this._resumeTimer = null;
    }
  }
}

// ═══════════════════════════════════════════════════════════
// Multi-File Receiver
// ═══════════════════════════════════════════════════════════

export class FileReceiver {
  /**
   * @param {object} manifest - { files: [{name, size, type, totalChunks}], totalSize, totalFiles }
   * @param {object} [signaling] - Optional signaling client for sending resume requests
   * @param {string} [roomCode] - Optional room code for generating persistent fileIds
   * @param {string} [peerId] - Optional peer ID for multi-peer resume requests
   */
  constructor(manifest, signaling = null, roomCode = null, peerId = null) {
    this.manifest = manifest;
    const safeFiles = Array.isArray(manifest?.files) ? manifest.files : [];
    const derivedTotalSize = safeFiles.reduce((sum, f) => sum + (Number(f?.size) || 0), 0);
    this.totalSize = Number(manifest?.totalSize) > 0 ? Number(manifest.totalSize) : derivedTotalSize;
    this.totalFiles = Number(manifest?.totalFiles) > 0 ? Number(manifest.totalFiles) : safeFiles.length;
    this.receivedFiles = [];
    this.tracker = new ProgressTracker(this.totalSize);

    // Resume support
    this.signaling = signaling;
    this.roomCode = roomCode;
    this.peerId = peerId;
    this.dbEnabled = false;
    this.currentFileId = null;
    this.pendingChunks = new Set();

    // Current file state
    this.currentFileMeta = null;
    this.receivedChunkCount = 0;
    this.receivedChunksSet = new Set(); // Optimized tracking
    this._dbUpdateTimer = null;
    this.cancelled = false;

    // OPFS / Disk Worker state
    this.diskWorker = null;
    this.diskWorkerReady = false;
    this._pendingWorkerChunks = [];
    this.useOPFS = false;

    // Callbacks
    this.onProgress = null;
    this.onFileComplete = null;
    this.onComplete = null;
    this.onError = null;

    // Message Queue for sequential processing
    this._messageQueue = [];
    this._processingQueue = false;

    // Initialize DB support
    this._initDB();
    this._initDiskWorker();
  }

  _initDiskWorker() {
    // Check if browser supports OPFS
    if (typeof Worker !== 'undefined' && navigator.storage && navigator.storage.getDirectory) {
      try {
        this.diskWorker = new Worker(new URL('./diskWorker.js', import.meta.url), { type: 'module' });
        this.diskWorker.onmessage = (e) => this._handleWorkerMessage(e.data);
        this.useOPFS = true;
      } catch (err) {
        console.warn('[FileReceiver] DiskWorker failed to initialize:', err);
        this.useOPFS = false;
      }
    } else {
      console.log('[FileReceiver] OPFS not supported, using IndexedDB fallback');
      this.useOPFS = false;
    }
  }

  _handleWorkerMessage(msg) {
    const { type, payload } = msg;

    switch (type) {
      case 'READY':
        console.log('[FileReceiver] DiskWorker ready:', payload.tempName);
        this.diskWorkerReady = true;
        // Process any chunks that arrived while worker was starting
        const chunksToSend = [...this._pendingWorkerChunks];
        this._pendingWorkerChunks = []; // Clear immediately to free memory
        for (const chunk of chunksToSend) {
          this.diskWorker.postMessage({ type: 'WRITE_CHUNK', payload: chunk }, [chunk.data]);
        }
        break;

      case 'CHUNK_WRITTEN':
        // Chunk successfully written to disk, we can ignore this for now
        break;

      case 'COMPLETE':
        this._onFileAssembled(payload.file);
        break;

      case 'ERROR':
        console.error('[FileReceiver] DiskWorker error:', payload);
        this.onError?.(new Error(`Disk Error: ${payload}`));
        break;
    }
  }

  // Buffer chunks when worker isn't ready
  _bufferChunkForWorker(index, data) {
    // Limit queue size to prevent memory buildup (max 100 chunks = ~6.4MB)
    if (this._pendingWorkerChunks.length < 100) {
      this._pendingWorkerChunks.push({ index, data });
      return true;
    }
    return false;
  }

  async _initDB() {
    this.dbEnabled = await isDBAvailable();
    
    // Request persistent storage to prevent eviction during transfer
    if (navigator.storage && navigator.storage.persist) {
      const isPersisted = await navigator.storage.persist();
      console.log('[FileReceiver] Persistent storage:', isPersisted ? 'granted' : 'denied');
    }
    
    // Check if we have enough storage quota for this transfer
    if (this.dbEnabled && navigator.storage && navigator.storage.estimate) {
      try {
        const estimate = await navigator.storage.estimate();
        const available = estimate.quota - estimate.usage;
        const needed = this.totalSize;
        
        console.log(`[FileReceiver] Storage: ${(available / 1024 / 1024 / 1024).toFixed(2)} GB available, ${(needed / 1024 / 1024 / 1024).toFixed(2)} GB needed`);
        console.log(`[FileReceiver] OPFS available: ${this.useOPFS}`);
        
        if (available < needed && !this.useOPFS) {
          console.warn(`[FileReceiver] Insufficient storage: need ${(needed / 1024 / 1024 / 1024).toFixed(2)} GB but only ${(available / 1024 / 1024 / 1024).toFixed(2)} GB available`);
          // Disable IndexedDB to avoid quota errors, rely on OPFS or fail gracefully
          if (!this.useOPFS) {
            this.onError?.(new Error(`Insufficient storage: ${(needed / 1024 / 1024 / 1024).toFixed(2)} GB needed but only ${(available / 1024 / 1024 / 1024).toFixed(2)} GB available`));
          }
        }
      } catch (err) {
        console.warn('[FileReceiver] Could not estimate storage:', err);
      }
    }
  }

  handleMessage(data) {
    if (this.cancelled) return;
    this._messageQueue.push(data);
    this._processQueue();
  }

  async _processQueue() {
    if (this._processingQueue) return;
    this._processingQueue = true;

    try {
      while (this._messageQueue.length > 0) {
        if (this.cancelled) {
          this._messageQueue = [];
          break;
        }
        const data = this._messageQueue.shift();
        if (typeof data === 'string') {
          await this._handleControl(data);
        } else if (data instanceof ArrayBuffer) {
          await this._handleChunk(data);
        }
      }
    } finally {
      this._processingQueue = false;
    }
  }

  cancel() {
    this.cancelled = true;
    this._fallbackChunks = null;
    this._clearDbUpdateTimer();
  }

  _clearDbUpdateTimer() {
    if (this._dbUpdateTimer) {
      clearTimeout(this._dbUpdateTimer);
      this._dbUpdateTimer = null;
    }
  }

  async _handleControl(raw) {
    // Ignore ping/pong messages
    if (raw === 'ping' || raw === 'pong') return;
    
    try {
      const msg = JSON.parse(raw);

      switch (msg.ctrl) {
        case 'file_start': {
          console.log(`[FileReceiver] Received file_start for file ${msg.index}: ${msg.name}`);
          
          // Clear any pending state from previous file
          this._fallbackChunks = null;
          this.receivedChunksSet.clear();
          this.receivedChunkCount = 0;
          this.currentFileId = null;
          
          this.currentFileMeta = {
            index: msg.index,
            name: msg.name,
            size: msg.size,
            type: msg.type,
            totalChunks: msg.totalChunks,
          };

          // Initialize Disk Worker for this file
          if (this.diskWorker) {
            console.log(`[FileReceiver] Initializing disk worker for file ${msg.index}`);
            this.diskWorkerReady = false;
            this.diskWorker.postMessage({
              type: 'INIT',
              payload: { fileName: msg.name, fileSize: msg.size, chunkSize: CHUNK_SIZE }
            });
          }

          // Check IndexedDB for existing chunks to resume
          if (this.roomCode && this.dbEnabled) {
            this.currentFileId = makeFileId(this.roomCode, msg.name, msg.size);
            await this._tryResume();
          }
          break;
        }

        case MSG.FILE_RESUME_ACK: {
          // Sender acknowledged our resume request; chunks will arrive soon
          console.log('[FileReceiver] Resume acknowledged, starting from chunk', msg.resumeFromChunk);
          break;
        }

        case 'file_end':
          console.log(`[FileReceiver] Received file_end. Current file: ${this.currentFileMeta?.name}, chunks: ${this.receivedChunkCount}/${this.currentFileMeta?.totalChunks}`);
          if (this.currentFileMeta && this.receivedChunkCount === this.currentFileMeta.totalChunks) {
            await this._assembleCurrentFile();
          } else if (this.currentFileMeta) {
            console.warn(`[FileReceiver] file_end received but chunks incomplete: ${this.receivedChunkCount}/${this.currentFileMeta.totalChunks}`);
          }
          break;

        case 'all_complete': {
          console.log('[FileReceiver] All files complete. Internal receivedFiles:', this.receivedFiles.length);
          this.onComplete?.({
            files: this.receivedFiles,
            stats: this.tracker.getStats(),
          });
          break;
        }

        default:
          console.warn('[FileReceiver] Unknown control message:', msg.ctrl);
      }
    } catch (err) {
      console.error('[FileReceiver] Failed to parse control message:', err);
    }
  }

  async _tryResume() {
    try {
      const transfer = await initTransfer({
        fileId: this.currentFileId,
        name: this.currentFileMeta.name,
        size: this.currentFileMeta.size,
        type: this.currentFileMeta.type,
        totalChunks: this.currentFileMeta.totalChunks,
      });

      if (transfer && transfer.receivedChunks.length > 0) {
        console.log(
          `[FileReceiver] Found ${transfer.receivedChunks.length} chunks in IndexedDB, requesting resume`
        );

        // Track received chunks in the set
        for (const idx of transfer.receivedChunks) {
          this.receivedChunksSet.add(idx);
        }
        this.receivedChunkCount = transfer.receivedChunks.length;

        // Update tracker
        const alreadyTransferred = this.receivedChunkCount * CHUNK_SIZE;
        if (alreadyTransferred > 0) {
          this.tracker.update(Math.min(alreadyTransferred, this.currentFileMeta.size));
        }

        // Send resume request to sender via signaling
        const resumeFromChunk = this.receivedChunkCount;
        if (this.signaling && this.signaling.send) {
          console.log(`[FileReceiver] Sending file_resume_request for file ${this.currentFileMeta.index} from chunk ${resumeFromChunk}`);
          this.signaling.send(MSG.FILE_RESUME_REQUEST, {
            peerId: this.peerId,
            fileIndex: this.currentFileMeta.index,
            resumeFromChunk,
          });
        }
      }
    } catch (err) {
      console.warn('[FileReceiver] Resume check failed:', err);
    }
  }

  /**
   * Public method to trigger resume (called after reconnection)
   */
  async triggerResume() {
    if (this.currentFileId && this.currentFileMeta) {
      console.log('[FileReceiver] Manually triggering resume after reconnection');
      await this._tryResume();
      
      // Set a timeout to retry if no chunks arrive (maybe the request was lost)
      if (this._resumeTimeout) {
        clearTimeout(this._resumeTimeout);
      }
      
      const lastChunkCount = this.receivedChunkCount;
      this._resumeTimeout = setTimeout(() => {
        // If we haven't received any new chunks in 5 seconds, try again
        if (this.receivedChunkCount === lastChunkCount && 
            this.currentFileMeta && 
            this.receivedChunkCount < this.currentFileMeta.totalChunks &&
            !this.cancelled) {
          console.log('[FileReceiver] No chunks received after resume, retrying...');
          this.triggerResume();
        }
      }, 5000);
    }
  }

  async _handleChunk(buffer) {
    if (!this.currentFileMeta) {
      console.warn('[FileReceiver] Received chunk but no currentFileMeta set!');
      // Still process the chunk but don't track it - it might be for the next file
      // The sender will re-send it when we request resume
      return;
    }

    try {
      const { index, total, data } = decodeChunk(buffer);

      if (index < 0 || index >= total || total !== this.currentFileMeta.totalChunks) {
        console.warn('[FileReceiver] Invalid chunk:', index, 'of', total);
        return;
      }

      if (this.receivedChunksSet.has(index)) return;

      // Log first and last chunks
      if (index === 0 || index === total - 1 || index % 500 === 0) {
        console.log(`[FileReceiver] Chunk ${index}/${total} for file ${this.currentFileMeta.index}: ${this.currentFileMeta.name}`);
      }

      // Clear resume timeout since we're receiving chunks
      if (this._resumeTimeout) {
        clearTimeout(this._resumeTimeout);
        this._resumeTimeout = null;
      }

      const chunkSize = data.byteLength;

      // Save to IndexedDB only if OPFS is NOT available (for resume capability)
      // When OPFS is available, we rely on disk storage instead of IndexedDB
      if (this.currentFileId && this.dbEnabled && !this.useOPFS) {
        const saved = await saveChunk(this.currentFileId, index, data);
        if (!saved) {
          // IndexedDB write failed (likely quota exceeded)
          console.error('[FileReceiver] IndexedDB write failed for chunk', index);
          this.onError?.(new Error('Storage quota exceeded. Please free up disk space.'));
          this.cancel();
          return;
        }
        this._throttleDbUpdate();
      }

      // Stream to Disk Worker (OPFS) - This is the primary storage for large files
      if (this.useOPFS && this.diskWorker) {
        if (this.diskWorkerReady) {
          // Transfer ownership of the ArrayBuffer to the worker (zero-copy)
          this.diskWorker.postMessage({ type: 'WRITE_CHUNK', payload: { index, data } }, [data]);
        } else {
          // Worker not ready yet, try to buffer the chunk
          const buffered = this._bufferChunkForWorker(index, data);
          if (!buffered) {
            // Buffer is full, fall back to IndexedDB
            console.warn('[FileReceiver] Worker buffer full, using IndexedDB fallback for chunk', index);
            if (this.currentFileId && this.dbEnabled) {
              await saveChunk(this.currentFileId, index, data);
            }
          }
        }
      } else if (this.currentFileId && this.dbEnabled) {
        // Save to IndexedDB if OPFS is not available
        await saveChunk(this.currentFileId, index, data);
      } else {
        // Fallback to RAM ONLY if both OPFS and IndexedDB are unavailable
        // NOTE: For 3GB files, this WILL crash if IndexedDB is also disabled.
        if (!this._fallbackChunks) this._fallbackChunks = [];
        this._fallbackChunks[index] = data;
      }
      // If IndexedDB is enabled, chunks are already saved there - no need for RAM storage
      // The 'data' ArrayBuffer is now owned by the worker (if OPFS) or will be GC'd

      this.receivedChunkCount++;
      this.receivedChunksSet.add(index);
      this.tracker.update(chunkSize);

      this.onProgress?.({
        ...this.tracker.getStats(),
        currentFileIndex: this.currentFileMeta.index,
        currentFileName: this.currentFileMeta.name,
        totalFiles: this.totalFiles,
        filesReceived: this.receivedFiles.length,
      });

      // Log memory usage periodically (every 100 chunks = ~6.4MB)
      if (index % 100 === 0) {
        if (performance.memory) {
          const memMB = (performance.memory.usedJSHeapSize / 1024 / 1024).toFixed(0);
          const limitMB = (performance.memory.jsHeapSizeLimit / 1024 / 1024).toFixed(0);
          const usagePercent = ((performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100).toFixed(1);
          console.log(`[FileReceiver] Memory: ${memMB}MB / ${limitMB}MB (${usagePercent}%)`);
          
          // If memory usage is above 80%, warn and try to trigger GC
          if (usagePercent > 80) {
            console.warn('[FileReceiver] High memory usage detected, attempting cleanup...');
            // Clear any cached data that's not essential
            if (this._pendingWorkerChunks.length === 0) {
              this._pendingWorkerChunks = [];
            }
          }
        }
        
        // Periodically yield to the event loop to prevent blocking
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      // The file_end control message is guaranteed to follow the last chunk
      // in the WebRTC DataChannel (which is ordered).
      // We rely on 'file_end' to call _assembleCurrentFile() if it arrives last,
      // or we can call it here if we hit the chunk count.
      // Since _assembleCurrentFile sets currentFileMeta to null, it's safe if both try to call it.
      if (this.currentFileMeta && this.receivedChunkCount === this.currentFileMeta.totalChunks) {
        await this._assembleCurrentFile();
      }
    } catch (err) {
      this.onError?.(err);
    }
  }

  _throttleDbUpdate() {
    if (this._dbUpdateTimer) return;

    // Update DB every 1000ms or when complete
    this._dbUpdateTimer = setTimeout(async () => {
      this._dbUpdateTimer = null;
      if (!this.currentFileId || this.cancelled) return;
      
      try {
        await updateReceivedChunks(this.currentFileId, Array.from(this.receivedChunksSet));
      } catch (err) {
        console.warn('[FileReceiver] Failed to update received chunks list:', err);
      }
    }, 1000);
  }

  async _assembleCurrentFile() {
    if (!this.currentFileMeta) return;

    this._clearDbUpdateTimer();

    try {
      if (this.useOPFS && this.diskWorker) {
        console.log('[FileReceiver] Finalizing disk file...');
        this.diskWorker.postMessage({ type: 'FINALIZE' });
        // Completion will be handled in _handleWorkerMessage ('COMPLETE' event)
      } else if (this.currentFileId && this.dbEnabled) {
        // Assemble from IndexedDB
        console.log('[FileReceiver] Assembling file from IndexedDB...');
        const chunksToAssemble = await getAllChunks(this.currentFileId);
        const blob = new Blob(
          chunksToAssemble.map((chunk) => new Uint8Array(chunk)),
          { type: this.currentFileMeta.type }
        );
        this._onFileAssembled(blob);
      } else if (this._fallbackChunks) {
        // RAM fallback (only for small files when both OPFS and IndexedDB fail)
        console.log('[FileReceiver] Assembling file from RAM...');
        const blob = new Blob(
          this._fallbackChunks.map((chunk) => new Uint8Array(chunk)),
          { type: this.currentFileMeta.type }
        );
        this._onFileAssembled(blob);
      } else {
        this.onError?.(new Error('No storage method available for file assembly'));
      }
    } catch (err) {
      this.onError?.(err);
    }
  }

  _onFileAssembled(fileOrBlob) {
    if (!this.currentFileMeta) return;

    const fileResult = {
      blob: fileOrBlob,
      name: this.currentFileMeta.name,
      type: this.currentFileMeta.type,
      size: this.currentFileMeta.size,
      index: this.currentFileMeta.index,
    };

    this.receivedFiles.push(fileResult);
    console.log(`[FileReceiver] File ${this.currentFileMeta.index + 1} assembled: ${this.currentFileMeta.name}, total files: ${this.receivedFiles.length}`);
    this.onFileComplete?.(this.currentFileMeta.index, fileResult);

    // Clean up IndexedDB for completed file
    if (this.currentFileId && this.dbEnabled) {
      deleteTransfer(this.currentFileId).catch((err) => {
        console.warn('[FileReceiver] Failed to cleanup IndexedDB:', err);
      });
    }

    // Clean up disk worker for next file
    if (this.diskWorker) {
      console.log('[FileReceiver] Cleaning up disk worker for next file');
      this.diskWorker.postMessage({ type: 'CLEANUP' });
      this.diskWorkerReady = false; // Reset ready state
    }

    // With the sequential message queue, we can safely clear state here
    this._fallbackChunks = null;
    this.receivedChunksSet.clear();
    this.receivedChunkCount = 0;
    this.currentFileId = null;
    this.currentFileMeta = null;
    
    console.log('[FileReceiver] State cleared, ready for next file');
  }
}

// ═══════════════════════════════════════════════════════════
// Transport Adapter — wraps DataChannel or WebSocket
// ═══════════════════════════════════════════════════════════

export function createTransport(channel) {
  const listeners = new Map();

  const transport = {
    send(data) {
      try {
        channel.send(data);
        return true;
      } catch {
        return false;
      }
    },

    get bufferedAmount() {
      return channel.bufferedAmount || 0;
    },

    setBufferThreshold(threshold) {
      if ('bufferedAmountLowThreshold' in channel) {
        channel.bufferedAmountLowThreshold = threshold;
      }
    },

    on(event, callback) {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event).add(callback);

      if (event === 'buffer-low') {
        channel.onbufferedamountlow = () => {
          listeners.get('buffer-low')?.forEach((cb) => cb());
        };
      }

      if (event === 'message') {
        // Wire up data channel messages to the transport
        const handler = (event) => {
          listeners.get('message')?.forEach((cb) => cb(event.data));
        };
        channel.onmessage = handler;
      }

      return () => {
        listeners.get(event)?.delete(callback);
      };
    },

    close() {
      channel.close?.();
    },
  };

  return transport;
}

/**
 * Download a blob as a file.
 */
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
