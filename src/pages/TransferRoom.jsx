import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { StatusIndicator } from '../components/StatusIndicator';
import { TransferProgress } from '../components/TransferProgress';
import { TransferStats } from '../components/TransferStats';
import { FilePreview } from '../components/FilePreview';
import { useSignaling } from '../hooks/useSignaling';
import { useWebRTC } from '../hooks/useWebRTC';
import { useFileTransfer } from '../hooks/useFileTransfer';
import { MSG, ROOM_STATES, CONNECTION_TYPES, formatFileSize, getFileIcon } from '../lib/constants';
import './TransferRoom.css';

export function TransferRoom() {
  const location = useLocation();
  const navigate = useNavigate();
  const { role, file, roomCode, fileMetadata: initialMetadata } = location.state || {};

  const signaling = useSignaling();
  const webrtc = useWebRTC();
  const fileTransfer = useFileTransfer();

  const [roomStatus, setRoomStatus] = useState(ROOM_STATES.NEGOTIATING);
  const [error, setError] = useState(null);
  const isSender = role === 'sender';
  const hasStartedRef = useRef(false);

  // Redirect if no state
  useEffect(() => {
    if (!location.state) {
      navigate('/', { replace: true });
    }
  }, [location.state, navigate]);

  // WebRTC negotiation
  useEffect(() => {
    if (hasStartedRef.current || !signaling.client) return;
    hasStartedRef.current = true;

    const setupWebRTC = async () => {
      try {
        // Ensure signaling is connected
        if (!signaling.connected) {
          await signaling.connect();
        }

        const manager = await webrtc.init(isSender);

        // Wire up ICE candidates
        manager.on('ice-candidate', (candidate) => {
          signaling.send(MSG.ICE_CANDIDATE, { candidate });
        });

        // Wire up connection events
        manager.on('channel-open', () => {
          setRoomStatus(ROOM_STATES.CONNECTED);
          if (isSender && file) {
            setRoomStatus(ROOM_STATES.TRANSFERRING);
            fileTransfer.startSending(file, manager.dataChannel);
          }
        });

        manager.on('connection-failed', () => {
          setRoomStatus(ROOM_STATES.FAILED);
          setError('WebRTC connection failed. The network may be too restrictive.');
        });

        manager.on('fallback-ws', () => {
          setRoomStatus(ROOM_STATES.RELAY_FALLBACK);
          // In MVP: show error. Full WS relay would be implemented here.
          setError('Direct connection failed. WebSocket relay not yet implemented in MVP.');
        });

        // Listen for incoming signaling messages
        signaling.on(MSG.SDP_OFFER, async (data) => {
          const answer = await manager.handleOffer(data.sdp);
          signaling.send(MSG.SDP_ANSWER, { sdp: answer });
        });

        signaling.on(MSG.SDP_ANSWER, async (data) => {
          await manager.handleAnswer(data.sdp);
        });

        signaling.on(MSG.ICE_CANDIDATE, async (data) => {
          await manager.addIceCandidate(data.candidate);
        });

        signaling.on(MSG.TRANSFER_COMPLETE, () => {
          setRoomStatus(ROOM_STATES.COMPLETED);
        });

        signaling.on(MSG.TRANSFER_CANCEL, () => {
          setRoomStatus(ROOM_STATES.CANCELLED);
          setError('Transfer was cancelled by the other peer.');
          webrtc.close();
        });

        // If sender, create and send offer
        if (isSender) {
          const offer = await manager.createOffer();
          signaling.send(MSG.SDP_OFFER, { sdp: offer });
        }

        // If receiver, wire up data receiving
        if (!isSender && initialMetadata) {
          manager.on('channel-open', () => {
            setRoomStatus(ROOM_STATES.TRANSFERRING);
            fileTransfer.startReceiving(initialMetadata, manager.dataChannel);
          });
        }

      } catch (err) {
        setError(err.message || 'Failed to establish connection');
        setRoomStatus(ROOM_STATES.FAILED);
      }
    };

    setupWebRTC();

    return () => {
      webrtc.close();
      signaling.disconnect();
    };
  }, []);

  // Handle transfer completion — notify other peer
  useEffect(() => {
    if (fileTransfer.transferState === 'completed') {
      signaling.send(MSG.TRANSFER_COMPLETE);
      setRoomStatus(ROOM_STATES.COMPLETED);
    }
  }, [fileTransfer.transferState]);

  const handleCancel = useCallback(() => {
    fileTransfer.cancel();
    signaling.send(MSG.TRANSFER_CANCEL);
    webrtc.close();
    setRoomStatus(ROOM_STATES.CANCELLED);
  }, [fileTransfer, signaling, webrtc]);

  const handlePause = useCallback(() => {
    fileTransfer.pause();
  }, [fileTransfer]);

  const handleResume = useCallback(() => {
    fileTransfer.resume();
  }, [fileTransfer]);

  // File info for display
  const displayFile = isSender
    ? file ? { name: file.name, size: file.size, type: file.type } : null
    : initialMetadata;

  if (!location.state) return null;

  return (
    <div className="transfer-room-page">
      <div className="transfer-header">
        <div className="transfer-header-left">
          <h1>{isSender ? 'Sending File' : 'Receiving File'}</h1>
        </div>
        <StatusIndicator status={roomStatus} />
      </div>

      {/* File info card */}
      {displayFile && (
        <div className="transfer-file-card glass-card">
          <div className="transfer-file-header">
            <span className="transfer-file-icon">
              {getFileIcon(displayFile.type, displayFile.name)}
            </span>
            <div>
              <div className="transfer-file-name">{displayFile.name}</div>
              <div className="transfer-file-meta">
                {formatFileSize(displayFile.size)} · {displayFile.type || 'Unknown'}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Negotiating state */}
      {(roomStatus === ROOM_STATES.NEGOTIATING || roomStatus === ROOM_STATES.RELAY_FALLBACK) && !error && (
        <div className="negotiating-section">
          <div className="negotiating-spinner" />
          <div className="negotiating-text">
            {roomStatus === ROOM_STATES.RELAY_FALLBACK
              ? 'Trying relay connection...'
              : 'Establishing secure connection...'}
          </div>
        </div>
      )}

      {/* Transfer in progress */}
      {(roomStatus === ROOM_STATES.TRANSFERRING || roomStatus === ROOM_STATES.CONNECTED) && (
        <div className="transfer-progress-section">
          <TransferProgress stats={fileTransfer.stats} />
          <TransferStats stats={fileTransfer.stats} connectionType={webrtc.connectionType} />

          <div className="transfer-controls">
            {isSender && fileTransfer.transferState === 'sending' && (
              <button className="btn btn-secondary" onClick={handlePause} id="pause-btn">
                ⏸ Pause
              </button>
            )}
            {fileTransfer.transferState === 'paused' && (
              <button className="btn btn-primary" onClick={handleResume} id="resume-btn">
                ▶ Resume
              </button>
            )}
            <button className="btn btn-danger" onClick={handleCancel} id="cancel-btn">
              ✕ Cancel
            </button>
          </div>
        </div>
      )}

      {/* Transfer complete */}
      {roomStatus === ROOM_STATES.COMPLETED && (
        <div className="transfer-complete">
          <div className="transfer-complete-icon">✅</div>
          <div className="transfer-complete-title">Transfer Complete!</div>
          <div className="transfer-complete-subtitle">
            {isSender ? 'File sent successfully.' : 'File received successfully.'}
          </div>

          {/* Preview for receiver */}
          {!isSender && fileTransfer.receivedFile && (
            <>
              <FilePreview
                blob={fileTransfer.receivedFile.blob}
                name={fileTransfer.receivedFile.name}
                type={fileTransfer.receivedFile.type}
              />
              <div style={{ marginTop: 'var(--space-4)' }}>
                <button
                  className="btn btn-primary btn-lg"
                  onClick={fileTransfer.download}
                  id="download-btn"
                >
                  📥 Download File
                </button>
              </div>
            </>
          )}

          <TransferStats stats={fileTransfer.stats} connectionType={webrtc.connectionType} />

          <div style={{ marginTop: 'var(--space-6)' }}>
            <Link to="/" className="btn btn-secondary" id="back-home-btn">
              ← Back to Home
            </Link>
          </div>
        </div>
      )}

      {/* Error / Failed state */}
      {(roomStatus === ROOM_STATES.FAILED || roomStatus === ROOM_STATES.CANCELLED) && (
        <div className="transfer-failed">
          <div className="transfer-failed-icon">
            {roomStatus === ROOM_STATES.CANCELLED ? '🚫' : '❌'}
          </div>
          <div className="transfer-failed-title">
            {roomStatus === ROOM_STATES.CANCELLED ? 'Transfer Cancelled' : 'Transfer Failed'}
          </div>
          <div className="transfer-failed-message">
            {error || 'Something went wrong during the transfer.'}
          </div>
          <Link to="/" className="btn btn-secondary" id="back-home-error-btn">
            ← Back to Home
          </Link>
        </div>
      )}
    </div>
  );
}
