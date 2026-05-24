// ═══════════════════════════════════════════════════════════
// Flash Signaling Server — Constants
// ═══════════════════════════════════════════════════════════

export const ROOM_EXPIRY_MS = 15 * 60 * 1000; // 15 minutes
export const MAX_SIGNALING_PAYLOAD = 16384; // 16 KB
export const MAX_ROOMS_PER_IP = 3;
export const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute

export const MSG = {
  CREATE_ROOM: 'create_room',
  ROOM_CREATED: 'room_created',
  JOIN_ROOM: 'join_room',
  ROOM_JOINED: 'room_joined',
  RECEIVER_JOINED: 'receiver_joined',
  RECEIVER_LEFT: 'receiver_left',
  ROOM_ERROR: 'room_error',
  FILE_METADATA: 'file_metadata',
  TRANSFER_ACCEPT: 'transfer_accept',
  TRANSFER_REJECT: 'transfer_reject',
  SDP_OFFER: 'sdp_offer',
  SDP_ANSWER: 'sdp_answer',
  ICE_CANDIDATE: 'ice_candidate',
  TRANSFER_COMPLETE: 'transfer_complete',
  TRANSFER_CANCEL: 'transfer_cancel',
  WS_RELAY_MODE: 'ws_relay_mode',
  WS_RELAY_CHUNK: 'ws_relay_chunk',
  FILE_RESUME_REQUEST: 'file_resume_request',
  FILE_RESUME_ACK: 'file_resume_ack',
  PING: 'ping',
  PONG: 'pong',
};

export const ROOM_STATES = {
  WAITING: 'waiting',
  RECEIVER_JOINED: 'receiver_joined',
  NEGOTIATING: 'negotiating',
  CONNECTED: 'connected',
  TRANSFERRING: 'transferring',
  COMPLETED: 'completed',
  FAILED: 'failed',
  EXPIRED: 'expired',
};
