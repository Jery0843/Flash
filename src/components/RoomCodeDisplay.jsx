import { useState, useEffect, useRef, useCallback } from 'react';
import QRCode from 'qrcode';
import './RoomCodeDisplay.css';

export function RoomCodeDisplay({ roomCode }) {
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef(null);
  const joinUrl = `${window.location.origin}/join?code=${roomCode}`;

  useEffect(() => {
    if (canvasRef.current && roomCode) {
      QRCode.toCanvas(canvasRef.current, joinUrl, {
        width: 180,
        margin: 2,
        color: {
          dark: '#0a0f1c',
          light: '#ffffff',
        },
        errorCorrectionLevel: 'M',
      });
    }
  }, [roomCode, joinUrl]);

  const copyCode = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(roomCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const input = document.createElement('input');
      input.value = roomCode;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [roomCode]);

  const copyLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* silent */ }
  }, [joinUrl]);

  return (
    <div className="room-code-display" id="room-code-display">
      <div className="room-code-label">Share this code with the receiver</div>
      <div className="room-code-value">
        <span>{roomCode}</span>
        <span className="room-code-copy" onClick={copyCode} title="Copy code">
          {copied ? '✅' : '📋'}
        </span>
      </div>
      <div className="room-code-copied">
        {copied ? 'Copied!' : ''}
      </div>

      <div className="room-code-qr">
        <canvas ref={canvasRef} />
        <span className="room-code-qr-label">Scan QR code to join</span>
      </div>

      <div className="room-code-link">
        <input
          className="room-code-link-input input-field"
          value={joinUrl}
          readOnly
          onClick={(e) => e.target.select()}
        />
        <button className="btn btn-secondary" onClick={copyLink} title="Copy link">
          🔗
        </button>
      </div>
    </div>
  );
}
