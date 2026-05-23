// ═══════════════════════════════════════════════════════════
// Flash Signaling Server — Durable Object: SignalingRoom
//
// Each room is a separate Durable Object instance.
// Uses WebSocket Hibernation API for efficient connection management.
// Room state is ephemeral — destroyed on completion, disconnect, or timeout.
//
// Security:
// - All messages validated before processing
// - Room password checked on join
// - Auto-expiry via alarm API (15 minutes)
// - No file data ever passes through this object (except WS relay fallback)
// - No permanent storage of any data
// ═══════════════════════════════════════════════════════════

import { MSG, ROOM_STATES, ROOM_EXPIRY_MS } from './constants.js';
import { validateMessage } from './validation.js';

export class SignalingRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.state = {
      code: null,
      password: null,
      status: null,
      fileMetadata: null,
      createdAt: null,
    };
    // Block concurrent requests until persisted state is loaded after
    // hibernation/eviction. Without this, in-memory state would be lost
    // across DO restarts (room password & status), allowing receivers to
    // join password-protected rooms without supplying a password.
    this._loaded = ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get('roomState');
      if (stored) this.state = stored;
    });
  }

  async _persist() {
    await this.ctx.storage.put('roomState', this.state);
  }

  async fetch(request) {
    await this._loaded;
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Extract action and params from query
    const action = url.searchParams.get('action');
    const roomCode = url.searchParams.get('code');
    const password = url.searchParams.get('password') || '';

    // Tag the WebSocket with role
    const tags = [action === 'create' ? 'sender' : 'receiver'];
    this.ctx.acceptWebSocket(server, tags);

    if (action === 'create') {
      // Initialize room
      this.state.code = roomCode;
      this.state.password = url.searchParams.get('roomPassword') || null;
      this.state.status = ROOM_STATES.WAITING;
      this.state.createdAt = Date.now();
      await this._persist();

      // Set expiry alarm
      await this.ctx.storage.setAlarm(Date.now() + ROOM_EXPIRY_MS);

      // Send room created confirmation
      server.send(JSON.stringify({
        type: MSG.ROOM_CREATED,
        payload: {
          roomCode: this.state.code,
          token: roomCode, // Simple token in MVP
        }
      }));

    } else if (action === 'join') {
      // Check password
      if (this.state.password && password !== this.state.password) {
        server.send(JSON.stringify({
          type: MSG.ROOM_ERROR,
          payload: { message: 'Incorrect room password' }
        }));
        server.close(4001, 'Incorrect password');
        return new Response(null, { status: 101, webSocket: client });
      }

      // Check if room is accepting receivers
      if (this.state.status !== ROOM_STATES.WAITING) {
        server.send(JSON.stringify({
          type: MSG.ROOM_ERROR,
          payload: { message: 'Room is not accepting new connections' }
        }));
        server.close(4002, 'Room not available');
        return new Response(null, { status: 101, webSocket: client });
      }

      this.state.status = ROOM_STATES.RECEIVER_JOINED;
      await this._persist();

      // Notify receiver they joined
      server.send(JSON.stringify({
        type: MSG.ROOM_JOINED,
        payload: {
          token: roomCode,
        }
      }));

      // Notify sender that receiver joined
      const senders = this.ctx.getWebSockets('sender');
      for (const ws of senders) {
        ws.send(JSON.stringify({
          type: MSG.RECEIVER_JOINED,
          payload: {}
        }));
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws, message) {
    await this._loaded;
    // Handle binary messages (WS relay)
    if (message instanceof ArrayBuffer) {
      this._broadcastBinary(ws, message);
      return;
    }

    const result = validateMessage(message);
    if (!result.valid) {
      ws.send(JSON.stringify({ type: MSG.ROOM_ERROR, message: result.error }));
      return;
    }

    const { type, payload } = result;

    switch (type) {
      case MSG.PING:
        ws.send(JSON.stringify({ type: MSG.PONG }));
        break;

      case MSG.FILE_METADATA:
        this.state.fileMetadata = {
          name: payload.name,
          size: payload.size,
          type: payload.type,
          totalChunks: payload.totalChunks,
        };
        await this._persist();
        this._broadcastToOther(ws, message);
        break;

      case MSG.SDP_OFFER:
      case MSG.SDP_ANSWER:
      case MSG.ICE_CANDIDATE:
        this.state.status = ROOM_STATES.NEGOTIATING;
        await this._persist();
        this._broadcastToOther(ws, message);
        break;

      case MSG.TRANSFER_ACCEPT:
      case MSG.TRANSFER_REJECT:
        this._broadcastToOther(ws, message);
        break;

      case MSG.TRANSFER_COMPLETE:
        this.state.status = ROOM_STATES.COMPLETED;
        this._broadcastToOther(ws, message);
        // Clean up after short delay
        setTimeout(() => this._cleanup(), 5000);
        break;

      case MSG.TRANSFER_CANCEL:
        this.state.status = ROOM_STATES.FAILED;
        this._broadcastToOther(ws, message);
        this._cleanup();
        break;

      case MSG.WS_RELAY_MODE:
      case MSG.WS_RELAY_CHUNK:
        // Forward relay data to the other peer
        this._broadcastToOther(ws, message);
        break;

      default:
        // Unknown type already caught by validation, but be safe
        break;
    }

    // Reset expiry on activity
    await this.ctx.storage.setAlarm(Date.now() + ROOM_EXPIRY_MS);
  }

  async webSocketClose(ws, code, reason, wasClean) {
    await this._loaded;
    // If sender disconnects, destroy room
    const tags = this.ctx.getTags(ws);
    if (tags?.includes('sender')) {
      this._broadcastAll(JSON.stringify({
        type: MSG.ROOM_ERROR,
        payload: { message: 'Sender disconnected' }
      }));
      this._cleanup();
    } else if (tags?.includes('receiver')) {
      // Notify sender
      const senders = this.ctx.getWebSockets('sender');
      for (const s of senders) {
        s.send(JSON.stringify({
          type: MSG.ROOM_ERROR,
          payload: { message: 'Receiver disconnected' }
        }));
      }
      this.state.status = ROOM_STATES.WAITING;
      await this._persist();
    }
  }

  async webSocketError(ws, error) {
    console.error('[SignalingRoom] WebSocket error:', error);
    ws.close(1011, 'Internal error');
  }

  async alarm() {
    await this._loaded;
    // Room expired
    this.state.status = ROOM_STATES.EXPIRED;
    this._broadcastAll(JSON.stringify({
      type: MSG.ROOM_ERROR,
      payload: { message: 'Room expired due to inactivity' }
    }));
    this._cleanup();
  }

  // ── Private Helpers ──────────────────────────────────

  _broadcastToOther(sender, message) {
    const allSockets = this.ctx.getWebSockets();
    for (const ws of allSockets) {
      if (ws !== sender) {
        try {
          if (message instanceof ArrayBuffer) {
            ws.send(message);
          } else {
            ws.send(message);
          }
        } catch { /* Socket may be closed */ }
      }
    }
  }

  _broadcastBinary(sender, data) {
    const allSockets = this.ctx.getWebSockets();
    for (const ws of allSockets) {
      if (ws !== sender) {
        try { ws.send(data); } catch { /* ignore */ }
      }
    }
  }

  _broadcastAll(message) {
    const allSockets = this.ctx.getWebSockets();
    for (const ws of allSockets) {
      try { ws.send(message); } catch { /* ignore */ }
    }
  }

  _cleanup() {
    const allSockets = this.ctx.getWebSockets();
    for (const ws of allSockets) {
      try { ws.close(1000, 'Room closed'); } catch { /* ignore */ }
    }
    this.state = {
      code: null,
      password: null,
      status: null,
      fileMetadata: null,
      createdAt: null,
    };
    // Best-effort wipe of persisted state; ignore errors during teardown.
    try { this.ctx.storage.deleteAll(); } catch { /* ignore */ }
  }
}
