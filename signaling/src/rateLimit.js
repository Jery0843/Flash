// ═══════════════════════════════════════════════════════════
// Flash Signaling Server — Rate Limiting
// ═══════════════════════════════════════════════════════════

import { RATE_LIMIT_WINDOW_MS, MAX_ROOMS_PER_IP } from './constants.js';

/**
 * Simple in-memory rate limiter.
 * Tracks actions per IP within a sliding window.
 * 
 * Note: In Cloudflare Workers, each request may hit a different
 * isolate. For true rate limiting, use Cloudflare's Rate Limiting
 * rules or a Durable Object. This provides basic per-isolate protection.
 */
const ipActions = new Map();

export function checkRateLimit(ip, action, maxAttempts = MAX_ROOMS_PER_IP) {
  const key = `${ip}:${action}`;
  const now = Date.now();
  
  if (!ipActions.has(key)) {
    ipActions.set(key, []);
  }

  const timestamps = ipActions.get(key);
  
  // Remove expired entries
  const valid = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
  ipActions.set(key, valid);

  if (valid.length >= maxAttempts) {
    return { allowed: false, retryAfter: Math.ceil((valid[0] + RATE_LIMIT_WINDOW_MS - now) / 1000) };
  }

  valid.push(now);
  return { allowed: true };
}

// Note: No periodic cleanup needed in Cloudflare Workers.
// Each Worker isolate has a short lifespan, so stale entries
// are automatically garbage collected when the isolate recycles.
