import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileDropZone } from '../components/FileDropZone';
import { RoomCodeDisplay } from '../components/RoomCodeDisplay';
import { StatusIndicator } from '../components/StatusIndicator';
import { useSignaling } from '../hooks/useSignaling';
import { MSG, ROOM_STATES, CHUNK_SIZE, formatFileSize } from '../lib/constants';
import { sanitizePassword } from '../lib/sanitize';
import './CreateRoom.css';

export function CreateRoom() {
  const navigate = useNavigate();
  const signaling = useSignaling();
  const [files, setFiles] = useState([]);
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
        // Send file manifest to receiver
        if (files.length > 0) {
          const manifest = {
            files: files.map((f) => ({
              name: f.name,
              size: f.size,
              type: f.type || 'application/octet-stream',
              totalChunks: Math.ceil(f.size / CHUNK_SIZE),
            })),
            totalFiles: files.length,
            totalSize: files.reduce((sum, f) => sum + f.size, 0),
          };
          signaling.send(MSG.FILE_METADATA, manifest);
        }
      }),
      signaling.on(MSG.TRANSFER_ACCEPT, () => {
        // Navigate to transfer room
        navigate(`/room/${roomCode}`, {
          state: { role: 'sender', files, roomCode },
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
  }, [signaling.client, files, roomCode, roomStatus, navigate]);

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

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return (
    <div className="create-room-page">
      <div className="page-header">
        <Link to="/" className="page-back">← Back to home</Link>
        <h1 className="page-title">Send Files</h1>
        <p className="page-subtitle">
          Select files, create a room, and share the code with your recipient.
        </p>
      </div>

      {roomStatus && <StatusIndicator status={roomStatus} />}

      {!roomCode && (
        <>
          <div className="create-section">
            <div className="create-section-label">Select files</div>
            <FileDropZone onFilesSelect={setFiles} selectedFiles={files} disabled={creating} />
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
              disabled={files.length === 0 || creating}
              id="create-room-btn"
            >
              {creating
                ? '⏳ Creating...'
                : `⚡ Create Room${files.length > 0 ? ` (${files.length} file${files.length !== 1 ? 's' : ''} · ${formatFileSize(totalSize)})` : ''}`}
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
