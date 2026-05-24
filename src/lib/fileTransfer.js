/* ═══════════════════════════════════════════════════════════
   Flash - File Transfer Engine (Multi-File)
   Transport-agnostic chunking, reassembly, and progress.
   Works with both WebRTC DataChannel and WebSocket relay.
   ═══════════════════════════════════════════════════════════ */

import {
  CHUNK_SIZE,
  BUFFER_HIGH_WATER_MARK,
  BUFFER_LOW_WATER_MARK,
  SPEED_WINDOW_MS,
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
          if (msg.ctrl === 'file_resume_request') {
            this._handleResumeRequest(msg);
          }
        } catch (err) {
          // Ignore parse errors
        }
      }
    };

    // Note: This assumes the transport emits messages via an event emitter
    // For WebRTC, we'll need to wire this up differently in the integration layer
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

  cancel() {
    this.cancelled = true;
    this.paused = false;
    this._clearResumeTimer();
    this._bufferCleanup?.();
  }

  async _sendAllFiles(resumeFromChunk = 0) {
    for (let i = 0; i < this.files.length; i++) {
      if (this.cancelled) return;

      this.currentFileIndex = i;
      const file = this.files[i];
      this.totalChunks = Math.ceil(file.size / CHUNK_SIZE);

      // Support resuming from a specific chunk
      this.currentChunk = Math.min(resumeFromChunk, this.totalChunks);

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
   */
  constructor(manifest, signaling = null, roomCode = null) {
    this.manifest = manifest;
    this.totalSize = manifest.totalSize;
    this.totalFiles = manifest.totalFiles;
    this.receivedFiles = [];
    this.tracker = new ProgressTracker(this.totalSize);

    // Resume support
    this.signaling = signaling;
    this.roomCode = roomCode;
    this.dbEnabled = false;
    this.currentFileId = null;
    this.pendingChunks = new Set();

    // Current file state
    this.currentFileMeta = null;
    this.chunks = null;
    this.receivedChunkCount = 0;
    this.cancelled = false;

    // Callbacks
    this.onProgress = null;
    this.onFileComplete = null;
    this.onComplete = null;
    this.onError = null;

    // Initialize DB support
    this._initDB();
  }

  async _initDB() {
    this.dbEnabled = await isDBAvailable();
  }

  /**
   * Handle incoming DataChannel message.
   * Can be a string (JSON control) or ArrayBuffer (binary chunk).
   */
  handleMessage(data) {
    if (this.cancelled) return;

    if (typeof data === 'string') {
      this._handleControl(data);
    } else if (data instanceof ArrayBuffer) {
      this._handleChunk(data);
    }
  }

  cancel() {
    this.cancelled = true;
    this.chunks = null;
  }

  _handleControl(raw) {
    try {
      const msg = JSON.parse(raw);

      switch (msg.ctrl) {
        case 'file_start': {
          this.currentFileMeta = {
            index: msg.index,
            name: msg.name,
            size: msg.size,
            type: msg.type,
            totalChunks: msg.totalChunks,
          };
          this.chunks = new Array(msg.totalChunks);
          this.receivedChunkCount = 0;

          // Check IndexedDB for existing chunks to resume
          if (this.roomCode && this.dbEnabled) {
            this.currentFileId = makeFileId(this.roomCode, msg.name, msg.size);
            this._tryResume();
          }
          break;
        }

        case 'file_resume_ack': {
          // Sender acknowledged our resume request; chunks will arrive soon
          console.log('[FileReceiver] Resume acknowledged, starting from chunk', msg.resumeFromChunk);
          break;
        }

        case 'file_end':
          if (this.currentFileMeta && this.receivedChunkCount === this.currentFileMeta.totalChunks) {
            this._assembleCurrentFile();
          }
          break;

        case 'all_complete': {
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

        // Restore chunks into memory
        const chunkData = await getAllChunks(this.currentFileId);
        for (let i = 0; i < chunkData.length; i++) {
          const idx = transfer.receivedChunks[i];
          if (idx !== undefined) {
            this.chunks[idx] = chunkData[i];
          }
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
          this.signaling.send('file_resume_request', {
            fileIndex: this.currentFileMeta.index,
            resumeFromChunk,
          });
        }
      }
    } catch (err) {
      console.warn('[FileReceiver] Resume check failed:', err);
    }
  }

  async _handleChunk(buffer) {
    if (!this.currentFileMeta || !this.chunks) return;

    try {
      const { index, total, data } = decodeChunk(buffer);

      if (index < 0 || index >= total || total !== this.currentFileMeta.totalChunks) {
        console.warn('[FileReceiver] Invalid chunk:', index, 'of', total);
        return;
      }

      if (this.chunks[index]) return;

      this.chunks[index] = data;
      this.receivedChunkCount++;
      this.tracker.update(data.byteLength);

      // Persist chunk to IndexedDB
      if (this.currentFileId && this.dbEnabled) {
        await saveChunk(this.currentFileId, index, data);
        await updateReceivedChunks(this.currentFileId, this.chunks.map((c, i) => c ? i : null).filter(i => i !== null));
      }

      this.onProgress?.({
        ...this.tracker.getStats(),
        currentFileIndex: this.currentFileMeta.index,
        currentFileName: this.currentFileMeta.name,
        totalFiles: this.totalFiles,
        filesReceived: this.receivedFiles.length,
      });

      if (this.receivedChunkCount === this.currentFileMeta.totalChunks) {
        this._assembleCurrentFile();
      }
    } catch (err) {
      this.onError?.(err);
    }
  }

  _assembleCurrentFile() {
    if (!this.currentFileMeta || !this.chunks) return;

    try {
      const blob = new Blob(
        this.chunks.map((chunk) => new Uint8Array(chunk)),
        { type: this.currentFileMeta.type }
      );

      const fileResult = {
        blob,
        name: this.currentFileMeta.name,
        type: this.currentFileMeta.type,
        size: this.currentFileMeta.size,
        index: this.currentFileMeta.index,
      };

      this.receivedFiles.push(fileResult);
      this.onFileComplete?.(this.currentFileMeta.index, fileResult);

      // Clean up IndexedDB for completed file
      if (this.currentFileId && this.dbEnabled) {
        deleteTransfer(this.currentFileId).catch((err) => {
          console.warn('[FileReceiver] Failed to cleanup IndexedDB:', err);
        });
      }

      this.chunks = null;
      this.currentFileMeta = null;
      this.receivedChunkCount = 0;
      this.currentFileId = null;
    } catch (err) {
      this.onError?.(err);
    }
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
