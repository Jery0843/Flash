import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Lock, Unlock, Zap, FileText, Users, Shield } from 'lucide-react';
import { FileDropZone } from '../components/FileDropZone';
import { RoomCodeDisplay } from '../components/RoomCodeDisplay';
import { StatusIndicator } from '../components/StatusIndicator';
import { ReceiverList } from '../components/ReceiverList';
import { SEO } from '../components/SEO';
import { useSignaling } from '../hooks/useSignaling';
import { MSG, ROOM_STATES, CHUNK_SIZE, formatFileSize } from '../lib/constants';
import { sanitizePassword } from '../lib/sanitize';
import { MultiPeerSender } from '../lib/multiPeerSender';
import './CreateRoom.css';

export function CreateRoom() {
  const signaling = useSignaling();
  const [files, setFiles] = useState([]);
  const [roomCode, setRoomCode] = useState(null);
  const [roomStatus, setRoomStatus] = useState(null);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [peers, setPeers] = useState([]);

  const senderRef = useRef(null);
  const filesRef = useRef(files);
  useEffect(() => { filesRef.current = files; }, [files]);

  const signalingRef = useRef(signaling);
  useEffect(() => { signalingRef.current = signaling; }, [signaling]);

  // Handle incoming files from PWA share target or file handlers
  useEffect(() => {
    const handleMessage = (event) => {
      if (event.data && event.data.type === 'SHARE_TARGET_FILES') {
        console.log('[CreateRoom] Received shared files:', event.data.files);
        const sharedFiles = event.data.files;
        if (sharedFiles && sharedFiles.length > 0) {
          setFiles(prev => [...prev, ...sharedFiles]);
          // Acknowledge receipt if needed
        }
      }
    };

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleMessage);
    }

    // Also check for Launch Queue (Chrome 102+)
    if ('launchQueue' in window) {
      window.launchQueue.setConsumer(async (launchParams) => {
        if (!launchParams.files.length) return;
        
        const fileEntries = await Promise.all(
          launchParams.files.map(handle => handle.getFile())
        );
        setFiles(prev => [...prev, ...fileEntries]);
      });
    }

    return () => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleMessage);
      }
    };
  }, []);

  const manifest = useMemo(() => ({
    files: files.map((f) => ({
      name: f.name,
      size: f.size,
      type: f.type || 'application/octet-stream',
      totalChunks: Math.ceil(f.size / CHUNK_SIZE),
    })),
    totalFiles: files.length,
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
  }), [files]);

  // Listen for signaling lifecycle events (room creation / errors only).
  // Per-peer events are owned by MultiPeerSender.
  useEffect(() => {
    if (!signaling.client) return;

    const offCreated = signaling.on(MSG.ROOM_CREATED, (data) => {
      setRoomCode(data.roomCode);
      setRoomStatus(ROOM_STATES.WAITING);
      setCreating(false);
    });

    const offRoomError = signaling.on(MSG.ROOM_ERROR, (data) => {
      setError(data.message || 'Room error');
      setCreating(false);
    });

    return () => {
      offCreated?.();
      offRoomError?.();
    };
  }, [signaling.client]);

  // When the room is created, spin up the multi-peer sender.
  // NOTE: we intentionally do NOT put `signaling` in deps because
  // useSignaling returns a new object on every render, which would
  // close and recreate the sender on every re-render.
  useEffect(() => {
    if (!roomCode) return;

    const sender = new MultiPeerSender({
      signaling: signalingRef.current,
      files: filesRef.current,
      manifest,
      onChange: (snapshot) => setPeers(snapshot),
    });
    senderRef.current = sender;

    return () => {
      sender.closeAll();
      senderRef.current = null;
    };
  }, [roomCode, manifest]);

  // Tear down signaling on unmount.
  useEffect(() => {
    return () => {
      senderRef.current?.closeAll();
      senderRef.current = null;
      signalingRef.current?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const createRoom = useCallback(async () => {
    if (files.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      await signaling.connect({
        action: 'create',
        password: usePassword ? sanitizePassword(password) : undefined,
      });
    } catch (err) {
      setError(err.message || 'Failed to connect');
      setCreating(false);
    }
  }, [files, signaling, usePassword, password]);

  const handleApprove = useCallback((peerId) => {
    senderRef.current?.approve(peerId);
  }, []);

  const handleReject = useCallback((peerId) => {
    senderRef.current?.reject(peerId);
  }, []);

  const handleCancel = useCallback((peerId) => {
    senderRef.current?.cancel(peerId);
  }, []);

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  const activeCount = peers.filter(
    (p) => p.status === 'pending-approval' ||
           p.status === 'connecting' ||
           p.status === 'transferring',
  ).length;

  return (
    <motion.div 
      className="create-room-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <SEO 
        title="Send Files" 
        description="Select files, create a secure room, and share the code to start a fast P2P transfer."
        url="/create"
        breadcrumbs={[
          { name: 'Home', path: '/' },
          { name: 'Send', path: '/create' }
        ]}
      />
      <motion.div 
        className="page-header"
        initial={{ y: -20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
      >
        <Link to="/" className="page-back">
          <motion.div 
            className="back-button"
            whileHover={{ x: -4 }}
            whileTap={{ x: 0 }}
          >
            <ArrowLeft size={20} />
            <span>Back to home</span>
          </motion.div>
        </Link>
        <h1 className="page-title">
          Send Files
        </h1>
        <p className="page-subtitle">
          {roomCode
            ? 'Share your room code or QR. Multiple receivers can join — approve each one to start sending.'
            : 'Select files, create a room, and share the code with your recipients.'}
        </p>
      </motion.div>

      <AnimatePresence>
        {roomStatus && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
          >
            <StatusIndicator
              status={activeCount > 0 ? ROOM_STATES.RECEIVER_JOINED : roomStatus}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {!roomCode ? (
          <motion.div
            key="setup"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
          >
            <motion.div 
              className="create-section"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1, duration: 0.3 }}
            >
              <div className="create-section-label">
                <FileText size={18} className="inline mr-2" />
                Select files
              </div>
              <FileDropZone onFilesSelect={setFiles} selectedFiles={files} disabled={creating} />
            </motion.div>

            <motion.div 
              className="password-section"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.3 }}
            >
              <label className="password-toggle">
                <motion.input
                  type="checkbox"
                  checked={usePassword}
                  onChange={(e) => setUsePassword(e.target.checked)}
                  disabled={creating}
                  className="password-checkbox"
                  whileTap={{ scale: 0.9 }}
                />
                <motion.span 
                  className="password-text"
                  animate={{ color: usePassword ? 'var(--accent-primary)' : 'var(--text-secondary)' }}
                  transition={{ duration: 0.2 }}
                >
                  {usePassword ? <Lock size={16} className="inline mr-2" /> : <Unlock size={16} className="inline mr-2" />}
                  Add room password (optional)
                </motion.span>
              </label>
              <AnimatePresence>
                {usePassword && (
                  <motion.input
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.3 }}
                    className="input-field"
                    type="password"
                    placeholder="Enter a room password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    maxLength={128}
                    disabled={creating}
                    id="room-password-input"
                  />
                )}
              </AnimatePresence>
            </motion.div>

            <motion.div 
              className="create-action"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3, duration: 0.3 }}
            >
              <motion.button
                className="btn btn-primary btn-lg"
                onClick={createRoom}
                disabled={files.length === 0 || creating}
                id="create-room-btn"
                whileHover={{ scale: 1.02, boxShadow: '0 0 40px rgba(0, 243, 255, 0.5)' }}
                whileTap={{ scale: 0.98 }}
                animate={creating ? { scale: [1, 0.98, 1] } : {}}
                transition={creating ? { duration: 1, repeat: Infinity } : {}}
              >
                {creating ? (
                  <>
                    <motion.div 
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                      style={{ display: 'inline-block', marginRight: '8px' }}
                    >
                      <Zap size={20} />
                    </motion.div>
                    Creating...
                  </>
                ) : (
                  <>
                    <Zap size={20} className="mr-2" />
                    Create Room{files.length > 0 && ` (${files.length} file${files.length !== 1 ? 's' : ''} · ${formatFileSize(totalSize)})`}
                  </>
                )}
              </motion.button>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence mode="wait">
        {roomCode && (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
          >
            <motion.div 
              className="create-section" 
              style={{ marginTop: 'var(--space-6)' }}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.1, duration: 0.3 }}
            >
              <RoomCodeDisplay roomCode={roomCode} />
            </motion.div>

            <motion.div 
              className="create-section"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2, duration: 0.3 }}
            >
              <div className="create-section-label">
                <FileText size={18} className="inline mr-2" />
                Files to send · {manifest.totalFiles} file{manifest.totalFiles !== 1 ? 's' : ''} · {formatFileSize(manifest.totalSize)}
              </div>
              <motion.div 
                className="sender-file-summary"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3, duration: 0.3 }}
              >
                {files.map((f, i) => (
                  <motion.div 
                    key={`${f.name}-${i}`} 
                    className="sender-file-row"
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.3 + (i * 0.05), duration: 0.25 }}
                  >
                    <span className="sender-file-name">{f.name}</span>
                    <span className="sender-file-size">{formatFileSize(f.size)}</span>
                  </motion.div>
                ))}
              </motion.div>
            </motion.div>

            <motion.div 
              className="create-section"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4, duration: 0.3 }}
            >
              <div className="create-section-label">
                <Users size={18} className="inline mr-2" />
                Receivers {peers.length > 0 && (
                  <motion.span 
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    className="receiver-count"
                  >
                    ({peers.length})
                  </motion.span>
                )}
              </div>
              <ReceiverList
                peers={peers}
                onApprove={handleApprove}
                onReject={handleReject}
                onCancel={handleCancel}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="error-message"
          >
            <Shield size={16} className="inline mr-2" />
            {error}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
