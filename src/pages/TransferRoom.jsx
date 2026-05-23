import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { StatusIndicator } from '../components/StatusIndicator';
import { TransferProgress } from '../components/TransferProgress';
import { TransferStats } from '../components/TransferStats';
import { FilePreview } from '../components/FilePreview';
import { useSignaling } from '../hooks/useSignaling';
import { useWebRTC } from '../hooks/useWebRTC';
import { useFileTransfer } from '../hooks/useFileTransfer';
import { MSG, ROOM_STATES, CHUNK_SIZE, formatFileSize, getFileIcon } from '../lib/constants';
import './TransferRoom.css';

export function TransferRoom() {
  const location = useLocation();
  const navigate = useNavigate();
  const { role, files: senderFiles, fileMetadata: initialMetadata } = location.state || {};

  const signaling = useSignaling();
  const webrtc = useWebRTC();
  const fileTransfer = useFileTransfer();

  const [roomStatus, setRoomStatus] = useState(ROOM_STATES.NEGOTIATING);
  const [error, setError] = useState(null);
  const isSender = role === 'sender';
  const hasStartedRef = useRef(false);
  const displayRoomStatus = fileTransfer.transferState === 'completed' ? ROOM_STATES.COMPLETED : roomStatus;

  // Build manifest for display
  const manifest = isSender
    ? {
        files: (senderFiles || []).map((f) => ({
          name: f.name,
          size: f.size,
          type: f.type || 'application/octet-stream',
          totalChunks: Math.ceil(f.size / CHUNK_SIZE),
        })),
        totalFiles: (senderFiles || []).length,
        totalSize: (senderFiles || []).reduce((sum, f) => sum + f.size, 0),
      }
    : initialMetadata;

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
        // Reuse the existing room socket across route changes.
        if (!signaling.client?.connected) {
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
          setRoomStatus(ROOM_STATES.TRANSFERRING);
          if (isSender && senderFiles?.length > 0) {
            fileTransfer.startSending(senderFiles, manager.dataChannel);
          }
          if (!isSender && initialMetadata) {
            fileTransfer.startReceiving(initialMetadata, manager.dataChannel);
          }
        });

        manager.on('connection-failed', () => {
          setRoomStatus(ROOM_STATES.FAILED);
          setError('WebRTC connection failed. The network may be too restrictive.');
        });

        manager.on('fallback-ws', () => {
          setRoomStatus(ROOM_STATES.RELAY_FALLBACK);
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
    }
  }, [fileTransfer.transferState, signaling]);

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

  // Current file info for header display
  const currentFile = manifest?.files?.[fileTransfer.currentFileIndex] || manifest?.files?.[0] || null;

  if (!location.state) return null;

  return (
    <div className="transfer-room-page">
      <div className="transfer-header">
        <div className="transfer-header-left">
          <h1>{isSender ? 'Sending Files' : 'Receiving Files'}</h1>
        </div>
        <StatusIndicator status={displayRoomStatus} />
      </div>

      {/* File info card */}
      {currentFile && manifest && (
        <div className="transfer-file-card glass-card">
          <div className="transfer-file-header">
            <span className="transfer-file-icon">
              {manifest.totalFiles > 1 ? '🗂️' : getFileIcon(currentFile.type, currentFile.name)}
            </span>
            <div>
              <div className="transfer-file-name">
                {currentFile.name}
                {manifest.totalFiles > 1 && (
                  <span className="transfer-file-counter">
                    {' '}({(fileTransfer.currentFileIndex ?? 0) + 1}/{manifest.totalFiles})
                  </span>
                )}
              </div>
              <div className="transfer-file-meta">
                {formatFileSize(currentFile.size)} · {currentFile.type || 'Unknown'}
              </div>
              {manifest.totalFiles > 1 && (
                <div className="transfer-file-meta">
                  {manifest.totalFiles} files · {formatFileSize(manifest.totalSize)} total
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Negotiating state */}
      {(displayRoomStatus === ROOM_STATES.NEGOTIATING || displayRoomStatus === ROOM_STATES.RELAY_FALLBACK) && !error && (
        <div className="negotiating-section">
          <div className="negotiating-spinner" />
          <div className="negotiating-text">
            {displayRoomStatus === ROOM_STATES.RELAY_FALLBACK
              ? 'Trying relay connection...'
              : 'Establishing secure connection...'}
          </div>
        </div>
      )}

      {/* Transfer in progress */}
      {(displayRoomStatus === ROOM_STATES.TRANSFERRING || displayRoomStatus === ROOM_STATES.CONNECTED) && (
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
      {displayRoomStatus === ROOM_STATES.COMPLETED && (
        <div className="transfer-complete">
          <div className="transfer-complete-icon">✅</div>
          <div className="transfer-complete-title">Transfer Complete!</div>
          <div className="transfer-complete-subtitle">
            {isSender
              ? `${manifest?.totalFiles || 1} file${(manifest?.totalFiles || 1) !== 1 ? 's' : ''} sent successfully.`
              : `${fileTransfer.receivedFiles.length} file${fileTransfer.receivedFiles.length !== 1 ? 's' : ''} received successfully.`}
          </div>

          {/* Preview + Download for receiver */}
          {!isSender && fileTransfer.receivedFiles.length > 0 && (
            <>
              {/* Show preview for last received file */}
              <FilePreview
                blob={fileTransfer.receivedFiles[fileTransfer.receivedFiles.length - 1].blob}
                name={fileTransfer.receivedFiles[fileTransfer.receivedFiles.length - 1].name}
                type={fileTransfer.receivedFiles[fileTransfer.receivedFiles.length - 1].type}
              />
              <div className="transfer-download-actions">
                {fileTransfer.receivedFiles.length === 1 ? (
                  <button
                    className="btn btn-primary btn-lg"
                    onClick={() => fileTransfer.download(0)}
                    id="download-btn"
                  >
                    📥 Download File
                  </button>
                ) : (
                  <>
                    <button
                      className="btn btn-primary btn-lg"
                      onClick={fileTransfer.downloadAll}
                      id="download-all-btn"
                    >
                      📥 Download All ({fileTransfer.receivedFiles.length} files)
                    </button>
                  </>
                )}
              </div>

              {/* Individual file list for multi-file */}
              {fileTransfer.receivedFiles.length > 1 && (
                <div className="transfer-received-list">
                  {fileTransfer.receivedFiles.map((file, i) => (
                    <div className="transfer-received-item" key={`${file.name}-${i}`}>
                      <span className="transfer-received-icon">{getFileIcon(file.type, file.name)}</span>
                      <div className="transfer-received-info">
                        <div className="transfer-received-name">{file.name}</div>
                        <div className="transfer-received-meta">{formatFileSize(file.size)}</div>
                      </div>
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => fileTransfer.download(i)}
                      >
                        📥
                      </button>
                    </div>
                  ))}
                </div>
              )}
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
      {(displayRoomStatus === ROOM_STATES.FAILED || displayRoomStatus === ROOM_STATES.CANCELLED) && (
        <div className="transfer-failed">
          <div className="transfer-failed-icon">
            {displayRoomStatus === ROOM_STATES.CANCELLED ? '🚫' : '❌'}
          </div>
          <div className="transfer-failed-title">
            {displayRoomStatus === ROOM_STATES.CANCELLED ? 'Transfer Cancelled' : 'Transfer Failed'}
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
