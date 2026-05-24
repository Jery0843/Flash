// ═══════════════════════════════════════════════════════════
// Flash Signaling Server — Durable Object: SignalingRoom
//
// Each room is a separate Durable Object instance.
// Uses WebSocket Hibernation API for efficient connection management.
//
// Multi-receiver model:
//   - One sender per room (the room creator)
//   - N receivers per room, each addressed by a server-generated peerId
//   - Sender → receiver messages MUST carry payload.targetPeerId; the
//     server forwards only to the matching receiver socket
//   - Receiver → sender messages have payload.peerId injected by the
//     server (clients must not trust client-supplied peerId)
//
// Security:
//   - All messages validated before processing
//   - Room password checked on join
//   - Auto-expiry via alarm API (15 minutes)
//   - No file data ever passes through this object (except WS relay fallback)
//   - No permanent storage of any data
// ═══════════════════════════════════════════════════════════

import { MSG, ROOM_STATES, ROOM_EXPIRY_MS } from './constants.js';
import { validateMessage } from './validation.js';

// Messages that flow sender → receiver and require targetPeerId routing.
const SENDER_TO_RECEIVER = new Set([
  MSG.FILE_METADATA,
  MSG.SDP_OFFER,
  MSG.ICE_CANDIDATE,
  MSG.TRANSFER_CANCEL,
  MSG.WS_RELAY_MODE,
  MSG.FILE_RESUME_ACK,
]);

// Messages that flow receiver → sender. Server stamps peerId.
const RECEIVER_TO_SENDER = new Set([
  MSG.TRANSFER_ACCEPT,
  MSG.TRANSFER_REJECT,
  MSG.SDP_ANSWER,
  MSG.ICE_CANDIDATE,
  MSG.TRANSFER_COMPLETE,
  MSG.TRANSFER_CANCEL,
  MSG.FILE_RESUME_REQUEST,
]);

