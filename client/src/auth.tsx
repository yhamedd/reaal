import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { api, onAuthProblem } from './api';

export interface Me {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  role_key: string | null;
  role_name: string;
  permissions: string[];
  must_change_password: boolean;
  config: {
    inactivity_minutes: number;
    verification: { attention: number; outdated: number };
    company_name: string;
    currency: string;
  };
}

interface AuthState {
  me: Me | null;
  loading: boolean;
  expiredReason: string | null;
  can: (perm: string) => boolean;
  refresh: () => Promise<void>;
  logout: (reason?: string) => Promise<void>;
}

const AuthContext = createContext<AuthState>(null as any);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [expiredReason, setExpiredReason] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/api/auth/me'));
    } catch {
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async (reason?: string) => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* already signed out */
    }
    setExpiredReason(reason ?? null);
    setMe(null);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(
    () =>
      onAuthProblem((status, headers) => {
        if (status === 401) {
          const why = headers.get('X-Session-Expired');
          if (why) setExpiredReason(why === 'inactivity' ? 'You were signed out after a period of inactivity.' : 'Your session has expired.');
          setMe(null);
        }
        if (status === 428) setMe((m) => (m ? { ...m, must_change_password: true } : m));
      }),
    [],
  );

  // Client-side inactivity timer mirrors the server rule so the screen doesn't linger with data visible.
  const lastActivity = useRef(Date.now());
  useEffect(() => {
    if (!me) return;
    const bump = () => (lastActivity.current = Date.now());
    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const minutes = me.config.inactivity_minutes;
    const timer = window.setInterval(() => {
      if (minutes > 0 && Date.now() - lastActivity.current > minutes * 60_000) {
        logout('You were signed out after a period of inactivity.');
      }
    }, 30_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      window.clearInterval(timer);
    };
  }, [me, logout]);

  const can = useCallback((perm: string) => !!me?.permissions.includes(perm), [me]);

  return <AuthContext.Provider value={{ me, loading, expiredReason, can, refresh, logout }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
