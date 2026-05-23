# ⚡ Flash - Secure Browser-to-Browser File Transfer

Flash is a production-quality, WebRTC-based instant file sharing platform. Files transfer directly between browsers using encrypted peer-to-peer connections — no uploads, no server storage, no tracking.

**Sender and receiver can be anywhere in the world.** Flash uses a 3-tier connection strategy to ensure connectivity across all network types.

## 🏗️ Architecture

```
┌─────────────────────────────────┐
│   Cloudflare Pages (Frontend)   │  Static React + Vite SPA
│   - Home / Create / Join / Room │  Served from global CDN
└──────────────┬──────────────────┘
               │ WSS (signaling only)
               ▼
┌─────────────────────────────────┐
│   Cloudflare Worker (Signaling) │  WebSocket + Durable Objects
│   - Room creation/management    │  1 Durable Object per room
│   - WebRTC negotiation relay    │  Auto-expiry (15 min)
│   - TURN credential generation  │  Rate limiting
└──────────────┬──────────────────┘
               │
               ▼
┌─────────────────────────────────┐
│   TURN Server (optional)        │  Metered.ca / Cloudflare Calls
│   - Relays when P2P fails       │  Short-lived HMAC credentials
│   - DTLS encryption preserved   │  Handles restrictive NATs
└─────────────────────────────────┘
```

## 🔐 Security Features

| Feature | Implementation |
|:--------|:--------------|
| **Transport encryption** | DTLS (automatic via WebRTC) for all file data |
| **Signaling encryption** | WSS (TLS 1.3) for all WebSocket traffic |
| **Room access** | 6-char crypto-random codes (~2B combinations) |
| **Password protection** | Optional room password |
| **Transfer approval** | Receiver must accept before transfer starts |
| **Input sanitization** | All filenames, room codes, UI inputs sanitized |
| **CSP headers** | Strict Content-Security-Policy via `_headers` |
| **Security headers** | X-Frame-Options, Referrer-Policy, Permissions-Policy, HSTS |
| **Rate limiting** | Room creation (3/min), join attempts (5/min) per IP |
| **Auto-expiry** | Rooms destroyed after 15 min or transfer completion |
| **No permanent storage** | Zero files stored on any server |
| **File validation** | Size, name, and MIME type validated before transfer |

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- npm
- Cloudflare account (free tier works)

### Frontend (Development)

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
```

The app runs at `http://localhost:5173`.

### Signaling Server (Development)

```bash
cd signaling

# Install wrangler
npm install

# Start local dev server
npm run dev
```

The signaling server runs at `http://localhost:8787`.

### Environment Variables

Create a `.env` file in the root:

```env
VITE_SIGNALING_URL=ws://localhost:8787/ws
VITE_TURN_CREDENTIALS_URL=http://localhost:8787/turn-credentials
```

For production, set these to your deployed Worker URL:

```env
VITE_SIGNALING_URL=wss://flash-signaling.YOUR_SUBDOMAIN.workers.dev/ws
VITE_TURN_CREDENTIALS_URL=https://flash-signaling.YOUR_SUBDOMAIN.workers.dev/turn-credentials
```

## 📦 Deployment

### Frontend → Cloudflare Pages

**Option A: Git Integration (recommended)**
1. Push code to GitHub/GitLab
2. In Cloudflare Dashboard → Pages → Create a project
3. Connect your repository
4. Build settings:
   - Build command: `npm run build`
   - Build output: `dist`
5. Add environment variables (`VITE_SIGNALING_URL`, `VITE_TURN_CREDENTIALS_URL`)

**Option B: Direct Upload**
```bash
npm run build
npx wrangler pages deploy dist --project-name=flash
```

### Signaling Server → Cloudflare Workers

```bash
cd signaling

# Deploy
npm run deploy

# Set TURN secret (if using TURN)
npx wrangler secret put TURN_SECRET
```

### TURN Server Setup

For global connectivity, you need a TURN server. Recommended free options:

| Provider | Free Tier | Setup |
|:---------|:----------|:------|
| **Metered.ca** | 500 GB/month | [Sign up](https://www.metered.ca/) → Get TURN domain + secret |
| **Cloudflare Calls** | With Workers paid | Native integration |

After getting TURN credentials:

```bash
cd signaling
npx wrangler secret put TURN_SECRET
# Enter your shared secret

# Set TURN domain in wrangler.toml [vars]
# TURN_DOMAIN = "your-domain.relay.metered.ca"
```

## 🌐 Security Headers

The `public/_headers` file configures these headers on Cloudflare Pages:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Content-Security-Policy: default-src 'self'; script-src 'self'; ...
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
```

Verify headers are applied:
```bash
curl -I https://your-flash-site.pages.dev
```

## 🔄 Connection Strategy

Flash uses a 3-tier approach for global connectivity:

1. **Tier 1: Direct P2P** (STUN) — ~80% of connections. Zero server cost.
2. **Tier 2: TURN Relay** — Handles symmetric NATs, corporate firewalls. Data still DTLS-encrypted.
3. **Tier 3: WebSocket Fallback** — Last resort when WebRTC is blocked entirely. Data via WSS.

The UI shows the connection type so users understand transfer speed expectations.

## 📁 Project Structure

```
flash/
├── public/
│   ├── _headers            # Security headers
│   └── _redirects          # SPA routing
├── src/
│   ├── components/         # Reusable UI components
│   ├── pages/              # Route pages
│   ├── hooks/              # React hooks
│   ├── lib/                # Core logic (WebRTC, signaling, transfer)
│   ├── App.jsx             # Router
│   ├── main.jsx            # Entry point
│   └── index.css           # Design system
├── signaling/              # Cloudflare Worker signaling server
│   ├── src/
│   │   ├── index.js        # Worker entry point
│   │   ├── room.js         # Durable Object
│   │   ├── validation.js   # Message validation
│   │   ├── rateLimit.js    # Rate limiting
│   │   └── constants.js    # Shared constants
│   ├── wrangler.toml       # Worker config
│   └── package.json
├── wrangler.jsonc           # Pages config
├── vite.config.js
└── package.json
```

## 🔮 Future Improvements

1. **Client-side E2E encryption** — AES-GCM with shared passphrase (Web Crypto API)
2. **Resumable transfers** — Resume from last ACK'd chunk on reconnection
3. **Multi-file transfer** — Queue multiple files per session
4. **Transfer history** — Local-only history in IndexedDB
5. **PWA** — Offline manifest, installable app
6. **Folder transfer** — Zip on-the-fly with CompressionStream API
7. **Bandwidth estimation** — Adaptive chunk sizing via WebRTC stats

## ⚠️ Important Notes

- **WebRTC DTLS encryption** is handled automatically by the browser. You do not need to implement encryption for file data in transit.
- **Signaling messages** (SDP, ICE candidates) travel through the server but are not sensitive — they contain connection metadata, not file content.
- **STUN servers** (Google's free ones) help discover public IPs but provide no encryption. Use `iceTransportPolicy: 'relay'` to force TURN-only mode for maximum IP privacy.
- **TURN credentials** should be short-lived (5-min TTL) and generated server-side. Never expose the TURN shared secret to clients.
- **No files are ever stored** on any server. All data is ephemeral and destroyed when the room closes.

## License

MIT
