import { useState, useCallback, useRef } from 'react';
import { FileSender, FileReceiver, createTransport, downloadBlob } from '../lib/fileTransfer';
import { sanitizeFilename } from '../lib/sanitize';

export function useFileTransfer() {
  const senderRef = useRef(null);
  const receiverRef = useRef(null);
  const [transferState, setTransferState] = useState('idle'); // idle | sending | receiving | paused | completed | failed
  const [stats, setStats] = useState(null);
  const [receivedFile, setReceivedFile] = useState(null);

  // ── Sender ──────────────────────────────────────────────

  const startSending = useCallback((file, dataChannel) => {
    const transport = createTransport(dataChannel);
    const sender = new FileSender(file, transport);
    senderRef.current = sender;

    sender.onProgress = (s) => {
      setStats({ ...s });
    };

    sender.onComplete = (s) => {
      setStats({ ...s });
      setTransferState('completed');
    };

    sender.onError = (err) => {
      console.error('[FileTransfer] Send error:', err);
      setTransferState('failed');
    };

    setTransferState('sending');
    sender.start();
  }, []);

  // ── Receiver ────────────────────────────────────────────

  const startReceiving = useCallback((metadata, dataChannel) => {
    const receiver = new FileReceiver(metadata);
    receiverRef.current = receiver;

    receiver.onProgress = (s) => {
      setStats({ ...s });
    };

    receiver.onComplete = ({ blob, metadata: meta, stats: s }) => {
      const safeName = sanitizeFilename(meta.name);
      setReceivedFile({ blob, name: safeName, type: meta.type, size: meta.size });
      setStats({ ...s });
      setTransferState('completed');
    };

    receiver.onError = (err) => {
      console.error('[FileTransfer] Receive error:', err);
      setTransferState('failed');
    };

    setTransferState('receiving');

    // Wire up data channel messages to receiver
    dataChannel.onmessage = (event) => {
      receiver.handleChunk(event.data);
    };
  }, []);

  // ── Controls ────────────────────────────────────────────

  const pause = useCallback(() => {
    senderRef.current?.pause();
    setTransferState('paused');
  }, []);

  const resume = useCallback(() => {
    senderRef.current?.resume();
    setTransferState('sending');
  }, []);

  const cancel = useCallback(() => {
    senderRef.current?.cancel();
    receiverRef.current?.cancel();
    setTransferState('failed');
  }, []);

  const download = useCallback(() => {
    if (receivedFile) {
      downloadBlob(receivedFile.blob, receivedFile.name);
    }
  }, [receivedFile]);

  const reset = useCallback(() => {
    senderRef.current = null;
    receiverRef.current = null;
    setTransferState('idle');
    setStats(null);
    setReceivedFile(null);
  }, []);

  return {
    transferState,
    stats,
    receivedFile,
    startSending,
    startReceiving,
    pause,
    resume,
    cancel,
    download,
    reset,
  };
}
