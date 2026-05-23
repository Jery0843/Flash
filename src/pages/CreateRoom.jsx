import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileDropZone } from '../components/FileDropZone';
import { RoomCodeDisplay } from '../components/RoomCodeDisplay';
import { StatusIndicator } from '../components/StatusIndicator';
import { useSignaling } from '../hooks/useSignaling';
import { MSG, ROOM_STATES } from '../lib/constants';
import { sanitizePassword } from '../lib/sanitize';
import './CreateRoom.css';

export function CreateRoom() {
  const navigate = useNavigate();
  const signaling = useSignaling();
  const [file, setFile] = useState(null);
  const [roomCode, setRoomCode] = useState(null);
  const [roomStatus, setRoomStatus] = useState(null);
  const [usePassword, setUsePassword] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);

  // Listen for signaling events
  useEffect(() => {
    if (!signaling.client) return;

    const cleanups = [
      signaling.on(MSG.ROOM_CREATED, (data) => {
        setRoomCode(data.roomCode);
        setRoomStatus(ROOM_STATES.WAITING);
        setCreating(false);
      }),
      signaling.on(MSG.RECEIVER_JOINED, () => {
        setRoomStatus(ROOM_STATES.RECEIVER_JOINED);
        // Send file metadata to receiver
        if (file) {
          signaling.send(MSG.FILE_METADATA, {
            name: file.name,
            size: file.size,
            type: file.type || 'application/octet-stream',
            totalChunks: Math.ceil(file.size / 65536),
          });
        }
      }),
      signaling.on(MSG.TRANSFER_ACCEPT, () => {
        // Navigate to transfer room
        navigate(`/room/${roomCode}`, {
          state: { role: 'sender', file, roomCode },
        });
      }),
      signaling.on(MSG.TRANSFER_REJECT, () => {
        setRoomStatus(ROOM_STATES.FAILED);
        setError('Receiver rejected the transfer');
      }),
      signaling.on(MSG.ROOM_ERROR, (data) => {
        setError(data.message || 'Room error');
        setCreating(false);
      }),
      signaling.on('disconnected', () => {
        if (roomStatus && roomStatus !== ROOM_STATES.COMPLETED) {
          setError('Connection to server lost');
        }
      }),
    ];

    return () => cleanups.forEach(fn => fn?.());
  }, [signaling.client, file, roomCode, roomStatus, navigate]);

  const createRoom = useCallback(async () => {
    if (!file) return;
    setCreating(true);
    setError(null);
    try {
      await signaling.connect({
        action: 'create',
        password: usePassword ? sanitizePassword(password) : undefined,
      });
      // Do not send MSG.CREATE_ROOM via JSON, the server handles it on connect via URL params.
    } catch (err) {
      setError(err.message || 'Failed to connect');
      setCreating(false);
    }
  }, [file, signaling, usePassword, password]);

  return (
    <div className="create-room-page">
      <div className="page-header">
        <Link to="/" className="page-back">← Back to home</Link>
        <h1 className="page-title">Send a File</h1>
        <p className="page-subtitle">
          Select a file, create a room, and share the code with your recipient.
        </p>
      </div>

      {roomStatus && <StatusIndicator status={roomStatus} />}

      {!roomCode && (
        <>
          <div className="create-section">
            <div className="create-section-label">Select file</div>
            <FileDropZone onFileSelect={setFile} selectedFile={file} disabled={creating} />
          </div>

          <div className="password-section">
            <label className="password-toggle">
              <input
                type="checkbox"
                checked={usePassword}
                onChange={(e) => setUsePassword(e.target.checked)}
                disabled={creating}
              />
              <span>Add room password (optional)</span>
            </label>
            {usePassword && (
              <input
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
          </div>

          <div className="create-action">
            <button
              className="btn btn-primary btn-lg"
              onClick={createRoom}
              disabled={!file || creating}
              id="create-room-btn"
            >
              {creating ? '⏳ Creating...' : '⚡ Create Room'}
            </button>
          </div>
        </>
      )}

      {roomCode && (
        <>
          <div className="create-section" style={{ marginTop: 'var(--space-6)' }}>
            <RoomCodeDisplay roomCode={roomCode} />
          </div>

          {roomStatus === ROOM_STATES.WAITING && (
            <div className="waiting-section">
              <div className="waiting-animation">📡</div>
              <div className="waiting-text">Waiting for receiver to join...</div>
            </div>
          )}

          {roomStatus === ROOM_STATES.RECEIVER_JOINED && (
            <div className="waiting-section">
              <div className="waiting-animation">🤝</div>
              <div className="waiting-text">Receiver joined! Waiting for approval...</div>
            </div>
          )}
        </>
      )}

      {error && (
        <div style={{
          marginTop: 'var(--space-4)',
          padding: 'var(--space-3) var(--space-4)',
          background: 'var(--error-bg)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid rgba(248,113,113,0.2)',
          color: 'var(--error)',
          fontSize: '0.85rem',
        }}>
          {error}
        </div>
      )}
    </div>
  );
}
