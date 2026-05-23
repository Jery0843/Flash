import { useState, useEffect, useCallback, useRef } from 'react';
import { SignalingClient } from '../lib/signaling';
import { MSG, SIGNALING_URL } from '../lib/constants';

export function useSignaling() {
  const clientRef = useRef(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    clientRef.current = new SignalingClient(SIGNALING_URL);
    return () => {
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, []);

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
    client: clientRef.current,
    connected,
    error,
    connect,
    send,
    sendBinary,
    on,
    disconnect,
  };
}
