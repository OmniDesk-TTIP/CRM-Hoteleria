import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AuthContext } from '@/context/auth.context';
import { setAccessToken, setSessionHandlers } from '@/config/api';
import {
  getCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  refreshSession,
} from '@/services/auth.service';
import type { AuthContextValue, AuthStatus, AuthUser, LoginCredentials } from '@/config/types';

export default function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('checking');

  useEffect(() => {
    setSessionHandlers({
      refresh: async () => {
        const { accessToken } = await refreshSession();
        setAccessToken(accessToken);

        return accessToken;
      },
      onSessionExpired: () => {
        setAccessToken(null);
        setUser(null);
        setStatus('anonymous');
      },
    });

    return () => setSessionHandlers(null);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      try {
        const { accessToken } = await refreshSession();
        setAccessToken(accessToken);

        const currentUser = await getCurrentUser();
        if (cancelled) return;

        setUser(currentUser);
        setStatus('authenticated');
      } catch {
        if (cancelled) return;

        setAccessToken(null);
        setUser(null);
        setStatus('anonymous');
      }
    };

    void restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (credentials: LoginCredentials): Promise<AuthUser> => {
    const session = await loginRequest(credentials);

    setAccessToken(session.accessToken);
    setUser(session.user);
    setStatus('authenticated');

    return session.user;
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    await logoutRequest().catch(() => undefined);

    setAccessToken(null);
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, isAuthenticated: status === 'authenticated', login, logout }),
    [user, status, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
