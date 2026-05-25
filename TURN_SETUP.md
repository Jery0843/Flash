# TURN Server Setup Guide

## Option 1: Cloudflare Calls (Recommended for Cloudflare users)

### Status: Beta (Request Access Required)
Cloudflare Calls is currently in beta. To get access:

1. Go to https://dash.cloudflare.com/
2. Navigate to your account → Calls
3. Request beta access if not available
4. Once enabled, you'll get:
   - TURN server domain (e.g., `turn.cloudflare.com`)
   - Shared secret for HMAC authentication

### Configuration:
Once you have credentials, add to your signaling server:

```bash
# In signaling directory
npx wrangler secret put TURN_SECRET
# Paste your Cloudflare Calls shared secret

npx wrangler secret put TURN_DOMAIN
# Enter: turn.cloudflare.com (or your assigned domain)
```

Then deploy:
```bash
cd signaling
npx wrangler deploy
```

---

## Option 2: Metered.ca (Free Tier Available - EASIEST)

### Free Tier: 50GB/month bandwidth

1. Sign up at https://www.metered.ca/tools/openrelay/
2. You'll get instant TURN credentials (no waiting)
3. Copy your credentials

### Configuration:

Add secrets to your signaling server:
```bash
cd signaling

# Add the TURN domain
npx wrangler secret put TURN_DOMAIN
# Enter: a.relay.metered.ca (or your assigned server)

# Add the shared secret
npx wrangler secret put TURN_SECRET
# Paste your secret from Metered dashboard
```

Deploy:
```bash
npx wrangler deploy
```

---

## Option 3: Twilio TURN (Pay-as-you-go)

### Pricing: ~$0.40 per GB

1. Sign up at https://www.twilio.com/stun-turn
2. Get API credentials
3. Use Twilio's API to generate ephemeral credentials

**Note:** Requires different implementation (REST API instead of HMAC)

---

## Testing Your TURN Setup

After configuration, test the connection:

1. Open browser console on https://blitz.cloudpcs017.workers.dev
2. Check the ICE servers being used:
   ```javascript
   // Should show TURN servers in addition to STUN
   ```

3. Test with Trickle ICE: https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/
   - Enter your TURN credentials
   - Should show "relay" candidates

---

## Current Status

Your app currently uses:
- ✅ STUN servers (free, for direct P2P)
- ❌ TURN servers (not configured)

**Success Rate:**
- With STUN only: ~80% of connections work
- With TURN fallback: ~99% of connections work

**Recommendation:** Start with Metered.ca free tier (50GB/month) to test TURN functionality.
