import { useState, useCallback, useRef } from 'react';
import { getSignalingClient } from '../lib/signaling';
import { SIGNALING_URL } from '../lib/constants';

export function useSignaling() {
  const [client] = useState(() => getSignalingClient(SIGNALING_URL));
  const clientRef = useRef(client);
  const [connected, setConnected] = useState(client.connected);
  const [error, setError] = useState(null);

  const connect = useCallback(async (params) => {
    try {
      setError(null);
      await clientRef.current.connect(params);
      setConnected(true);
    } catch (err) {
      setError(err.message);
      setConnected(false);
    }
  }, []);

  const send = useCallback((type, payload) => {
    return clientRef.current?.send(type, payload) ?? false;
  }, []);

  const sendBinary = useCallback((data) => {
    return clientRef.current?.sendBinary(data) ?? false;
  }, []);

  const on = useCallback((event, callback) => {
    return clientRef.current?.on(event, callback);
  }, []);

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect();
    setConnected(false);
  }, []);

  return {
    client,
    connected,
    error,
    connect,
    send,
    sendBinary,
    on,
    disconnect,
  };
}
