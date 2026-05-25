/* ═══════════════════════════════════════════════════════════
   Blitz - Cryptographic Utilities
   ═══════════════════════════════════════════════════════════ */

import { ROOM_CODE_LENGTH, ROOM_CODE_CHARS } from './constants';

/**
 * Generate a cryptographically strong room code.
 * Uses crypto.getRandomValues() for unpredictable output.
 * Character set excludes ambiguous chars (0/O/1/I).
 */
export function generateRoomCode() {
  const array = new Uint8Array(ROOM_CODE_LENGTH);
  crypto.getRandomValues(array);
  let code = '';
  for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
    code += ROOM_CODE_CHARS[array[i] % ROOM_CODE_CHARS.length];
  }
  return code;
}

/**
 * Generate a 32-byte hex token for room authentication.
 */
export function generateToken() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a random session ID for WebSocket connections.
 */
export function generateSessionId() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return Array.from(array, b => b.toString(16).padStart(2, '0')).join('');
}

// ══════════════════════════════════════════════════════════
// Future E2E Encryption Hooks (placeholder for post-MVP)
// ══════════════════════════════════════════════════════════
// These stubs prepare the code structure for client-side
// AES-GCM encryption of file metadata and chunks.
// In MVP, WebRTC DTLS already encrypts all data in transit.
// ══════════════════════════════════════════════════════════

/**
 * [FUTURE] Derive an encryption key from a shared passphrase.
 * Uses PBKDF2 → AES-GCM key via Web Crypto API.
 */
export async function deriveKey(/* passphrase, salt */) {
  // TODO: Implement when adding E2E encryption
  // const keyMaterial = await crypto.subtle.importKey(
  //   'raw',
  //   new TextEncoder().encode(passphrase),
  //   'PBKDF2',
  //   false,
  //   ['deriveKey']
  // );
  // return crypto.subtle.deriveKey(
  //   { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
  //   keyMaterial,
  //   { name: 'AES-GCM', length: 256 },
  //   false,
  //   ['encrypt', 'decrypt']
  // );
  throw new Error('E2E encryption not yet implemented');
}

/**
 * [FUTURE] Encrypt file metadata before sending.
 */
export async function encryptMetadata(/* metadata, key */) {
  throw new Error('E2E encryption not yet implemented');
}

/**
 * [FUTURE] Decrypt received file metadata.
 */
export async function decryptMetadata(/* encryptedData, key */) {
  throw new Error('E2E encryption not yet implemented');
}
