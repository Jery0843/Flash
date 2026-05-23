import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useSignaling } from '../hooks/useSignaling';
import { ApprovalModal } from '../components/ApprovalModal';
import { StatusIndicator } from '../components/StatusIndicator';
import { MSG, ROOM_STATES } from '../lib/constants';
import { validateRoomCode, sanitizePassword, validateFileMetadata } from '../lib/sanitize';
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

  // Listen for signaling events
  useEffect(() => {
    if (!signaling.client) return;

    const cleanups = [
      signaling.on(MSG.ROOM_JOINED, () => {
        setRoomStatus(ROOM_STATES.RECEIVER_JOINED);
        setJoining(false);
      }),
      signaling.on(MSG.FILE_METADATA, (data) => {
        const validation = validateFileMetadata(data);
        if (validation.valid) {
          setFileMetadata(data);
        } else {
          setError(`Invalid file: ${validation.error}`);
        }
      }),
      signaling.on(MSG.ROOM_ERROR, (data) => {
        if (data.message?.includes('password')) {
          setNeedsPassword(true);
        }
        setError(data.message || 'Could not join room');
        setJoining(false);
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
      setError('Enter a valid 6-character room code');
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
    signaling.send(MSG.TRANSFER_ACCEPT);
    navigate(`/room/${code.toUpperCase().trim()}`, {
      state: { role: 'receiver', roomCode: code.toUpperCase().trim(), fileMetadata },
    });
  }, [signaling, code, fileMetadata, navigate]);

  const handleReject = useCallback(() => {
    signaling.send(MSG.TRANSFER_REJECT);
    setFileMetadata(null);
    setRoomStatus(null);
    signaling.disconnect();
  }, [signaling]);

  const handleCodeChange = (e) => {
    const val = e.target.value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 6);
    setCode(val);
    setError(null);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && code.length === 6) {
      joinRoom();
    }
  };

  return (
    <div className="join-room-page">
      <div className="page-header">
        <Link to="/" className="page-back">← Back to home</Link>
        <h1 className="page-title">Receive a File</h1>
        <p className="page-subtitle">
          Enter the room code shared by the sender to receive a file.
        </p>
      </div>

      {roomStatus && <StatusIndicator status={roomStatus} />}

      <div className="join-code-section">
        <div className="join-code-input-wrapper">
          <input
            className="join-code-input"
            type="text"
            value={code}
            onChange={handleCodeChange}
            onKeyDown={handleKeyDown}
            placeholder="ABC123"
            maxLength={6}
            autoFocus
            disabled={joining || roomStatus === ROOM_STATES.RECEIVER_JOINED}
            id="join-code-input"
          />
        </div>

        {needsPassword && (
          <div className="join-password-section">
            <div className="join-password-label">This room requires a password</div>
            <input
              className="input-field"
              type="password"
              placeholder="Enter room password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              maxLength={128}
              disabled={joining}
              id="join-password-input"
            />
          </div>
        )}

        <div className="join-action">
          <button
            className="btn btn-primary btn-lg"
            onClick={joinRoom}
            disabled={code.length !== 6 || joining || roomStatus === ROOM_STATES.RECEIVER_JOINED}
            id="join-room-btn"
          >
            {joining ? '⏳ Joining...' : '📥 Join Room'}
          </button>
        </div>

        {error && <div className="join-error">{error}</div>}
      </div>

      {fileMetadata && (
        <ApprovalModal
          fileMetadata={fileMetadata}
          onAccept={handleAccept}
          onReject={handleReject}
        />
      )}
    </div>
  );
}
