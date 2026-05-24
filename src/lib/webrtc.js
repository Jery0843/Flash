/* ═══════════════════════════════════════════════════════════
   Flash - WebRTC Manager
   RTCPeerConnection + RTCDataChannel management with
   3-tier connection strategy (P2P → TURN → WS fallback)
   ═══════════════════════════════════════════════════════════ */

import {
  WEBRTC_CONFIG, DATA_CHANNEL_CONFIG, ICE_TIMEOUT_MS,
  TURN_CREDENTIALS_URL, CONNECTION_TYPES,
} from './constants';

/**
 * WebRTCManager handles the peer connection lifecycle.
 * 
 * Security notes:
 * - All DataChannel traffic is DTLS-encrypted by the browser automatically.
 * - ICE candidates contain IP addresses but are only exchanged via WSS signaling.
 * - TURN credentials are short-lived (5-min TTL), fetched from the server.
 * - The UI never displays IP addresses to users.
 */
export class WebRTCManager {
  constructor() {
    this.pc = null;
    this.dataChannel = null;
    this.connectionType = null;
    this.listeners = new Map();
    this.iceTimeout = null;
    this.iceCandidateBuffer = [];
    this.isInitiator = false;
    this.keepaliveInterval = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 20; // Increased from 3 to allow longer retry windows
    this.reconnectDelay = 2000;
  }