function generatePeerId() {
  // 8-byte hex (16 chars) is plenty for a per-room peer id.
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

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
      peers: {}, // peerId -> { joinedAt }
    };

    // Hibernation-safe load. Without this, in-memory state would be lost
    // across DO restarts (room password, peer registry), allowing receivers
    // to join password-protected rooms without supplying a password.
    this._loaded = ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.get('roomState');
      if (stored) {
        // Backfill new fields on older persisted state.
        this.state = { peers: {}, ...stored };
        if (!this.state.peers) this.state.peers = {};
      }
    });
  }

  async _persist() {
    await this.ctx.storage.put('roomState', this.state);
  }

  // ── HTTP / WebSocket Upgrade ──────────────────────────────

  async fetch(request) {
    await this._loaded;
    const url = new URL(request.url);

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const action = url.searchParams.get('action');
    const roomCode = url.searchParams.get('code');
    const password = url.searchParams.get('password') || '';

    if (action === 'create') {
      this.ctx.acceptWebSocket(server, ['sender']);
      // Initialize room
      this.state.code = roomCode;
      this.state.password = url.searchParams.get('roomPassword') || null;
      this.state.status = ROOM_STATES.WAITING;
      this.state.createdAt = Date.now();
      this.state.peers = {};
      await this._persist();
      await this.ctx.storage.setAlarm(Date.now() + ROOM_EXPIRY_MS);

      server.send(JSON.stringify({
        type: MSG.ROOM_CREATED,
        payload: { roomCode: this.state.code, token: roomCode },
      }));

    } else if (action === 'join') {
      // Password gate (must run BEFORE we accept the socket so we can reject).
      if (this.state.password && password !== this.state.password) {
        // Accept then immediately close with an error so the client can read it.
        this.ctx.acceptWebSocket(server, ['receiver-rejected']);
        server.send(JSON.stringify({
          type: MSG.ROOM_ERROR,
          payload: { message: 'Incorrect room password' },
        }));
        server.close(4001, 'Incorrect password');
        return new Response(null, { status: 101, webSocket: client });
      }

      // Require an active sender. If sender hasn't connected (or has left),
      // reject the join — otherwise receivers could pile up in a dead room.
      const senders = this.ctx.getWebSockets('sender');
      if (senders.length === 0) {
        this.ctx.acceptWebSocket(server, ['receiver-rejected']);
        server.send(JSON.stringify({
          type: MSG.ROOM_ERROR,
          payload: { message: 'Room is not available' },
        }));
        server.close(4002, 'Room not available');
        return new Response(null, { status: 101, webSocket: client });
      }

      // Allocate a peerId for this receiver and stash it on the WebSocket.
      const peerId = generatePeerId();
      this.ctx.acceptWebSocket(server, ['receiver', `peer:${peerId}`]);
      server.serializeAttachment({ peerId });

      this.state.peers[peerId] = { joinedAt: Date.now() };
      await this._persist();

      server.send(JSON.stringify({
        type: MSG.ROOM_JOINED,
        payload: { token: roomCode, peerId },
      }));

      // Notify sender(s) that a new receiver joined.
      for (const s of senders) {
        try {
          s.send(JSON.stringify({
            type: MSG.RECEIVER_JOINED,
            payload: { peerId },
          }));
        } catch { /* socket may be closed */ }
      }
    } else {
      return new Response('Invalid action', { status: 400 });
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ── WebSocket Lifecycle ───────────────────────────────────

  async webSocketMessage(ws, message) {
    await this._loaded;

    // Binary frames are WS relay fallback chunks.
    if (message instanceof ArrayBuffer) {
      // NOTE: Binary WS relay is not peer-routed in multi-receiver mode.
      // It will work correctly with exactly one receiver. With >1 receiver
      // in WS relay mode, chunks would be broadcast to all (mixing streams).
      this._broadcastBinary(ws, message);
      return;
    }

    const result = validateMessage(message);
    if (!result.valid) {
      ws.send(JSON.stringify({ type: MSG.ROOM_ERROR, payload: { message: result.error } }));
      return;
    }

    const { type, payload } = result;
    const tags = this.ctx.getTags(ws);
    const isSender = tags?.includes('sender');
    const isReceiver = tags?.includes('receiver');

    switch (type) {
      case MSG.PING:
        ws.send(JSON.stringify({ type: MSG.PONG }));
        break;

      case MSG.FILE_METADATA:
        if (!isSender) break;
        // Cache the manifest so we could re-send to late joiners if needed.
        this.state.fileMetadata = payload;
        await this._persist();
        this._routeToReceiver(payload?.targetPeerId, message);
        break;

      case MSG.SDP_OFFER:
      case MSG.ICE_CANDIDATE:
      case MSG.TRANSFER_CANCEL:
      case MSG.WS_RELAY_MODE:
        if (isSender && SENDER_TO_RECEIVER.has(type)) {
          this._routeToReceiver(payload?.targetPeerId, message);
        } else if (isReceiver && RECEIVER_TO_SENDER.has(type)) {
          this._forwardToSenderWithPeerId(ws, type, payload);
        }
        break;

      case MSG.SDP_ANSWER:
      case MSG.TRANSFER_ACCEPT:
      case MSG.TRANSFER_REJECT:
      case MSG.TRANSFER_COMPLETE:
        if (!isReceiver) break;
        this._forwardToSenderWithPeerId(ws, type, payload);
        if (type === MSG.TRANSFER_COMPLETE) {
          this.state.status = ROOM_STATES.COMPLETED;
          await this._persist();
        } else if (type === MSG.SDP_ANSWER) {
          this.state.status = ROOM_STATES.NEGOTIATING;
          await this._persist();
        }
        break;

      case MSG.WS_RELAY_CHUNK:
        // Forward relay data to the other side (1:1 only — see note above).
        this._broadcastToOther(ws, message);
        break;

      default:
        // Unknown types already rejected by validation.
        break;
    }

    // Reset expiry on activity.
    await this.ctx.storage.setAlarm(Date.now() + ROOM_EXPIRY_MS);
  }

  async webSocketClose(ws, code, reason, wasClean) {
    await this._loaded;
    const tags = this.ctx.getTags(ws);

    if (tags?.includes('sender')) {
      // Sender left — tear the whole room down.
      this._broadcastAll(JSON.stringify({
        type: MSG.ROOM_ERROR,
        payload: { message: 'Sender disconnected' },
      }));
      this._cleanup();
      return;
    }

    if (tags?.includes('receiver')) {
      const att = ws.deserializeAttachment?.();
      const peerId = att?.peerId;
      if (peerId && this.state.peers?.[peerId]) {
        delete this.state.peers[peerId];
        await this._persist();
      }
      // Notify sender(s) that this peer left.
      const senders = this.ctx.getWebSockets('sender');
      for (const s of senders) {
        try {
          s.send(JSON.stringify({
            type: MSG.RECEIVER_LEFT,
            payload: { peerId },
          }));
        } catch { /* ignore */ }
      }
    }
  }

  async webSocketError(ws, error) {
    console.error('[SignalingRoom] WebSocket error:', error);
    try { ws.close(1011, 'Internal error'); } catch { /* ignore */ }
  }

  async alarm() {
    await this._loaded;
    this.state.status = ROOM_STATES.EXPIRED;
    this._broadcastAll(JSON.stringify({
      type: MSG.ROOM_ERROR,
      payload: { message: 'Room expired due to inactivity' },
    }));
    this._cleanup();
  }

  // ── Routing Helpers ───────────────────────────────────────

  _routeToReceiver(targetPeerId, message) {
    if (!targetPeerId) return; // require explicit targeting from sender
    const sockets = this.ctx.getWebSockets(`peer:${targetPeerId}`);
    for (const ws of sockets) {
      try { ws.send(message); } catch { /* ignore */ }
    }
  }

  _forwardToSenderWithPeerId(receiverWs, type, payload) {
    const att = receiverWs.deserializeAttachment?.();
    const peerId = att?.peerId;
    if (!peerId) return;
    const stamped = JSON.stringify({
      type,
      payload: { ...payload, peerId },
    });
    const senders = this.ctx.getWebSockets('sender');
    for (const s of senders) {
      try { s.send(stamped); } catch { /* ignore */ }
    }
  }

  _broadcastToOther(sender, message) {
    const allSockets = this.ctx.getWebSockets();
    for (const ws of allSockets) {
      if (ws !== sender) {
        try { ws.send(message); } catch { /* ignore */ }
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
      peers: {},
    };
    try { this.ctx.storage.deleteAll(); } catch { /* ignore */ }
  }
}
