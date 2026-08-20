/**
 * @fileoverview Auth context — session user + login/register/logout.
 * Purpose: Gate protected routes and expose current user to the shell.
 * Downstream: App router, LoginPage, RegisterPage, Header.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, getToken, setToken } from "../lib/api.js";

const AuthContext = createContext(null);

/**
 * Provides authentication state to the React tree.
 * @param {{ children: import('react').ReactNode }} props
 */
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await api("/api/auth/me");
      setUser(data.user);
      setError(null);
    } catch (err) {
      setToken(null);
      setUser(null);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * @param {{ email: string, password: string }} creds
   */
  const login = useCallback(async (creds) => {
    const data = await api("/api/auth/login", {
      method: "POST",
      auth: false,
      body: JSON.stringify(creds),
    });
    setToken(data.token);
    setUser(data.user);
    return data;
  }, []);

  /**
   * @param {{ name: string, email: string, password: string }} payload
   */
  const register = useCallback(async (payload) => {
    const data = await api("/api/auth/register", {
      method: "POST",
      auth: false,
      body: JSON.stringify(payload),
    });
    setToken(data.token);
    setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, error, login, register, logout, refresh }),
    [user, loading, error, login, register, logout, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * @returns {{ user: any, loading: boolean, login: Function, register: Function, logout: Function }}
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
