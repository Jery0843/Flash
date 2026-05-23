/* ═══════════════════════════════════════════════════════════
   Flash - Constants & Configuration
   ═══════════════════════════════════════════════════════════ */

// ── Transfer Configuration ─────────────────────────────────
export const CHUNK_SIZE = 65536; // 64 KiB — safer cross-browser DataChannel chunk size
export const BUFFER_HIGH_WATER_MARK = 4 * 1024 * 1024; // Pause sending above 4 MiB buffered
export const BUFFER_LOW_WATER_MARK = 1024 * 1024; // Resume aggressively once buffered data drains near 1 MiB
export const MAX_FILE_SIZE = 25 * 1024 * 1024 * 1024; // 25 GB
export const SPEED_WINDOW_MS = 3000; // Rolling 3s window for speed calc

// ── Room Configuration ─────────────────────────────────────
export const ROOM_CODE_LENGTH = 6;
export const ROOM_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // No 0/O/1/I confusion
export const ROOM_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_RECONNECT_ATTEMPTS = 3;

// ── Signaling Server ───────────────────────────────────────
// Set via VITE_SIGNALING_URL and VITE_TURN_CREDENTIALS_URL env vars
export const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || 'ws://localhost:8787/ws';
export const TURN_CREDENTIALS_URL = import.meta.env.VITE_TURN_CREDENTIALS_URL || 'http://localhost:8787/turn-credentials';

// ── ICE Servers ────────────────────────────────────────────
// STUN servers are free and used for direct P2P discovery.
// TURN servers relay traffic when direct P2P fails (symmetric NATs, firewalls).
// In production, TURN credentials are fetched from the signaling server
// with short-lived HMAC-based authentication (5-min TTL).
export const DEFAULT_ICE_SERVERS = [
  // Tier 1: STUN (multiple providers for redundancy)
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.cloudflare.com:3478' },
  { urls: 'stun:stun.ekiga.net:3478' },
  { urls: 'stun:stun.ideasip.com:3478' },
  { urls: 'stun:stun.rixtelecom.se:3478' },
  { urls: 'stun:stun.sipgate.net:3478' },
  { urls: 'stun:stun.stunprotocol.org:3478' },
  // Tier 2: TURN — credentials injected at runtime from /turn-credentials
  // {
  //   urls: 'turns:your-turn-server.metered.ca:443',
  //   username: '<from-api>',
  //   credential: '<from-api>'
  // }
];

// ── WebRTC Configuration ───────────────────────────────────
export const WEBRTC_CONFIG = {
  iceServers: DEFAULT_ICE_SERVERS,
  // Set to 'relay' to force TURN-only (hides peer IPs, slower)
  // iceTransportPolicy: 'relay',
};

export const DATA_CHANNEL_CONFIG = {
  ordered: true, // Reliable, ordered delivery for file integrity
  // maxRetransmits: undefined — use default (reliable mode)
};

// ── Connection Timeouts ────────────────────────────────────
export const ICE_TIMEOUT_MS = 15000; // 15s before falling back to WS relay
export const WS_RELAY_TIMEOUT_MS = 10000; // 10s for WS relay to establish

// ── Rate Limiting (client-side UX) ─────────────────────────
export const MAX_JOIN_ATTEMPTS = 5;
export const JOIN_COOLDOWN_MS = 60000; // 1 minute cooldown after max attempts

// ── File Type Categories ───────────────────────────────────
export const PREVIEWABLE_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
export const PREVIEWABLE_VIDEO_TYPES = ['video/mp4', 'video/webm'];
export const DANGEROUS_EXTENSIONS = ['.exe', '.bat', '.cmd', '.scr', '.pif', '.msi', '.dll', '.vbs', '.js', '.ps1'];

// ── Room States ────────────────────────────────────────────
export const ROOM_STATES = {
  WAITING: 'waiting',
  RECEIVER_JOINED: 'receiver_joined',
  NEGOTIATING: 'negotiating',
  RELAY_FALLBACK: 'relay_fallback',
  CONNECTED: 'connected',
  TRANSFERRING: 'transferring',
  COMPLETED: 'completed',
  FAILED: 'failed',
  EXPIRED: 'expired',
  CANCELLED: 'cancelled',
};

// ── Connection Types ───────────────────────────────────────
export const CONNECTION_TYPES = {
  DIRECT: 'direct',     // Tier 1: P2P via STUN
  RELAY: 'relay',       // Tier 2: TURN relay
  WS_RELAY: 'ws-relay', // Tier 3: WebSocket fallback
};

// ── Signaling Message Types ────────────────────────────────
export const MSG = {
  // Room management
  CREATE_ROOM: 'create_room',
  ROOM_CREATED: 'room_created',
  JOIN_ROOM: 'join_room',
  ROOM_JOINED: 'room_joined',
  RECEIVER_JOINED: 'receiver_joined',
  ROOM_ERROR: 'room_error',

  // File metadata & approval
  FILE_METADATA: 'file_metadata',
  TRANSFER_ACCEPT: 'transfer_accept',
  TRANSFER_REJECT: 'transfer_reject',

  // WebRTC signaling
  SDP_OFFER: 'sdp_offer',
  SDP_ANSWER: 'sdp_answer',
  ICE_CANDIDATE: 'ice_candidate',

  // Transfer control
  TRANSFER_COMPLETE: 'transfer_complete',
  TRANSFER_CANCEL: 'transfer_cancel',
  TRANSFER_PROGRESS: 'transfer_progress',

  // Connection
  WS_RELAY_MODE: 'ws_relay_mode',
  WS_RELAY_CHUNK: 'ws_relay_chunk',
  PING: 'ping',
  PONG: 'pong',
};

// ── Formatting Helpers ─────────────────────────────────────
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export function formatSpeed(bytesPerSecond) {
  if (bytesPerSecond === 0) return '0 B/s';
  return `${formatFileSize(bytesPerSecond)}/s`;
}

export function formatETA(seconds) {
  if (!seconds || seconds === Infinity) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function getFileIcon(type, name) {
  if (type?.startsWith('image/')) return '🖼️';
  if (type?.startsWith('video/')) return '🎬';
  if (type?.startsWith('audio/')) return '🎵';
  if (type === 'application/pdf') return '📄';
  if (name?.endsWith('.zip') || name?.endsWith('.rar') || name?.endsWith('.7z') || type?.includes('zip') || type?.includes('compressed')) return '📦';
  if (type?.startsWith('text/') || name?.endsWith('.txt') || name?.endsWith('.md')) return '📝';
  return '📎';
}