  /**
   * Initialize the peer connection.
   * @param {boolean} initiator - true for sender, false for receiver
   * @param {object} signalingClient - Optional signaling client for fetching TURN credentials
   */
  async init(initiator, signalingClient = null) {
    this.isInitiator = initiator;
    
    // Fetch TURN credentials for global connectivity
    const config = await this._getIceConfig(signalingClient);
    
    this.pc = new RTCPeerConnection(config);

    // ICE candidate handling
    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this._emit('ice-candidate', event.candidate);
      }
    };

    // Connection state monitoring
    this.pc.oniceconnectionstatechange = () => {
      const state = this.pc.iceConnectionState;
      this._emit('ice-state', state);

      if (state === 'connected' || state === 'completed') {
        this._clearIceTimeout();
        this._detectConnectionType();
        this.reconnectAttempts = 0; // Reset on successful connection
      } else if (state === 'failed') {
        this._clearIceTimeout();
        // Attempt ICE restart before giving up
        this._attemptReconnection();
      } else if (state === 'disconnected') {
        // WebRTC may recover automatically; wait before reporting
        // For receivers, we want to be more aggressive with re-connecting
        // For senders, we wait a bit longer.
        const timeout = this.isInitiator ? 30000 : 10000;
        setTimeout(() => {
          if (this.pc?.iceConnectionState === 'disconnected') {
            this._attemptReconnection();
          }
        }, timeout);
      }
    };

    this.pc.onconnectionstatechange = () => {
      this._emit('connection-state', this.pc.connectionState);
    };

    // Data channel setup
    if (initiator) {
      // Sender creates the data channel
      this.dataChannel = this.pc.createDataChannel('file-transfer', DATA_CHANNEL_CONFIG);
      this._setupDataChannel(this.dataChannel);
    } else {
      // Receiver waits for the data channel
      this.pc.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this._setupDataChannel(this.dataChannel);
      };
    }

    // Start ICE timeout for fallback detection
    this._startIceTimeout();

    // Apply any buffered ICE candidates
    for (const candidate of this.iceCandidateBuffer) {
      await this.pc.addIceCandidate(candidate);
    }
    this.iceCandidateBuffer = [];
  }

  /**
   * Create an SDP offer (sender).
   */
  async createOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    return this.pc.localDescription;
  }

  /**
   * Handle a received SDP offer and create an answer (receiver).
   */
  async handleOffer(offer) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return this.pc.localDescription;
  }

  /**
   * Handle a received SDP answer (sender).
   */
  async handleAnswer(answer) {
    if (!this.pc) return;
    if (this.pc.signalingState !== 'have-local-offer') {
      console.warn('[WebRTC] Ignoring answer: PC is in state', this.pc.signalingState);
      return;
    }
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  /**
   * Add a received ICE candidate.
   */
  async addIceCandidate(candidate) {
    if (!this.pc || !this.pc.remoteDescription) {
      // Buffer candidates until remote description is set
      this.iceCandidateBuffer.push(new RTCIceCandidate(candidate));
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.warn('[WebRTC] Failed to add ICE candidate:', err.message);
    }
  }

  /**
   * Send data through the data channel.
   */
  send(data) {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      return false;
    }
    this.dataChannel.send(data);
    return true;
  }

  /**
   * Get the current buffered amount.
   */
  get bufferedAmount() {
    return this.dataChannel?.bufferedAmount || 0;
  }

  /**
   * Close the connection and clean up.
   */
  close() {
    this._clearIceTimeout();
    this._stopKeepalive();
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.listeners.clear();
    this.connectionType = null;
    this.reconnectAttempts = 0;
  }

  /**
   * Attempt to restart ICE connection on failure.
   * This creates a new ICE negotiation to re-establish the connection.
   */
  async restartIce() {
    if (!this.pc || this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[WebRTC] Max reconnection attempts reached or no connection');
      return false;
    }

    this.reconnectAttempts++;
    console.log(`[WebRTC] Attempting ICE restart (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    try {
      // Create a new offer with ICE restart flag
      const offer = await this.pc.createOffer({ iceRestart: true });
      await this.pc.setLocalDescription(offer);
      
      // Emit the new offer for the remote peer
      this._emit('ice-restart-offer', offer);
      
      return true;
    } catch (err) {
      console.error('[WebRTC] ICE restart failed:', err);
      return false;
    }
  }

  /**
   * Register an event listener.
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    return () => this.off(event, callback);
  }

  off(event, callback) {
    this.listeners.get(event)?.delete(callback);
  }

  // ── Private Methods ────────────────────────────────────

  _setupDataChannel(channel) {
    channel.binaryType = 'arraybuffer';

    channel.onopen = () => {
      this._emit('channel-open');
      this._emit('channel-reopen', channel); // Emit with channel reference for rewiring
      this._startKeepalive();
    };

    channel.onclose = () => {
      this._stopKeepalive();
      this._emit('channel-close');
    };

    channel.onerror = (err) => {
      console.error('[WebRTC] DataChannel error:', err);
      this._emit('channel-error', err);
    };

    channel.onmessage = (event) => {
      // Handle keepalive pong
      if (event.data === 'pong') {
        return;
      }
      this._emit('data', event.data);
    };

    channel.onbufferedamountlow = () => {
      this._emit('buffer-low');
    };
  }

  async _getIceConfig(signalingClient = null) {
    const config = { ...WEBRTC_CONFIG };
    
    // Try to fetch short-lived TURN credentials from signaling server
    if (signalingClient && signalingClient.getTurnCredentials) {
      try {
        const turnData = await signalingClient.getTurnCredentials();
        if (turnData.iceServers && turnData.iceServers.length > 0) {
          config.iceServers = [
            ...config.iceServers,
            ...turnData.iceServers,
          ];
          console.log('[WebRTC] TURN credentials added from signaling server');
        }
      } catch (err) {
        // TURN credentials unavailable — continue with STUN only
        // P2P will still work for ~80% of connections
        console.warn('[WebRTC] Could not fetch TURN credentials via signaling:', err.message);
      }
    } else {
      // Fallback to direct fetch if no signaling client provided
      try {
        const res = await fetch(TURN_CREDENTIALS_URL, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' },
        });
        
        if (res.ok) {
          const turnData = await res.json();
          if (turnData.iceServers) {
            config.iceServers = [
              ...config.iceServers,
              ...turnData.iceServers,
            ];
          }
        }
      } catch (err) {
        // TURN credentials unavailable — continue with STUN only
        // P2P will still work for ~80% of connections
        console.warn('[WebRTC] Could not fetch TURN credentials:', err.message);
      }
    }

    return config;
  }

  _startIceTimeout() {
    this._clearIceTimeout();
    this.iceTimeout = setTimeout(() => {
      if (this.pc && 
          this.pc.iceConnectionState !== 'connected' && 
          this.pc.iceConnectionState !== 'completed') {
        console.warn('[WebRTC] ICE timeout — falling back to WS relay');
        this._emit('fallback-ws');
      }
    }, ICE_TIMEOUT_MS);
  }

  _clearIceTimeout() {
    if (this.iceTimeout) {
      clearTimeout(this.iceTimeout);
      this.iceTimeout = null;
    }
  }

  _startKeepalive() {
    this._stopKeepalive();
    // Send ping every 15 seconds to keep connection alive
    this.keepaliveInterval = setInterval(() => {
      if (this.dataChannel && this.dataChannel.readyState === 'open') {
        try {
          this.dataChannel.send('ping');
        } catch (err) {
          console.warn('[WebRTC] Keepalive failed:', err);
        }
      }
    }, 15000);
  }

  _stopKeepalive() {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }
  }

  /**
   * Attempt to reconnect on transient failures.
   * Tries ICE restart first, then falls back to reporting failure.
   */
  async _attemptReconnection() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[WebRTC] Max reconnection attempts reached');
      this._emit('connection-failed');
      return;
    }

    // Exponential backoff for reconnection attempts
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    
    console.log(`[WebRTC] Connection lost, attempting reconnection in ${delay}ms (attempt ${this.reconnectAttempts + 1}/${this.maxReconnectAttempts})`);
    
    setTimeout(async () => {
      // Check if connection recovered automatically
      if (this.pc && (this.pc.iceConnectionState === 'connected' || this.pc.iceConnectionState === 'completed')) {
        console.log('[WebRTC] Connection recovered automatically');
        this.reconnectAttempts = 0;
        return;
      }

      // Try ICE restart
      const restartSuccess = await this.restartIce();
      if (!restartSuccess) {
        this._emit('connection-failed');
      }
    }, delay);
  }

  /**
   * Detect whether we're on a direct P2P or TURN relay connection.
   * Uses getStats() to inspect the selected candidate pair.
   */
  async _detectConnectionType() {
    if (!this.pc) return;
    
    try {
      const stats = await this.pc.getStats();
      for (const report of stats.values()) {
        if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          const localCandidate = stats.get(report.localCandidateId);
          if (localCandidate) {
            if (localCandidate.candidateType === 'relay') {
              this.connectionType = CONNECTION_TYPES.RELAY;
            } else {
              this.connectionType = CONNECTION_TYPES.DIRECT;
            }
            this._emit('connection-type', this.connectionType);
            return;
          }
        }
      }
    } catch (err) {
      console.warn('[WebRTC] Could not detect connection type:', err);
    }
    
    this.connectionType = CONNECTION_TYPES.DIRECT;
    this._emit('connection-type', this.connectionType);
  }

  _emit(event, data) {
    this.listeners.get(event)?.forEach(cb => {
      try { cb(data); } catch (err) {
        console.error('[WebRTC] Listener error:', err);
      }
    });
  }
}
