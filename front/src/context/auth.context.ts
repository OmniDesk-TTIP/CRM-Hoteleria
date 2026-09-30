import { createContext, useContext } from 'react';
import type { AuthContextValue } from '@/config/types';

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth tiene que usarse adentro de <AuthProvider>.');
  }

  return context;
};
