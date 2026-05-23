import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FileDropZone } from '../components/FileDropZone';
import { RoomCodeDisplay } from '../components/RoomCodeDisplay';
import { StatusIndicator } from '../components/StatusIndicator';
import { ReceiverList } from '../components/ReceiverList';
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
    <div className="create-room-page">
      <div className="page-header">
        <Link to="/" className="page-back">← Back to home</Link>
        <h1 className="page-title">Send Files</h1>
        <p className="page-subtitle">
          {roomCode
            ? 'Share your room code or QR. Multiple receivers can join — approve each one to start sending.'
            : 'Select files, create a room, and share the code with your recipients.'}
        </p>
      </div>

      {roomStatus && (
        <StatusIndicator
          status={activeCount > 0 ? ROOM_STATES.RECEIVER_JOINED : roomStatus}
        />
      )}

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

          <div className="create-section">
            <div className="create-section-label">
              Files to send · {manifest.totalFiles} file{manifest.totalFiles !== 1 ? 's' : ''} · {formatFileSize(manifest.totalSize)}
            </div>
            <div className="sender-file-summary">
              {files.map((f, i) => (
                <div key={`${f.name}-${i}`} className="sender-file-row">
                  <span className="sender-file-name">{f.name}</span>
                  <span className="sender-file-size">{formatFileSize(f.size)}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="create-section">
            <div className="create-section-label">
              Receivers {peers.length > 0 && `(${peers.length})`}
            </div>
            <ReceiverList
              peers={peers}
              onApprove={handleApprove}
              onReject={handleReject}
              onCancel={handleCancel}
            />
          </div>
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
