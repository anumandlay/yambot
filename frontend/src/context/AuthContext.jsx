/**
 * @fileoverview Auth context — session user + login/register/logout.
 * Purpose: Gate protected routes and expose current user to the shell.
 * Downstream: App router, LoginPage, RegisterPage, Header.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  /** Bumps on login/logout so in-flight /me responses cannot clobber a fresh session. */
  const sessionEpochRef = useRef(0);

  const refresh = useCallback(async () => {
    const epoch = sessionEpochRef.current;
    if (!getToken()) {
      if (epoch === sessionEpochRef.current) {
        setUser(null);
        setLoading(false);
      }
      return;
    }
    try {
      const data = await api("/api/auth/me");
      if (epoch !== sessionEpochRef.current) return;
      setUser(data.user);
      setError(null);
    } catch (err) {
      if (epoch !== sessionEpochRef.current) return;
      setToken(null);
      setUser(null);
      setError(err);
    } finally {
      if (epoch === sessionEpochRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  /**
   * @param {{ email: string, password: string }} creds
   */
  const login = useCallback(async (creds) => {
    sessionEpochRef.current += 1;
    const data = await api("/api/auth/login", {
      method: "POST",
      auth: false,
      body: JSON.stringify(creds),
    });
    setToken(data.token);
    setUser(data.user);
    setError(null);
    setLoading(false);
    return data;
  }, []);

  /**
   * @param {{ name: string, email: string, password: string }} payload
   */
  const register = useCallback(async (payload) => {
    sessionEpochRef.current += 1;
    const data = await api("/api/auth/register", {
      method: "POST",
      auth: false,
      body: JSON.stringify(payload),
    });
    setToken(data.token);
    setUser(data.user);
    setError(null);
    setLoading(false);
    return data;
  }, []);

  const logout = useCallback(() => {
    sessionEpochRef.current += 1;
    setToken(null);
    setUser(null);
    setError(null);
    setLoading(false);
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
