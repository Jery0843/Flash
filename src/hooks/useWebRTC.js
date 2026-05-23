import { useState, useCallback, useRef } from 'react';
import { WebRTCManager } from '../lib/webrtc';

export function useWebRTC() {
  const managerRef = useRef(null);
  const [connectionState, setConnectionState] = useState('new');
  const [connectionType, setConnectionType] = useState(null);
  const [channelOpen, setChannelOpen] = useState(false);

  const init = useCallback(async (initiator) => {
    if (managerRef.current) {
      managerRef.current.close();
    }
    const manager = new WebRTCManager();
    managerRef.current = manager;

    manager.on('ice-state', setConnectionState);
    manager.on('connection-type', setConnectionType);
    manager.on('channel-open', () => setChannelOpen(true));
    manager.on('channel-close', () => setChannelOpen(false));

    await manager.init(initiator);
    return manager;
  }, []);

  const close = useCallback(() => {
    managerRef.current?.close();
    managerRef.current = null;
    setConnectionState('new');
    setConnectionType(null);
    setChannelOpen(false);
  }, []);

  return {
    manager: managerRef.current,
    connectionState,
    connectionType,
    channelOpen,
    init,
    close,
  };
}
