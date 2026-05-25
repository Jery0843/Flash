/* ═══════════════════════════════════════════════════════════
   Blitz - Multi-Peer Sender
   Manages N concurrent receivers from a single sender. Each peer
   has its own RTCPeerConnection + FileSender pipeline.

   Lifecycle per peer:
     1. receiver_joined arrives → status='pending-approval'
     2. approve(peerId) → send FILE_METADATA + create RTCPeerConnection,
        send SDP_OFFER; status='connecting'
     3. data-channel opens → status='transferring', file send starts
     4. transfer ends → 'completed' / 'failed' / 'cancelled' / 'rejected'
   ═══════════════════════════════════════════════════════════ */

import { WebRTCManager } from './webrtc';
import { FileSender, createTransport } from './fileTransfer';
import { MSG } from './constants';

export class MultiPeerSender {
  constructor({ signaling, files, manifest, onChange }) {
    this.signaling = signaling;
    this.files = files;
    this.manifest = manifest;
    this.onChange = typeof onChange === 'function' ? onChange : () => {};
    this.peers = new Map();
    this._unsubs = [];
    this._closed = false;
    this._wire();
  }

  // ── Public API ──────────────────────────────────────────

  list() {
    return [...this.peers.entries()].map(([id, p]) => this._snapshot(id, p));
  }

  async approve(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer || peer.status !== 'pending-approval') return;

    peer.status = 'connecting';
    this._emit();

