import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { io, type Socket } from 'socket.io-client';
import { SocketContext, type SocketContextValue } from '@/context/socket.context';
import { useAuth } from '@/context/auth.context';
import { API_BASE_URL, getAccessToken, setAccessToken } from '@/config/api';
import { refreshSession } from '@/services/auth.service';

export default function SocketProvider({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (status !== 'authenticated') return;

    const instance = io(`${API_BASE_URL}/ws/chats`, {
      withCredentials: true,
      auth: (cb) => cb({ token: getAccessToken() }),
    });

    socketRef.current = instance;
    setSocket(instance);

    const MIN_REFRESH_INTERVAL_MS = 30_000;
    let lastRefreshAt = 0;

    const handleConnect = () => setIsConnected(true);

    const handleDisconnect = () => setIsConnected(false);

    const handleAuthError = () => {
      const now = Date.now();
      if (now - lastRefreshAt < MIN_REFRESH_INTERVAL_MS) return;
      lastRefreshAt = now;
      
      refreshSession()
        .then(({ accessToken }) => {
          setAccessToken(accessToken);
          instance.connect();
        })
        .catch(() => undefined);
    };

    instance.on('connect', handleConnect);
    instance.on('disconnect', handleDisconnect);
    instance.on('auth:error', handleAuthError);

    return () => {
      instance.off('connect', handleConnect);
      instance.off('disconnect', handleDisconnect);
      instance.off('auth:error', handleAuthError);
      instance.disconnect();

      socketRef.current = null;
      setSocket(null);
      setIsConnected(false);
    };
  }, [status]);

  const subscribeToChat = useCallback((chatId: string) => {
    const instance = socketRef.current;
    if (!instance) return () => undefined;

    instance.emit('chat:subscribe', { chatId });

    return () => {
      instance.emit('chat:unsubscribe', { chatId });
    };
  }, []);

  const value = useMemo<SocketContextValue>(
    () => ({ socket, isConnected, subscribeToChat }),
    [socket, isConnected, subscribeToChat],
  );

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}
