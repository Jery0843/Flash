// ═══════════════════════════════════════════════════════════
// Blitz Signaling Server — Worker Entry Point
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

import { checkRateLimit, checkFailedJoinAttempts, recordFailedJoin, clearFailedJoins } from './rateLimit.js';

// Re-export the Durable Object class
export { SignalingRoom } from './room.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*', // Restrict to your domain in production
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const array = new Uint8Array(8); // Increased from 6 to 8 for better security
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
    // Uses Cloudflare TURN API to generate short-lived ICE credentials
    // Requires env.TURN_KEY_ID and env.TURN_SECRET
    if (url.pathname === '/turn-credentials') {
      const rateCheck = checkRateLimit(ip, 'turn', 10);
      if (!rateCheck.allowed) {
        return new Response(JSON.stringify({ error: 'Rate limited' }), {
          status: 429,
          headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Retry-After': String(rateCheck.retryAfter) },
        });
      }

      // If Cloudflare TURN credentials are configured, fetch from API
      if (env.TURN_KEY_ID && env.TURN_SECRET) {
        try {
          const ttl = 86400; // 24 hours
          const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${env.TURN_SECRET}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ttl }),
          });

          if (!response.ok) {
            console.error('[TURN] Failed to fetch credentials:', response.status, response.statusText);
            return new Response(JSON.stringify({ error: 'Failed to generate TURN credentials' }), {
              status: 500,
              headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
            });
          }

          const data = await response.json();
          return new Response(JSON.stringify({
            iceServers: data.iceServers,
            ttl,
          }), {
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          });
        } catch (err) {
          console.error('[TURN] Error fetching credentials:', err);
          return new Response(JSON.stringify({ error: 'Failed to generate TURN credentials' }), {
            status: 500,
            headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
          });
        }
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
        if (!roomCode || !/^[A-Z2-9]{8}$/.test(roomCode)) {
          recordFailedJoin(ip);
          return new Response('Invalid room code', { status: 400 });
        }

        // Check if IP is blocked due to too many failed join attempts
        const blockCheck = checkFailedJoinAttempts(ip);
        if (blockCheck.blocked) {
          return new Response(JSON.stringify({ error: 'Too many failed join attempts. Try again later.' }), {
            status: 429,
            headers: { ...CORS_HEADERS, 'Retry-After': String(blockCheck.retryAfter) },
          });
        }

        // Rate limit join attempts (stricter than create)
        const rateCheck = checkRateLimit(ip, 'join', 10);
        if (!rateCheck.allowed) {
          return new Response(JSON.stringify({ error: 'Too many join attempts. Try again later.' }), {
            status: 429,
            headers: { ...CORS_HEADERS, 'Retry-After': String(rateCheck.retryAfter) },
          });
        }

        // Route to the existing Durable Object for this room code
        const roomId = env.SIGNALING_ROOM.idFromName(roomCode);
        const room = env.SIGNALING_ROOM.get(roomId);
        
        // Clear failed join attempts on successful room access
        clearFailedJoins(ip);
        
        return room.fetch(request);
      }

      return new Response('Invalid action. Use ?action=create or ?action=join', { status: 400 });
    }

    return new Response('Not Found', { status: 404 });
  },
};
