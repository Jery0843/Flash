/* ═══════════════════════════════════════════════════════════
   Flash — File Transfer Engine
   Transport-agnostic chunking, reassembly, and progress.
   Works with both WebRTC DataChannel and WebSocket relay.
   ═══════════════════════════════════════════════════════════ */

import { CHUNK_SIZE, BUFFER_THRESHOLD, SPEED_WINDOW_MS } from './constants';

// ── Binary Header Protocol ─────────────────────────────────
// Each chunk: [4B chunk_index] [4B total_chunks] [payload]
const HEADER_SIZE = 8;

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

    // Record sample for speed calculation
    if (now - this.lastSampleTime >= 200) {
      this.speedSamples.push({
        time: now,
        bytes: this.bytesTransferred,
      });
      // Keep only samples within the speed window
      const cutoff = now - SPEED_WINDOW_MS;
      this.speedSamples = this.speedSamples.filter(s => s.time >= cutoff);
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
// File Sender
// ═══════════════════════════════════════════════════════════

export class FileSender {
  /**
   * @param {File} file - The file to send
   * @param {object} transport - Must have .send(data), .bufferedAmount, .on('buffer-low', cb)
   */
  constructor(file, transport) {
    this.file = file;
    this.transport = transport;
    this.totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    this.currentChunk = 0;
    this.paused = false;
    this.cancelled = false;
    this.tracker = new ProgressTracker(file.size);
    this.onProgress = null;
    this.onComplete = null;
    this.onError = null;
    this._sending = false;
  }

  /**
   * Get file metadata for the receiver.
   */
  getMetadata() {
    return {
      name: this.file.name,
      size: this.file.size,
      type: this.file.type || 'application/octet-stream',
      totalChunks: this.totalChunks,
      chunkSize: CHUNK_SIZE,
    };
  }

  /**
   * Start sending the file.
   */
  async start() {
    if (this._sending) return;
    this._sending = true;

    // Set buffer threshold for backpressure
    if (this.transport.setBufferThreshold) {
      this.transport.setBufferThreshold(BUFFER_THRESHOLD);
    }

    // Listen for buffer drain events
    const bufferCleanup = this.transport.on?.('buffer-low', () => {
      if (!this.paused && !this.cancelled) {
        this._sendChunks();
      }
    });

    try {
      await this._sendChunks();
    } catch (err) {
      if (!this.cancelled) {
        this.onError?.(err);
      }
    } finally {
      bufferCleanup?.();
    }
  }

  pause() {
    this.paused = true;
  }

  resume() {
    if (this.paused) {
      this.paused = false;
      this._sendChunks();
    }
  }

  cancel() {
    this.cancelled = true;
    this.paused = false;
  }

  async _sendChunks() {
    while (
      this.currentChunk < this.totalChunks &&
      !this.paused &&
      !this.cancelled
    ) {
      // Backpressure: wait if buffer is full
      const buffered = this.transport.bufferedAmount ?? 0;
      if (buffered > BUFFER_THRESHOLD) {
        return; // Will resume on 'buffer-low' event
      }

      const offset = this.currentChunk * CHUNK_SIZE;
      const end = Math.min(offset + CHUNK_SIZE, this.file.size);
      const blob = this.file.slice(offset, end);

      try {
        const arrayBuffer = await blob.arrayBuffer();
        const encoded = encodeChunk(this.currentChunk, this.totalChunks, arrayBuffer);
        
        const sent = this.transport.send(encoded);
        if (!sent) {
          throw new Error('Failed to send chunk');
        }

        this.tracker.update(end - offset);
        this.currentChunk++;
        this.onProgress?.(this.tracker.getStats());
      } catch (err) {
        if (!this.cancelled) {
          this.onError?.(err);
        }
        return;
      }
    }

    if (this.currentChunk >= this.totalChunks && !this.cancelled) {
      this.onComplete?.(this.tracker.getStats());
    }
  }
}

// ═══════════════════════════════════════════════════════════
// File Receiver
// ═══════════════════════════════════════════════════════════

export class FileReceiver {
  /**
   * @param {object} metadata - { name, size, type, totalChunks }
   */
  constructor(metadata) {
    this.metadata = metadata;
    this.chunks = new Array(metadata.totalChunks);
    this.receivedCount = 0;
    this.tracker = new ProgressTracker(metadata.size);
    this.onProgress = null;
    this.onComplete = null;
    this.onError = null;
    this.cancelled = false;
  }

  /**
   * Handle a received chunk (binary data).
   */
  handleChunk(buffer) {
    if (this.cancelled) return;

    try {
      const { index, total, data } = decodeChunk(buffer);

      // Validate chunk
      if (index < 0 || index >= total || total !== this.metadata.totalChunks) {
        console.warn('[FileReceiver] Invalid chunk:', index, 'of', total);
        return;
      }

      // Avoid duplicate chunks
      if (this.chunks[index]) return;

      this.chunks[index] = data;
      this.receivedCount++;
      this.tracker.update(data.byteLength);
      this.onProgress?.(this.tracker.getStats());

      // Check completion
      if (this.receivedCount === this.metadata.totalChunks) {
        this._assemble();
      }
    } catch (err) {
      this.onError?.(err);
    }
  }

  cancel() {
    this.cancelled = true;
    this.chunks = [];
  }

  _assemble() {
    try {
      const blob = new Blob(this.chunks.map(c => new Uint8Array(c)), {
        type: this.metadata.type,
      });
      
      // Free chunk memory
      this.chunks = [];
      
      this.onComplete?.({
        blob,
        metadata: this.metadata,
        stats: this.tracker.getStats(),
      });
    } catch (err) {
      this.onError?.(err);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// Transport Adapter — wraps DataChannel or WebSocket
// ═══════════════════════════════════════════════════════════

/**
 * Creates a unified transport interface from either a
 * WebRTC DataChannel or a WebSocket connection.
 */
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

      // Map to native events
      if (event === 'buffer-low') {
        channel.onbufferedamountlow = () => {
          listeners.get('buffer-low')?.forEach(cb => cb());
        };
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
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 100);
}
