import { useState, useCallback, useRef } from 'react';
import JSZip from 'jszip';
import { FileSender, FileReceiver, createTransport, downloadBlob } from '../lib/fileTransfer';
import { sanitizeFilename } from '../lib/sanitize';

export function useFileTransfer() {
  const senderRef = useRef(null);
  const receiverRef = useRef(null);
  const [transferState, setTransferState] = useState('idle'); // idle | sending | receiving | paused | completed | failed
  const [stats, setStats] = useState(null);
  const [receivedFiles, setReceivedFiles] = useState([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);

  // ── Sender ──────────────────────────────────────────────

  const startSending = useCallback((files, dataChannel) => {
    const fileArray = Array.isArray(files) ? files : [files];
    const transport = createTransport(dataChannel);
    const sender = new FileSender(fileArray, transport);
    senderRef.current = sender;

    sender.onFileStart = (index) => {
      setCurrentFileIndex(index);
    };

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

  const startReceiving = useCallback((manifest, dataChannel) => {
    const receiver = new FileReceiver(manifest);
    receiverRef.current = receiver;

    receiver.onProgress = (s) => {
      setStats({ ...s });
      if (s.currentFileIndex !== undefined) {
        setCurrentFileIndex(s.currentFileIndex);
      }
    };

    receiver.onFileComplete = (index, fileResult) => {
      const safeName = sanitizeFilename(fileResult.name);
      setReceivedFiles((prev) => [
        ...prev,
        { ...fileResult, name: safeName },
      ]);
    };

    receiver.onComplete = ({ stats: s }) => {
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
      receiver.handleMessage(event.data);
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

  const download = useCallback((index) => {
    const file = receivedFiles[index ?? 0];
    if (file) {
      downloadBlob(file.blob, file.name);
    }
  }, [receivedFiles]);

  const downloadAll = useCallback(() => {
    // Download files with delay to prevent browser blocking
    receivedFiles.forEach((file, index) => {
      setTimeout(() => {
        downloadBlob(file.blob, file.name);
      }, index * 500); // 500ms delay between each download
    });
  }, [receivedFiles]);

  const downloadAsZip = useCallback(async () => {
    try {
      const zip = new JSZip();
      
      // Add all files to the zip
      receivedFiles.forEach((file) => {
        zip.file(file.name, file.blob);
      });
      
      // Generate the zip file
      const content = await zip.generateAsync({ type: 'blob' });
      
      // Download the zip
      const timestamp = new Date().toISOString().slice(0, 10);
      downloadBlob(content, `flash-files-${timestamp}.zip`);
    } catch (err) {
      console.error('[FileTransfer] ZIP creation failed:', err);
      throw err;
    }
  }, [receivedFiles]);

  const reset = useCallback(() => {
    senderRef.current = null;
    receiverRef.current = null;
    setTransferState('idle');
    setStats(null);
    setReceivedFiles([]);
    setCurrentFileIndex(0);
  }, []);

  return {
    transferState,
    stats,
    receivedFiles,
    currentFileIndex,
    startSending,
    startReceiving,
    pause,
    resume,
    cancel,
    download,
    downloadAll,
    downloadAsZip,
    reset,
  };
}
