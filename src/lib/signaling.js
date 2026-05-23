/* ═══════════════════════════════════════════════════════════
   Flash — Signaling Client
   WebSocket client for the signaling server (Durable Object)
   ═══════════════════════════════════════════════════════════ */

import { SIGNALING_URL, MAX_RECONNECT_ATTEMPTS, MSG } from './constants';

/**
 * SignalingClient manages the WebSocket connection to the signaling server.
 * Uses an event emitter pattern for incoming messages.
 *
 * All signaling happens over WSS (TLS). Messages are JSON with strict types.
 */
export class SignalingClient {
  constructor(url = SIGNALING_URL) {
    this.url = url;
    this.ws = null;
    this.listeners = new Map();
    this.reconnectAttempts = 0;
    this.intentionalClose = false;
    this.suppressNextDisconnectEvent = false;
    this.token = null;
    this.roomCode = null;
    this.pingInterval = null;
    this.lastQueryParams = {};
    this.lastQueryKey = '';
  }

  /**
   * Connect to the signaling server.
   * Returns a promise that resolves when connected.
   */
  connect(queryParams = {}) {
    return new Promise((resolve, reject) => {
      const normalizedParams = this._normalizeQueryParams(queryParams);
      const nextQueryKey = this._getQueryKey(normalizedParams);

      if (this.ws?.readyState === WebSocket.OPEN && this.lastQueryKey === nextQueryKey) {
        resolve();
        return;
      }

      if (this.ws && this.lastQueryKey !== nextQueryKey) {
        this._closeSocket({ intentional: true, suppressDisconnectEvent: true, reason: 'Switching rooms' });
      }

      this.lastQueryParams = normalizedParams;
      this.lastQueryKey = nextQueryKey;
      this.intentionalClose = false;

      try {
        const urlObj = new URL(this.url);
        for (const [k, v] of Object.entries(normalizedParams)) {
          urlObj.searchParams.set(k, v);
        }
        this.ws = new WebSocket(urlObj.toString());
        this.ws.binaryType = 'arraybuffer';
      } catch {
        reject(new Error('Failed to create WebSocket connection'));
        return;
      }

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this._startPing();
        resolve();
      };

      this.ws.onmessage = (event) => {
        this._handleMessage(event.data);
      };

      this.ws.onclose = (event) => {
        const shouldEmitDisconnect = !this.suppressNextDisconnectEvent;
        this.suppressNextDisconnectEvent = false;
        this._stopPing();
        this.ws = null;

        if (!this.intentionalClose && this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          this.reconnectAttempts++;
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
          setTimeout(() => this.connect(this.lastQueryParams).catch(() => {}), delay);
        }

        if (shouldEmitDisconnect) {
          this._emit('disconnected', { code: event.code, reason: event.reason });
        }
      };

      this.ws.onerror = () => {
        reject(new Error('WebSocket connection failed'));
      };
    });
  }

  /**
   * Send a typed message to the signaling server.
   * Validates message type before sending.
   */
  send(type, payload = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[Signaling] Not connected, cannot send:', type);
      return false;
    }

    const validTypes = Object.values(MSG);
    if (!validTypes.includes(type)) {
      console.error('[Signaling] Unknown message type:', type);
      return false;
    }

    const message = JSON.stringify({
      type,
      payload,
      token: this.token,
      timestamp: Date.now(),
    });

    if (message.length > 16384) {
      console.error('[Signaling] Message too large:', message.length);
      return false;
    }

    this.ws.send(message);
    return true;
  }

  /**
   * Send binary data (for WS relay fallback).
   */
  sendBinary(data) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(data);
    return true;
  }

  /**
   * Register an event listener.
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  /**
   * Remove an event listener.
   */
  off(event, callback) {
    this.listeners.get(event)?.delete(callback);
  }

  /**
   * Close the connection.
   */
  disconnect() {
    this._closeSocket({ intentional: true, suppressDisconnectEvent: false, reason: 'Client disconnect' });
    this.listeners.clear();
    this.token = null;
    this.roomCode = null;
    this.lastQueryParams = {};
    this.lastQueryKey = '';
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  // ── Private Methods ────────────────────────────────────

  _handleMessage(data) {
    if (data instanceof ArrayBuffer) {
      this._emit(MSG.WS_RELAY_CHUNK, data);
      return;
    }

    try {
      const message = JSON.parse(data);
      const { type, payload = {} } = message;

      if (!type) {
        console.warn('[Signaling] Message missing type:', message);
        return;
      }

      if (type === MSG.PONG) return;

      if (type === MSG.ROOM_CREATED) {
        this.token = payload.token;
        this.roomCode = payload.roomCode;
      } else if (type === MSG.ROOM_JOINED) {
        this.token = payload.token;
      }

      this._emit(type, payload);
    } catch (err) {
      console.error('[Signaling] Failed to parse message:', err);
    }
  }

  _emit(event, data) {
    this.listeners.get(event)?.forEach(cb => {
      try { cb(data); } catch (err) {
        console.error('[Signaling] Listener error:', err);
      }
    });
  }

  _startPing() {
    this._stopPing();
    this.pingInterval = setInterval(() => {
      this.send(MSG.PING);
    }, 30000);
  }

  _stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  _normalizeQueryParams(queryParams) {
    return Object.fromEntries(
      Object.entries(queryParams).filter(([, value]) => value !== undefined && value !== null && value !== '')
    );
  }

  _getQueryKey(queryParams) {
    return JSON.stringify(Object.entries(queryParams).sort(([a], [b]) => a.localeCompare(b)));
  }

  _closeSocket({ intentional, suppressDisconnectEvent, reason }) {
    this.intentionalClose = intentional;
    this.suppressNextDisconnectEvent = suppressDisconnectEvent;
    this._stopPing();

    if (this.ws) {
      try {
        this.ws.close(1000, reason);
      } catch {
        // Ignore close errors during reconnect/cleanup.
      }
      this.ws = null;
    }
  }
}

// Singleton instance
let _instance = null;
export function getSignalingClient(url) {
  if (!_instance) {
    _instance = new SignalingClient(url);
  }
  return _instance;
}

export function resetSignalingClient() {
  if (_instance) {
    _instance.disconnect();
    _instance = null;
  }
}
