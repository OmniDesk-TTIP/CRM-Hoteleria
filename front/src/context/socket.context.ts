import { createContext, useContext } from 'react';
import type { Socket } from 'socket.io-client';

export interface SocketContextValue {
  socket: Socket | null;
  isConnected: boolean;
  subscribeToChat: (chatId: string) => () => void;
}

export const SocketContext = createContext<SocketContextValue | undefined>(undefined);

export const useSocket = (): SocketContextValue => {
  const context = useContext(SocketContext);
  if (!context) throw new Error('useSocket tiene que usarse adentro de <SocketProvider>.');
  return context;
};