    try {
      // Send the file manifest to that receiver only. The server routes by
      // payload.targetPeerId so other receivers won't see this.
      this.signaling.send(MSG.FILE_METADATA, {
        ...this.manifest,
        targetPeerId: peerId,
      });

      const webrtc = new WebRTCManager();
      peer.webrtc = webrtc;

      webrtc.on('ice-candidate', (candidate) => {
        this.signaling.send(MSG.ICE_CANDIDATE, { candidate, targetPeerId: peerId });
      });

      webrtc.on('ice-restart-offer', (offer) => {
        console.log('[MultiPeerSender] ICE restart initiated for peer:', peerId);
        this.signaling.send(MSG.SDP_OFFER, { sdp: offer, targetPeerId: peerId });
      });

      webrtc.on('connection-type', (t) => {
        peer.connectionType = t;
        this._emit();
      });

      webrtc.on('connection-failed', () => {
        if (peer.status === 'completed') return;
        // Don't fail immediately if it's a re-join
        if (peer.status === 'transferring' || peer.status === 'connecting') {
           console.log(`[MultiPeerSender] Connection failed for peer ${peerId}, waiting for re-join...`);
           peer.status = 'disconnected';
           this._emit();
           return;
        }
        peer.status = 'failed';
        peer.error = 'WebRTC connection failed';
        this._emit();
      });

      webrtc.on('channel-open', () => {
        peer.status = 'transferring';
        this._emit();

        const transport = createTransport(webrtc.dataChannel);
        const sender = new FileSender(this.files, transport);
        peer.fileSender = sender;

        const pendingResume = peer.pendingResume;
        peer.pendingResume = null;

        sender.onProgress = (s) => {
          peer.progress = s;
          this._emit();
        };
        sender.onComplete = (s) => {
          peer.progress = s;
          peer.status = 'completed';
          this._emit();
        };
        sender.onError = (err) => {
          peer.error = err?.message || 'Transfer error';
          peer.status = 'failed';
          this._emit();
        };

        if (pendingResume) {
          sender._pendingResume = { fileIndex: pendingResume.fileIndex, resumeFromChunk: pendingResume.resumeFromChunk };
          sender.start();
        } else {
          sender.start();
        }
      });

      await webrtc.init(true);
      const offer = await webrtc.createOffer();
      this.signaling.send(MSG.SDP_OFFER, { sdp: offer, targetPeerId: peerId });
    } catch (err) {
      peer.status = 'failed';
      peer.error = err?.message || 'Failed to start session';
      this._emit();
    }
  }

  reject(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.signaling.send(MSG.TRANSFER_CANCEL, { targetPeerId: peerId });
    peer.status = 'rejected';
    peer.webrtc?.close();
    peer.fileSender?.cancel();
    this._emit();
  }

  cancel(peerId) {
    const peer = this.peers.get(peerId);
    if (!peer) return;
    this.signaling.send(MSG.TRANSFER_CANCEL, { targetPeerId: peerId });
    peer.status = 'cancelled';
    peer.webrtc?.close();
    peer.fileSender?.cancel();
    this._emit();
  }

  pause(peerId) { this.peers.get(peerId)?.fileSender?.pause(); }
  resume(peerId) { this.peers.get(peerId)?.fileSender?.resume(); }

  closeAll() {
    if (this._closed) return;
    this._closed = true;
    for (const peer of this.peers.values()) {
      peer.webrtc?.close();
      peer.fileSender?.cancel();
    }
    this.peers.clear();
    this._unsubs.forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    this._unsubs = [];
  }

  // ── Internals ───────────────────────────────────────────

  _snapshot(id, p) {
    return {
      peerId: id,
      status: p.status,
      progress: p.progress || null,
      error: p.error || null,
      connectionType: p.connectionType || null,
      joinedAt: p.joinedAt,
    };
  }

  _emit() {
    if (this._closed) return;
    this.onChange(this.list());
  }

  _wire() {
    const off = (fn) => { if (typeof fn === 'function') this._unsubs.push(fn); };
    const sig = this.signaling;

    off(sig.on(MSG.RECEIVER_JOINED, ({ peerId, isRejoin }) => {
      if (!peerId) return;
      
      const existingPeer = this.peers.get(peerId);

      // isRejoin=true means the server confirmed this is the same peer
      // reconnecting with the same peerId — skip approval entirely.
      if (isRejoin && existingPeer) {
        console.log(`[MultiPeerSender] Peer ${peerId} rejoined (same peerId), auto-approving silently`);
        // Clean up old WebRTC session but keep progress/state
        existingPeer.webrtc?.close();
        existingPeer.fileSender?.cancel();
        existingPeer.status = 'connecting';
        this._emit();
        this.approve(peerId);
        return;
      }

      let shouldAutoApprove = false;

      if (existingPeer) {
        // Auto-approve if they were already approved/transferring/completed
        const autoApproveStatuses = ['connecting', 'transferring', 'failed', 'disconnected', 'completed'];
        if (autoApproveStatuses.includes(existingPeer.status)) {
          shouldAutoApprove = true;
        }
        
        // Clean up old session
        existingPeer.webrtc?.close();
        existingPeer.fileSender?.cancel();
      }
      
      this.peers.set(peerId, {
        status: 'pending-approval',
        progress: existingPeer?.progress || null,
        joinedAt: existingPeer?.joinedAt || Date.now(),
        pendingResume: existingPeer?.pendingResume || null,
      });

      if (shouldAutoApprove) {
        console.log(`[MultiPeerSender] Auto-approving rejoin for peer: ${peerId}`);
        this.approve(peerId);
      } else {
        this._emit();
      }
    }));

    off(sig.on(MSG.RECEIVER_LEFT, ({ peerId }) => {
      const peer = this.peers.get(peerId);
      if (!peer) return;
      peer.webrtc?.close();
      peer.fileSender?.cancel();
      if (peer.status === 'completed') {
        // Keep completed entries visible.
        this._emit();
      } else {
        peer.status = 'disconnected';
        this._emit();
      }
    }));

    off(sig.on(MSG.TRANSFER_ACCEPT, ({ peerId }) => {
      // Receiver confirmed they want the files. Nothing for sender to do —
      // negotiation already in flight; transfer auto-starts on channel open.
      const peer = this.peers.get(peerId);
      if (peer && peer.status === 'connecting') this._emit();
    }));

    off(sig.on(MSG.TRANSFER_REJECT, ({ peerId }) => {
      const peer = this.peers.get(peerId);
      if (!peer) return;
      peer.status = 'rejected';
      peer.webrtc?.close();
      peer.fileSender?.cancel();
      this._emit();
    }));

    off(sig.on(MSG.SDP_ANSWER, async ({ peerId, sdp }) => {
      const peer = this.peers.get(peerId);
      if (!peer?.webrtc) return;
      try {
        await peer.webrtc.handleAnswer(sdp);
      } catch (err) {
        // Only fail if not already disconnected (waiting for rejoin)
        if (peer.status !== 'disconnected') {
          peer.status = 'failed';
          peer.error = err?.message || 'SDP answer failed';
          this._emit();
        }
      }
    }));

    off(sig.on(MSG.ICE_CANDIDATE, async ({ peerId, candidate }) => {
      const peer = this.peers.get(peerId);
      if (!peer?.webrtc || !candidate) return;
      try {
        await peer.webrtc.addIceCandidate(candidate);
      } catch (err) {
        // Non-fatal — late candidates after PC close are common.
        console.warn('[MultiPeerSender] addIceCandidate failed:', err?.message);
      }
    }));

    off(sig.on(MSG.TRANSFER_COMPLETE, ({ peerId }) => {
      const peer = this.peers.get(peerId);
      if (!peer) return;
      peer.status = 'completed';
      this._emit();
    }));

    off(sig.on(MSG.TRANSFER_CANCEL, ({ peerId }) => {
      const peer = this.peers.get(peerId);
      if (!peer) return;
      peer.status = 'cancelled';
      peer.webrtc?.close();
      peer.fileSender?.cancel();
      this._emit();
    }));

    // Handle resume requests from receivers
    off(sig.on(MSG.FILE_RESUME_REQUEST, ({ peerId, fileIndex, resumeFromChunk }) => {
      console.log(`[MultiPeerSender] Resume request from peer ${peerId} for file ${fileIndex} from chunk ${resumeFromChunk}`);
      const peer = this.peers.get(peerId);
      if (!peer) {
        console.warn('[MultiPeerSender] Resume request from unknown peer:', peerId);
        return;
      }

      if (peer.fileSender) {
        peer.fileSender.setResumePosition(fileIndex, resumeFromChunk);
      } else {
        peer.pendingResume = { fileIndex, resumeFromChunk };
      }
    }));
  }
}
