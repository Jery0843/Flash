import { useState, useCallback, useRef, useEffect } from 'react';
import JSZip from 'jszip';
import { FileSender, FileReceiver, createTransport, downloadBlob } from '../lib/fileTransfer';
import { sanitizeFilename } from '../lib/sanitize';

export function useFileTransfer() {
  const senderRef = useRef(null);
  const receiverRef = useRef(null);
  const wakeLockRef = useRef(null);
  const [transferState, setTransferState] = useState('idle'); // idle | sending | receiving | paused | completed | failed
  const [stats, setStats] = useState(null);
  const [receivedFiles, setReceivedFiles] = useState([]);
  const [currentFileIndex, setCurrentFileIndex] = useState(0);

  // ── Wake Lock ───────────────────────────────────────────

  const requestWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        console.log('[WakeLock] Active');
      }
    } catch (err) {
      console.warn('[WakeLock] Failed:', err);
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      wakeLockRef.current.release().then(() => {
        wakeLockRef.current = null;
        console.log('[WakeLock] Released');
      });
    }
  }, []);

  // ── Notifications ──────────────────────────────────────

  const requestNotificationPermission = useCallback(async () => {
    if ('Notification' in window && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  }, []);

  const updateNotification = useCallback((s, state) => {
    if ('Notification' in window && Notification.permission === 'granted' && s) {
      const progress = Math.round(s.progress || 0);
      const title = state === 'sending' ? 'Sending files...' : 'Receiving files...';
      const body = `${progress}% - ${s.currentFileName || 'File'}`;
      
      // We use the service worker to show notifications if available
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then((registration) => {
          registration.showNotification(title, {
            body,
            icon: '/logo192.png',
            badge: '/logo192.png',
            tag: 'transfer-progress',
            silent: true,
            renotify: false,
          });
        });
      }
    }
  }, []);

  const clearNotification = useCallback(() => {
    if ('Notification' in window && Notification.permission === 'granted') {
      if (navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then((registration) => {
          registration.getNotifications({ tag: 'transfer-progress' }).then((notifications) => {
            notifications.forEach(n => n.close());
          });
        });
      }
    }
  }, []);

  // ── Lifecycle ──────────────────────────────────────────

  useEffect(() => {
    let keepAliveInterval;
    if (transferState === 'sending' || transferState === 'receiving') {
      requestWakeLock();
      requestNotificationPermission();

      // Keep service worker alive
      keepAliveInterval = setInterval(() => {
        if (navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({ type: 'KEEP_ALIVE' });
        }
      }, 10000);
    } else {
      releaseWakeLock();
      if (transferState === 'completed' || transferState === 'failed') {
        clearNotification();
      }
    }
    return () => {
      releaseWakeLock();
      if (keepAliveInterval) clearInterval(keepAliveInterval);
    };
  }, [transferState, requestWakeLock, releaseWakeLock, requestNotificationPermission, clearNotification]);

  useEffect(() => {
    if (stats && (transferState === 'sending' || transferState === 'receiving')) {
      updateNotification(stats, transferState);
    }
  }, [stats, transferState, updateNotification]);

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

  const startReceiving = useCallback((manifest, dataChannel, signaling = null, roomCode = null, peerId = null) => {
    const receiver = new FileReceiver(manifest, signaling, roomCode, peerId);
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
    senderRef,
    receiverRef,
  };
}
