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

// Track failed join attempts for IP blocking
const failedJoinAttempts = new Map();
const FAILED_JOIN_THRESHOLD = 15; // Block after 15 failed joins
const FAILED_JOIN_BLOCK_DURATION = 5 * 60 * 1000; // 5 minutes block

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

/**
 * Track failed join attempts and block IPs with too many failures.
 * Returns { blocked: boolean, retryAfter?: number }
 */
export function checkFailedJoinAttempts(ip) {
  const now = Date.now();
  
  if (!failedJoinAttempts.has(ip)) {
    failedJoinAttempts.set(ip, []);
  }

  const attempts = failedJoinAttempts.get(ip);
  
  // Remove expired entries (older than block duration)
  const valid = attempts.filter(t => now - t < FAILED_JOIN_BLOCK_DURATION);
  failedJoinAttempts.set(ip, valid);

  // Check if IP should be blocked
  if (valid.length >= FAILED_JOIN_THRESHOLD) {
    const oldestAttempt = valid[0];
    const blockRemaining = Math.ceil((oldestAttempt + FAILED_JOIN_BLOCK_DURATION - now) / 1000);
    return { blocked: true, retryAfter: blockRemaining };
  }

  return { blocked: false };
}

/**
 * Record a failed join attempt for an IP.
 */
export function recordFailedJoin(ip) {
  const now = Date.now();
  if (!failedJoinAttempts.has(ip)) {
    failedJoinAttempts.set(ip, []);
  }
  failedJoinAttempts.get(ip).push(now);
}

/**
 * Clear failed join attempts for an IP (on successful join).
 */
export function clearFailedJoins(ip) {
  failedJoinAttempts.delete(ip);
}

// Note: No periodic cleanup needed in Cloudflare Workers.
// Each Worker isolate has a short lifespan, so stale entries
// are automatically garbage collected when the isolate recycles.
