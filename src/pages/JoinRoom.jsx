import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, Download, Lock, Clock, Loader2, AlertCircle, Key } from 'lucide-react';
import { useSignaling } from '../hooks/useSignaling';
import { ApprovalModal } from '../components/ApprovalModal';
import { StatusIndicator } from '../components/StatusIndicator';
import { SEO } from '../components/SEO';
import { MSG, ROOM_STATES } from '../lib/constants';
import { validateRoomCode, sanitizePassword, validateFileMetadata, validateFileManifest } from '../lib/sanitize';
import './JoinRoom.css';

export function JoinRoom() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const signaling = useSignaling();

  const [code, setCode] = useState(searchParams.get('code')?.toUpperCase() || '');
  const [password, setPassword] = useState('');
  const [needsPassword, setNeedsPassword] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState(null);
  const [fileMetadata, setFileMetadata] = useState(null);
  const [roomStatus, setRoomStatus] = useState(null);
  const [peerId, setPeerId] = useState(null);

  // Listen for signaling events
  useEffect(() => {
    if (!signaling.client) return;

    const cleanups = [
      signaling.on(MSG.ROOM_JOINED, (data) => {
        setPeerId(data.peerId);
        setRoomStatus(ROOM_STATES.RECEIVER_JOINED);
        setJoining(false);
      }),
      signaling.on(MSG.FILE_METADATA, (data) => {
        // Support both manifest ({files: [...]}) and legacy single-file
        if (data.files && Array.isArray(data.files)) {
          const validation = validateFileManifest(data);
          if (validation.valid) {
            setFileMetadata(data);
          } else {
            setError(`Invalid files: ${validation.error}`);
          }
        } else {
          const validation = validateFileMetadata(data);
          if (validation.valid) {
            // Wrap legacy single-file into manifest format
            setFileMetadata({
              files: [data],
              totalFiles: 1,
              totalSize: data.size,
            });
          } else {
            setError(`Invalid file: ${validation.error}`);
          }
        }
      }),
      signaling.on(MSG.ROOM_ERROR, (data) => {
        if (data.message?.includes('password')) {
          setNeedsPassword(true);
        }
        setError(data.message || 'Could not join room');
        setJoining(false);
      }),
      signaling.on(MSG.TRANSFER_CANCEL, () => {
        // Sender rejected this receiver before transfer began (or cancelled).
        setError('The sender declined or cancelled your request.');
        setFileMetadata(null);
        setRoomStatus(null);
        signaling.disconnect();
      }),
      signaling.on('disconnected', () => {
        if (roomStatus && roomStatus !== ROOM_STATES.COMPLETED) {
          setError('Connection to server lost');
        }
      }),
    ];

    return () => cleanups.forEach(fn => fn?.());
  }, [signaling.client, roomStatus]);

  const joinRoom = useCallback(async () => {
    const cleanCode = code.toUpperCase().trim();
    if (!validateRoomCode(cleanCode)) {
      setError('Enter a valid 8-character room code');
      return;
    }
    setJoining(true);
    setError(null);
    try {
      await signaling.connect({
        action: 'join',
        code: cleanCode,
        password: password ? sanitizePassword(password) : undefined,
      });
      // Server responds with MSG.ROOM_JOINED or error upon connect
    } catch (err) {
      setError(err.message || 'Failed to connect');
      setJoining(false);
    }
  }, [code, password, signaling]);

  const handleAccept = useCallback(() => {
    const roomCode = code.toUpperCase().trim();
    const sendAccept = () => signaling.send(MSG.TRANSFER_ACCEPT);

    sendAccept();
    setTimeout(sendAccept, 200);
    setTimeout(sendAccept, 800);

    navigate(`/room/${roomCode}`, {
      state: { role: 'receiver', roomCode, fileMetadata, peerId },
    });
  }, [signaling, code, fileMetadata, peerId, navigate]);

  const handleReject = useCallback(() => {
    signaling.send(MSG.TRANSFER_REJECT);
    setFileMetadata(null);
    setRoomStatus(null);
    signaling.disconnect();
  }, [signaling]);

  const handleCodeChange = (e) => {
    const val = e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 8);
    setCode(val);
    setError(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && code.length === 8) {
      joinRoom();
    }
  };

  return (
    <motion.div 
      className="join-room-page"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <SEO 
        title="Receive Files" 
        description="Enter a room code to securely receive files directly from the sender."
        url="/join"
        breadcrumbs={[
          { name: 'Home', path: '/' },
          { name: 'Receive', path: '/join' }
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
          Receive Files
        </h1>
        <p className="page-subtitle">
          Enter the room code shared by the sender to receive files.
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
            <StatusIndicator status={roomStatus} />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div 
        className="join-code-section"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1, duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
      >
        <div className="join-code-input-wrapper">
          <motion.input
            className="join-code-input"
            type="text"
            value={code}
            onChange={handleCodeChange}
            onKeyDown={handleKeyDown}
            placeholder="ABCD1234"
            maxLength={8}
            autoFocus
            disabled={joining || roomStatus === ROOM_STATES.RECEIVER_JOINED}
            id="join-code-input"
            whileFocus={{ scale: 1.02, boxShadow: '0 0 30px rgba(0, 243, 255, 0.5)' }}
            transition={{ duration: 0.2 }}
          />
        </div>

        <AnimatePresence>
          {needsPassword && (
            <motion.div 
              className="join-password-section"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.3 }}
            >
              <div className="join-password-label">
                <Key size={16} className="inline mr-2" />
                This room requires a password
              </div>
              <motion.input
                className="input-field"
                type="password"
                placeholder="Enter room password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={128}
                disabled={joining}
                id="join-password-input"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.1 }}
                whileFocus={{ boxShadow: '0 0 30px rgba(0, 243, 255, 0.5)' }}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <motion.div 
          className="join-action"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.3 }}
        >
          <motion.button
            className="btn btn-primary btn-lg"
            onClick={joinRoom}
            disabled={code.length !== 8 || joining || roomStatus === ROOM_STATES.RECEIVER_JOINED}
            id="join-room-btn"
            whileHover={{ scale: 1.02, boxShadow: '0 0 40px rgba(0, 243, 255, 0.5)' }}
            whileTap={{ scale: 0.98 }}
            animate={joining ? { scale: [1, 0.98, 1] } : {}}
            transition={joining ? { duration: 1, repeat: Infinity } : {}}
          >
            {joining ? (
              <>
                <motion.div 
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                  style={{ display: 'inline-block', marginRight: '8px' }}
                >
                  <Loader2 size={20} />
                </motion.div>
                Joining...
              </>
            ) : (
              <>
                <Download size={20} className="mr-2" />
                Join Room
              </>
            )}
          </motion.button>
        </motion.div>

        <AnimatePresence>
          {error && (
            <motion.div
              className="join-error"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
            >
              <AlertCircle size={16} className="inline mr-2" />
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {roomStatus === ROOM_STATES.RECEIVER_JOINED && !fileMetadata && !error && (
            <motion.div 
              className="join-waiting"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.4 }}
            >
              <motion.div 
                className="join-waiting-spinner"
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
              >
                <Clock size={48} className="text-cyan-400" />
              </motion.div>
              <motion.div 
                className="join-waiting-text"
                animate={{ 
                  opacity: [0.6, 1, 0.6],
                  y: [0, -5, 0]
                }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                Connected to room. Waiting for the sender to approve your request…
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {fileMetadata && (
          <ApprovalModal
            fileMetadata={fileMetadata}
            onAccept={handleAccept}
            onReject={handleReject}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
