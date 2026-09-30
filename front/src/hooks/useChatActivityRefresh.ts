import { useEffect, useRef } from 'react';
import { useSocket } from '@/context/socket.context';

const DEBOUNCE_MS = 800;

export function useChatActivityRefresh(onActivity: () => void) {
  const { socket } = useSocket();

  const callbackRef = useRef(onActivity);
  useEffect(() => {
    callbackRef.current = onActivity;
  }, [onActivity]);

  useEffect(() => {
    if (!socket) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => callbackRef.current(), DEBOUNCE_MS);
    };

    socket.on('chat:created', schedule);
    socket.on('chat:status', schedule);

    return () => {
      clearTimeout(timer);
      socket.off('chat:created', schedule);
      socket.off('chat:status', schedule);
    };
  }, [socket]);
}
