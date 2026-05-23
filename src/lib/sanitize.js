/* ═══════════════════════════════════════════════════════════
   Flash — Input Sanitization & Validation
   ═══════════════════════════════════════════════════════════ */

import { MAX_FILE_SIZE, DANGEROUS_EXTENSIONS } from './constants';

/**
 * Sanitize a filename: strip path traversal, null bytes, control chars.
 * Preserves the file extension and truncates to max length.
 */
export function sanitizeFilename(name, maxLength = 255) {
  if (!name || typeof name !== 'string') return 'unnamed_file';
  let clean = name
    .replace(/\.\./g, '')                  // Remove path traversal
    .replace(/[/\\]/g, '')                 // Remove path separators
    .replace(/[\x00-\x1f\x7f]/g, '')      // Remove control characters
    .replace(/[<>:"|?*]/g, '')             // Remove Windows-unsafe chars
    .trim();
  if (clean.length === 0) return 'unnamed_file';
  if (clean.length > maxLength) {
    const ext = clean.lastIndexOf('.') > 0 ? clean.slice(clean.lastIndexOf('.')) : '';
    clean = clean.slice(0, maxLength - ext.length) + ext;
  }
  return clean;
}

/**
 * Escape HTML entities as a backup to React's JSX auto-escaping.
 * Used for any raw string that might be injected outside JSX.
 */
export function sanitizeInput(input) {
  if (!input || typeof input !== 'string') return '';
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Validate file metadata received from a peer.
 * Returns { valid: boolean, error?: string }.
 */
export function validateFileMetadata(metadata) {
  if (!metadata || typeof metadata !== 'object') {
    return { valid: false, error: 'Invalid metadata format' };
  }

  const { name, size, type } = metadata;

  // Name validation
  if (!name || typeof name !== 'string' || name.length === 0) {
    return { valid: false, error: 'Missing file name' };
  }
  if (name.length > 500) {
    return { valid: false, error: 'File name too long' };
  }

  // Size validation
  if (typeof size !== 'number' || size <= 0) {
    return { valid: false, error: 'Invalid file size' };
  }
  if (size > MAX_FILE_SIZE) {
    return { valid: false, error: `File too large (max ${MAX_FILE_SIZE / (1024 * 1024 * 1024)} GB)` };
  }

  // Type validation (basic MIME format check)
  if (type && typeof type === 'string') {
    if (!/^[\w.+-]+\/[\w.+-]+$/.test(type)) {
      return { valid: false, error: 'Invalid MIME type format' };
    }
  }

  return { valid: true };
}

/**
 * Validate a multi-file manifest received from a peer.
 * Returns { valid: boolean, error?: string }.
 */
export function validateFileManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, error: 'Invalid manifest format' };
  }

  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    return { valid: false, error: 'Manifest contains no files' };
  }

  if (manifest.files.length > 100) {
    return { valid: false, error: 'Too many files (max 100)' };
  }

  for (let i = 0; i < manifest.files.length; i++) {
    const result = validateFileMetadata(manifest.files[i]);
    if (!result.valid) {
      return { valid: false, error: `File ${i + 1}: ${result.error}` };
    }
  }

  return { valid: true };
}

/**
 * Check if a file has a dangerous extension.
 */
export function isDangerousFile(filename) {
  if (!filename) return false;
  const lower = filename.toLowerCase();
  return DANGEROUS_EXTENSIONS.some(ext => lower.endsWith(ext));
}

/**
 * Validate a room code format.
 */
export function validateRoomCode(code) {
  if (!code || typeof code !== 'string') return false;
  return /^[A-Z2-9]{6}$/.test(code.toUpperCase());
}

/**
 * Sanitize a room password (just trim and length-limit).
 */
export function sanitizePassword(password) {
  if (!password || typeof password !== 'string') return '';
  return password.trim().slice(0, 128);
}
