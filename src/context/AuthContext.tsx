'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export type UserRole = 'superadmin' | 'admin' | 'user';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
}

interface AuthContextType {
  isAuthenticated: boolean;
  user: AuthUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  isLoading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Verify session with server on mount
  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.user) {
          setUser(d.user);
          setIsAuthenticated(true);
        }
      })
      .catch(() => {})
      .finally(() => setIsLoading(false));
  }, []);

  const login = async (email: string, password: string) => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.error || 'Login failed');
    setUser(data.user);
    setIsAuthenticated(true);
  };

  const logout = async () => {
    // Revoke the session + clear the cookie server-side.
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setUser(null);
    setIsAuthenticated(false);
    // Wipe any cached client state (lead filters/views, etc.) so nothing lingers
    // or reappears on the next login.
    try { sessionStorage.clear(); localStorage.clear(); } catch { /* ignore */ }
    // Hard redirect (replace, not push): fully unmounts the app so no page content
    // survives the logout, and removes the authenticated page from history so the
    // Back button can't return to it — regardless of which page we logged out from.
    if (typeof window !== 'undefined') {
      window.location.replace('/login');
    }
  };

  return (
    <AuthContext.Provider value={{ isAuthenticated, user, login, logout, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
