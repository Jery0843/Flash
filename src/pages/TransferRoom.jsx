import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Upload, Download, CheckCircle, XCircle, Pause, Play, ArrowLeft, FolderOpen, FileText, Wifi, WifiOff, AlertCircle } from 'lucide-react';
import { StatusIndicator } from '../components/StatusIndicator';
import { TransferProgress } from '../components/TransferProgress';
import { TransferStats } from '../components/TransferStats';
import { FilePreview } from '../components/FilePreview';
import { SEO } from '../components/SEO';
import { DownloadOptionsModal } from '../components/DownloadOptionsModal';
import { useSignaling } from '../hooks/useSignaling';
import { useWebRTC } from '../hooks/useWebRTC';
import { useFileTransfer } from '../hooks/useFileTransfer';
import { MSG, ROOM_STATES, CHUNK_SIZE, formatFileSize, getFileIcon } from '../lib/constants';
import { createTransport } from '../lib/fileTransfer';
import './TransferRoom.css';

export function TransferRoom() {
  const location = useLocation();
  const navigate = useNavigate();
  
  // Persistent state restoration
  const [sessionData, setSessionData] = useState(() => {
    const fromLocation = location.state;
    if (fromLocation) {
      // Save to session storage for refresh survival
      const dataToSave = { ...fromLocation };
      // Don't save large File objects in session storage if possible
      // but for sender we need them. For now, try saving everything.
      try {
        sessionStorage.setItem('flash_transfer_session', JSON.stringify(dataToSave));
      } catch (e) {
        console.warn('[TransferRoom] Failed to save session state:', e);
      }
      return fromLocation;
    }

    // Try to restore from session storage
    const saved = sessionStorage.getItem('flash_transfer_session');
    if (saved) {
      try {
        console.log('[TransferRoom] Restoring session from storage after refresh');
        return JSON.parse(saved);
      } catch (e) {
        return null;
      }
    }
    return null;
  });

  const { role, files: senderFiles, fileMetadata: initialMetadata, peerId: initialPeerId, roomCode } = sessionData || {};
  const isSender = role === 'sender';

  const peerIdRef = useRef(initialPeerId);
  // Synchronize ref with sessionData
  useEffect(() => {
    peerIdRef.current = sessionData?.peerId;
  }, [sessionData]);

  const signaling = useSignaling();
  const webrtc = useWebRTC();
  const fileTransfer = useFileTransfer();

  const [roomStatus, setRoomStatus] = useState(ROOM_STATES.NEGOTIATING);
  const [error, setError] = useState(null);
  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const downloadButtonRef = useRef(null);
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
    if (!sessionData) {
      navigate('/', { replace: true });
    }
  }, [sessionData, navigate]);

  // Clear session on completion/cancel
  useEffect(() => {
    if (fileTransfer.transferState === 'completed' || roomStatus === ROOM_STATES.CANCELLED) {
      sessionStorage.removeItem('flash_transfer_session');
    }
  }, [fileTransfer.transferState, roomStatus]);

  // WebRTC negotiation
  useEffect(() => {
    if (hasStartedRef.current || !signaling.client) return;
    hasStartedRef.current = true;

    const setupWebRTC = async () => {
      try {
        // Ensure signaling is connected to the right room
        let joinResponse;
        if (roomCode) {
          joinResponse = await signaling.connect(isSender 
            ? { action: 'create', code: roomCode } 
            : { action: 'join', code: roomCode }
          );
          
          // Update our local peerId from the server response
          if (joinResponse?.peerId && joinResponse.peerId !== peerIdRef.current) {
            console.log('[TransferRoom] Server assigned peerId:', joinResponse.peerId);
            setSessionData(prev => prev ? { ...prev, peerId: joinResponse.peerId } : prev);
          }
        } else {
          await signaling.connect();
        }

        const manager = await webrtc.init(isSender);

        // Wire up ICE candidates
        manager.on('ice-candidate', (candidate) => {
          signaling.send(MSG.ICE_CANDIDATE, { 
            candidate, 
            targetPeerId: isSender ? peerIdRef.current : undefined // For receiver, server routes to sender automatically
          });
        });

        // Wire up connection events
        manager.on('channel-open', () => {
          setRoomStatus(ROOM_STATES.CONNECTED);
          setRoomStatus(ROOM_STATES.TRANSFERRING);
          
          // Wire up data channel to file transfer
          if (isSender && senderFiles?.length > 0) {
            // Check if already started
            if (!fileTransfer.senderRef?.current) {
              fileTransfer.startSending(senderFiles, manager.dataChannel);
            } else {
              // Reconnection - rewire the data channel
              console.log('[TransferRoom] Rewiring sender data channel after reconnection');
              const sender = fileTransfer.senderRef.current;
              sender.transport = createTransport(manager.dataChannel);
              
              // Restart the pump if we were in the middle of sending
              if (sender._currentPumpFile && !sender.cancelled) {
                console.log('[TransferRoom] Resyncing sender after reconnection');
                sender.resync();
              }
            }
          }
          
          if (!isSender && initialMetadata) {
            // Check if already started
            if (!fileTransfer.receiverRef?.current) {
              fileTransfer.startReceiving(initialMetadata, manager.dataChannel, signaling.client, roomCode, peerIdRef.current);
            } else {
              // Reconnection - rewire the data channel and trigger resume
              console.log('[TransferRoom] Rewiring receiver data channel after reconnection');
              const receiver = fileTransfer.receiverRef.current;
              manager.dataChannel.onmessage = (event) => {
                receiver.handleMessage(event.data);
              };
              
              if (receiver.currentFileMeta && receiver.currentFileId) {
                // Transfer was in progress — request resume from sender
                console.log('[TransferRoom] Triggering resume after reconnection');
                receiver.triggerResume();
              }
              // If no currentFileMeta, the sender will re-send file_start
              // automatically when its pump restarts (handled on sender side)
            }
          }
        });

        manager.on('channel-close', () => {
          console.log('[TransferRoom] Data channel closed, connection may be recovering...');
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
          // For receivers, only process offers targeted to this peer
          if (!isSender && peerIdRef.current && data.targetPeerId !== peerIdRef.current) {
            console.log('[TransferRoom] Ignoring SDP offer for different peer:', data.targetPeerId, 'my peerId:', peerIdRef.current);
            return;
          }
          const answer = await manager.handleOffer(data.sdp);
          signaling.send(MSG.SDP_ANSWER, { sdp: answer });
        });

        // Handle ICE restart offers (for reconnection)
        manager.on('ice-restart-offer', async (offer) => {
          console.log('[TransferRoom] Received ICE restart offer');
          if (isSender) {
            // Sender initiated ICE restart, send via signaling
            signaling.send(MSG.SDP_OFFER, { sdp: offer, targetPeerId: peerIdRef.current });
          } else {
            // Receiver received ICE restart offer, respond with answer
            const answer = await manager.handleOffer(offer);
            signaling.send(MSG.SDP_ANSWER, { sdp: answer });
          }
        });

        signaling.on(MSG.SDP_ANSWER, async (data) => {
          // For senders, only process answers from the expected peer
          if (isSender && peerIdRef.current && data.peerId !== peerIdRef.current) {
            console.log('[TransferRoom] Ignoring SDP answer from different peer:', data.peerId, 'my peerId:', peerIdRef.current);
            return;
          }
          await manager.handleAnswer(data.sdp);
        });

        signaling.on(MSG.ICE_CANDIDATE, async (data) => {
          // Filter ICE candidates by peerId
          if (!isSender && peerIdRef.current && data.targetPeerId !== peerIdRef.current) {
            console.log('[TransferRoom] Ignoring ICE candidate for different peer:', data.targetPeerId, 'my peerId:', peerIdRef.current);
            return;
          }
          if (isSender && peerIdRef.current && data.peerId !== peerIdRef.current) {
            console.log('[TransferRoom] Ignoring ICE candidate from different peer:', data.peerId, 'my peerId:', peerIdRef.current);
            return;
          }
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

        // Handle resume requests from receiver (sender only)
        if (isSender) {
          signaling.on(MSG.FILE_RESUME_REQUEST, (data) => {
            // For senders, only process requests from the expected peer
            if (peerIdRef.current && data.peerId !== peerIdRef.current) {
              console.log('[TransferRoom] Ignoring resume request from different peer:', data.peerId, 'my peerId:', peerIdRef.current);
              return;
            }
            console.log('[TransferRoom] Received resume request:', data);
            const { fileIndex, resumeFromChunk } = data;
            // Forward to the file sender
            const sender = fileTransfer.senderRef?.current;
            if (sender && sender.setResumePosition) {
              sender.setResumePosition(fileIndex, resumeFromChunk);
            }
          });
        }

        // If sender, create and send offer
        if (isSender) {
          const offer = await manager.createOffer();
          signaling.send(MSG.SDP_OFFER, { sdp: offer });
        }

      } catch (err) {
        console.error('[TransferRoom] WebRTC setup failed:', err);
        setError(err.message || 'Connection failed');
        setRoomStatus(ROOM_STATES.FAILED);
      }
    };

    setupWebRTC();

    return () => {
      // Cleanup is handled by hook teardown
    };
  }, [signaling.client, isSender, roomCode, initialMetadata, senderFiles, navigate]);

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
    <motion.div 
      className="transfer-room-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <SEO 
        title="Active Transfer" 
        description="A secure peer-to-peer file transfer is currently in progress."
        url={location.pathname}
      />
      <motion.div 
        className="transfer-header"
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
      >
        <div className="transfer-header-left">
          <h1>{isSender ? 'Sending Files' : 'Receiving Files'}</h1>
        </div>
        <StatusIndicator status={displayRoomStatus} />
      </motion.div>

      <AnimatePresence>
        {currentFile && manifest && (
          <motion.div 
            className="transfer-file-card glass-card"
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.1, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
          >
            <div className="transfer-file-header">
              <motion.span 
                className="transfer-file-icon"
                animate={{ rotate: [0, 5, -5, 0] }}
                transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
              >
                {manifest.totalFiles > 1 ? <FolderOpen size={32} className="text-cyan-400" /> : <FileText size={32} className="text-cyan-400" />}
              </motion.span>
              <div>
                <div className="transfer-file-name">
                  {currentFile.name}
                  {manifest.totalFiles > 1 && (
                    <motion.span 
                      className="transfer-file-counter"
                      initial={{ scale: 0 }}
                      animate={{ scale: 1 }}
                      transition={{ delay: 0.2 }}
                    >
                      {' '}({(fileTransfer.currentFileIndex ?? 0) + 1}/{manifest.totalFiles})
                    </motion.span>
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
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(displayRoomStatus === ROOM_STATES.NEGOTIATING || displayRoomStatus === ROOM_STATES.RELAY_FALLBACK) && !error && (
          <motion.div 
            className="negotiating-section"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.4 }}
          >
            <motion.div 
              className="negotiating-spinner"
              animate={{ rotate: 360 }}
              transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            >
              <Wifi size={48} className="text-cyan-400" />
            </motion.div>
            <motion.div 
              className="negotiating-text"
              animate={{ 
                opacity: [0.6, 1, 0.6],
                y: [0, -5, 0]
              }}
              transition={{ duration: 2, repeat: Infinity }}
            >
              {displayRoomStatus === ROOM_STATES.RELAY_FALLBACK
                ? 'Trying relay connection...'
                : !location.state && sessionData 
                  ? 'Restoring session...'
                  : 'Establishing secure connection...'}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(displayRoomStatus === ROOM_STATES.TRANSFERRING || displayRoomStatus === ROOM_STATES.CONNECTED) && (
          <motion.div 
            className="transfer-progress-section"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
          >
            <TransferProgress stats={fileTransfer.stats} />
            <TransferStats stats={fileTransfer.stats} connectionType={webrtc.connectionType} />

            <motion.div 
              className="transfer-controls"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.3 }}
            >
              <AnimatePresence mode="wait">
                {isSender && fileTransfer.transferState === 'sending' && (
                  <motion.button
                    key="pause"
                    className="btn btn-secondary"
                    onClick={handlePause}
                    id="pause-btn"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <Pause size={18} className="mr-2" />
                    Pause
                  </motion.button>
                )}
                {fileTransfer.transferState === 'paused' && (
                  <motion.button
                    key="resume"
                    className="btn btn-primary"
                    onClick={handleResume}
                    id="resume-btn"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    whileHover={{ scale: 1.05, boxShadow: '0 0 30px rgba(0, 243, 255, 0.5)' }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <Play size={18} className="mr-2" />
                    Resume
                  </motion.button>
                )}
              </AnimatePresence>
              <motion.button 
                className="btn btn-danger" 
                onClick={handleCancel} 
                id="cancel-btn"
                whileHover={{ scale: 1.05, boxShadow: '0 0 30px rgba(248, 113, 113, 0.3)' }}
                whileTap={{ scale: 0.95 }}
              >
                <XCircle size={18} className="mr-2" />
                Cancel
              </motion.button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {displayRoomStatus === ROOM_STATES.COMPLETED && (
          <motion.div 
            className="transfer-complete"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.5, ease: [0.4, 0, 0.2, 1] }}
          >
            <motion.div 
              className="transfer-complete-icon"
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ delay: 0.2, duration: 0.5, type: 'spring' }}
            >
              <CheckCircle size={64} className="text-green-400" />
            </motion.div>
            <motion.div 
              className="transfer-complete-title"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.4 }}
            >
              Transfer Complete!
            </motion.div>
            <motion.div 
              className="transfer-complete-subtitle"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.4 }}
            >
              {isSender
                ? `${manifest?.totalFiles || 1} file${(manifest?.totalFiles || 1) !== 1 ? 's' : ''} sent successfully.`
                : `${fileTransfer.receivedFiles.length} file${fileTransfer.receivedFiles.length !== 1 ? 's' : ''} received successfully.`}
            </motion.div>

            <AnimatePresence>
              {!isSender && fileTransfer.receivedFiles.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5, duration: 0.4 }}
                >
                  <FilePreview
                    blob={fileTransfer.receivedFiles[fileTransfer.receivedFiles.length - 1].blob}
                    name={fileTransfer.receivedFiles[fileTransfer.receivedFiles.length - 1].name}
                    type={fileTransfer.receivedFiles[fileTransfer.receivedFiles.length - 1].type}
                  />
                  <motion.div 
                    className="transfer-download-actions"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.6, duration: 0.3 }}
                  >
                    <AnimatePresence mode="wait">
                      {fileTransfer.receivedFiles.length === 1 ? (
                        <motion.button
                          key="single"
                          className="btn btn-primary btn-lg"
                          onClick={() => fileTransfer.download(0)}
                          id="download-btn"
                          whileHover={{ scale: 1.05, boxShadow: '0 0 40px rgba(0, 243, 255, 0.5)' }}
                          whileTap={{ scale: 0.95 }}
                        >
                          <Download size={20} className="mr-2" />
                          Download File
                        </motion.button>
                      ) : (
                        <motion.button
                          key="all"
                          ref={downloadButtonRef}
                          className="btn btn-primary btn-lg"
                          onClick={() => setShowDownloadModal(true)}
                          id="download-all-btn"
                          whileHover={{ scale: 1.05, boxShadow: '0 0 40px rgba(0, 243, 255, 0.5)' }}
                          whileTap={{ scale: 0.95 }}
                        >
                          <Download size={20} className="mr-2" />
                          Download All ({fileTransfer.receivedFiles.length} files)
                        </motion.button>
                      )}
                    </AnimatePresence>
                  </motion.div>

                  <AnimatePresence>
                    {fileTransfer.receivedFiles.length > 1 && (
                      <motion.div 
                        className="transfer-received-list"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.7, duration: 0.3 }}
                      >
                        {fileTransfer.receivedFiles.map((file, i) => (
                          <motion.div 
                            className="transfer-received-item" 
                            key={`${file.name}-${i}`}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.7 + (i * 0.05), duration: 0.25 }}
                          >
                            <span className="transfer-received-icon">{getFileIcon(file.type, file.name)}</span>
                            <div className="transfer-received-info">
                              <div className="transfer-received-name">{file.name}</div>
                              <div className="transfer-received-meta">{formatFileSize(file.size)}</div>
                            </div>
                            <motion.button
                              className="btn btn-secondary btn-sm"
                              onClick={() => fileTransfer.download(i)}
                              whileHover={{ scale: 1.1 }}
                              whileTap={{ scale: 0.9 }}
                            >
                              <Download size={16} />
                            </motion.button>
                          </motion.div>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8, duration: 0.3 }}
            >
              <TransferStats stats={fileTransfer.stats} connectionType={webrtc.connectionType} />
            </motion.div>

            <motion.div 
              style={{ marginTop: 'var(--space-6)' }}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.9, duration: 0.3 }}
            >
              <Link to="/" className="btn btn-secondary" id="back-home-btn">
                <ArrowLeft size={18} className="mr-2" />
                Back to Home
              </Link>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {(displayRoomStatus === ROOM_STATES.FAILED || displayRoomStatus === ROOM_STATES.CANCELLED) && (
          <motion.div 
            className="transfer-failed"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.4 }}
          >
            <motion.div 
              className="transfer-failed-icon"
              initial={{ scale: 0, rotate: -180 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ duration: 0.5, type: 'spring' }}
            >
              {displayRoomStatus === ROOM_STATES.CANCELLED ? (
                <XCircle size={64} className="text-gray-400" />
              ) : (
                <AlertCircle size={64} className="text-red-400" />
              )}
            </motion.div>
            <motion.div 
              className="transfer-failed-title"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.4 }}
            >
              {displayRoomStatus === ROOM_STATES.CANCELLED ? 'Transfer Cancelled' : 'Transfer Failed'}
            </motion.div>
            <motion.div 
              className="transfer-failed-message"
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.4 }}
            >
              {error || 'Something went wrong during the transfer.'}
            </motion.div>
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.4 }}
            >
              <Link to="/" className="btn btn-secondary" id="back-home-error-btn">
                <ArrowLeft size={18} className="mr-2" />
                Back to Home
              </Link>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <DownloadOptionsModal
        isOpen={showDownloadModal}
        onClose={() => setShowDownloadModal(false)}
        onDownloadZip={async () => {
          try {
            await fileTransfer.downloadAsZip();
            setShowDownloadModal(false);
          } catch (err) {
            console.error('ZIP download failed:', err);
            setError('Failed to create ZIP file');
          }
        }}
        onDownloadIndividual={() => {
          fileTransfer.downloadAll();
          setShowDownloadModal(false);
        }}
        fileCount={fileTransfer.receivedFiles.length}
        buttonRef={downloadButtonRef}
      />
    </motion.div>
  );
}
