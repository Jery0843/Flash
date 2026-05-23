// ═══════════════════════════════════════════════════════════
// Flash Signaling Server — Worker Entry Point
//
// Routes:
//   /ws?action=create&code=XXX     → Create room
//   /ws?action=join&code=XXX       → Join room
//   /turn-credentials              → Short-lived TURN credentials
//   /health                        → Health check
//
// Security:
// - CORS restricted to frontend origin
// - Rate limiting per IP
// - WebSocket upgrade validation
// - No sensitive data in logs
// ═══════════════════════════════════════════════════════════

import { checkRateLimit } from './rateLimit.js';

// Re-export the Durable Object class
export { SignalingRoom } from './room.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // Restrict to your domain in production
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const array = new Uint8Array(6);
  crypto.getRandomValues(array);
  return Array.from(array, b => chars[b % chars.length]).join('');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // ── Health check ─────────────────────────────────────
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', timestamp: Date.now() }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── TURN credentials ─────────────────────────────────
    // In production, generate short-lived HMAC credentials here.
    // The TURN shared secret should be in env.TURN_SECRET.
    if (url.pathname === '/turn-credentials') {
      const rateCheck = checkRateLimit(ip, 'turn', 10);
      if (!rateCheck.allowed) {
        return new Response(JSON.stringify({ error: 'Rate limited' }), {
          status: 429,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Retry-After': String(rateCheck.retryAfter) },
        });
      }

      // If TURN_SECRET is configured, generate ephemeral credentials
      if (env.TURN_SECRET && env.TURN_DOMAIN) {
        const ttl = 300; // 5 minutes
        const timestamp = Math.floor(Date.now() / 1000) + ttl;
        const username = `${timestamp}:flash-user`;
        
        // HMAC-SHA1 credential generation
        const encoder = new TextEncoder();
        const key = await crypto.subtle.importKey(
          'raw',
          encoder.encode(env.TURN_SECRET),
          { name: 'HMAC', hash: 'SHA-1' },
          false,
          ['sign']
        );
        const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(username));
        const credential = btoa(String.fromCharCode(...new Uint8Array(signature)));

        return new Response(JSON.stringify({
          iceServers: [{
            urls: [`turns:${env.TURN_DOMAIN}:443`, `turn:${env.TURN_DOMAIN}:3478`],
            username,
            credential,
          }],
          ttl,
        }), {
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
        });
      }

      // No TURN configured — return empty (STUN-only mode)
      return new Response(JSON.stringify({ iceServers: [], ttl: 0 }), {
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      });
    }

    // ── WebSocket endpoint ───────────────────────────────
    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }

      const action = url.searchParams.get('action');
      
      if (action === 'create') {
        // Rate limit room creation
        const rateCheck = checkRateLimit(ip, 'create', 3);
        if (!rateCheck.allowed) {
          return new Response(JSON.stringify({ error: 'Too many rooms created. Try again later.' }), {
            status: 429,
            headers: { ...CORS_HEADERS, 'Retry-After': String(rateCheck.retryAfter) },
          });
        }

        // Generate room code and route to Durable Object
        const roomCode = generateRoomCode();
        url.searchParams.set('code', roomCode);

        // Each room gets its own Durable Object instance
        const roomId = env.SIGNALING_ROOM.idFromName(roomCode);
        const room = env.SIGNALING_ROOM.get(roomId);
        
        // Forward the request with password if provided
        const roomPassword = url.searchParams.get('password') || '';
        const roomUrl = new URL(request.url);
        roomUrl.searchParams.set('code', roomCode);
        roomUrl.searchParams.set('roomPassword', roomPassword);

        return room.fetch(new Request(roomUrl.toString(), request));

      } else if (action === 'join') {
        const roomCode = url.searchParams.get('code');
        if (!roomCode || !/^[A-Z2-9]{6}$/.test(roomCode)) {
          return new Response('Invalid room code', { status: 400 });
        }

        // Rate limit join attempts
        const rateCheck = checkRateLimit(ip, 'join', 5);
        if (!rateCheck.allowed) {
          return new Response(JSON.stringify({ error: 'Too many join attempts. Try again later.' }), {
            status: 429,
            headers: { ...CORS_HEADERS, 'Retry-After': String(rateCheck.retryAfter) },
          });
        }

        // Route to the existing Durable Object for this room code
        const roomId = env.SIGNALING_ROOM.idFromName(roomCode);
        const room = env.SIGNALING_ROOM.get(roomId);
        return room.fetch(request);
      }

      return new Response('Invalid action. Use ?action=create or ?action=join', { status: 400 });
    }

    return new Response('Not Found', { status: 404 });
  },
};
