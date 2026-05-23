// ═══════════════════════════════════════════════════════════
// Flash Signaling Server — Message Validation
// ═══════════════════════════════════════════════════════════

import { MSG, MAX_SIGNALING_PAYLOAD } from './constants.js';

/**
 * Validate an incoming signaling message.
 * Returns { valid, type, payload, error }.
 */
export function validateMessage(raw) {
  // Size check
  if (typeof raw !== 'string' || raw.length > MAX_SIGNALING_PAYLOAD) {
    return { valid: false, error: 'Message too large or invalid' };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { valid: false, error: 'Invalid JSON' };
  }

  if (!parsed.type || typeof parsed.type !== 'string') {
    return { valid: false, error: 'Missing message type' };
  }

  const { type, payload = {} } = parsed;

  // Validate known message types
  const validTypes = Object.values(MSG);
  if (!validTypes.includes(type)) {
    return { valid: false, error: `Unknown message type: ${type}` };
  }

  // Type-specific validation
  switch (type) {
    case MSG.CREATE_ROOM:
      // Optional password
      if (payload.password && typeof payload.password !== 'string') {
        return { valid: false, error: 'Invalid password format' };
      }
      if (payload.password && payload.password.length > 128) {
        return { valid: false, error: 'Password too long' };
      }
      break;

    case MSG.JOIN_ROOM:
      if (!payload.roomCode || typeof payload.roomCode !== 'string') {
        return { valid: false, error: 'Missing room code' };
      }
      if (!/^[A-Z2-9]{6}$/.test(payload.roomCode)) {
        return { valid: false, error: 'Invalid room code format' };
      }
      break;

    case MSG.FILE_METADATA:
      // Support manifest format ({files: [...]}) or legacy single-file
      if (payload.files && Array.isArray(payload.files)) {
        if (payload.files.length === 0 || payload.files.length > 100) {
          return { valid: false, error: 'Invalid file count in manifest' };
        }
        for (const f of payload.files) {
          if (!f.name || typeof f.name !== 'string') {
            return { valid: false, error: 'Missing file name in manifest' };
          }
          if (typeof f.size !== 'number' || f.size <= 0) {
            return { valid: false, error: 'Invalid file size in manifest' };
          }
        }
      } else {
        if (!payload.name || typeof payload.name !== 'string') {
          return { valid: false, error: 'Missing file name' };
        }
        if (typeof payload.size !== 'number' || payload.size <= 0) {
          return { valid: false, error: 'Invalid file size' };
        }
      }
      break;

    case MSG.SDP_OFFER:
    case MSG.SDP_ANSWER:
      if (!payload.sdp || typeof payload.sdp !== 'object') {
        return { valid: false, error: 'Missing SDP' };
      }
      break;

    case MSG.ICE_CANDIDATE:
      if (!payload.candidate || typeof payload.candidate !== 'object') {
        return { valid: false, error: 'Missing ICE candidate' };
      }
      break;

    case MSG.PING:
    case MSG.PONG:
    case MSG.TRANSFER_ACCEPT:
    case MSG.TRANSFER_REJECT:
    case MSG.TRANSFER_COMPLETE:
    case MSG.TRANSFER_CANCEL:
      // No additional payload required
      break;
  }

  return { valid: true, type, payload };
}
