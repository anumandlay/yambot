/**
 * @fileoverview Global help/tooltip visibility preference for the signed-in user.
 * Purpose: Let users turn contextual ? tooltips and How To guides on or off app-wide.
 * Downstream: HelpTooltip, FieldLabel, AppSidebar, HelpToggle.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useAuth } from "./AuthContext.jsx";
import { api } from "../lib/api.js";

const HELP_STORAGE_KEY = "yambot.help.enabled";

/**
 * @returns {boolean}
 */
function readLocalHelpEnabled() {
  try {
    const value = localStorage.getItem(HELP_STORAGE_KEY);
    if (value === "0") return false;
    if (value === "1") return true;
  } catch {
    /* ignore */
  }
  return true;
}

/**
 * @param {boolean} enabled
 */
function writeLocalHelpEnabled(enabled) {
  try {
    localStorage.setItem(HELP_STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

const HelpContext = createContext(null);

/**
 * @param {{ children: import("react").ReactNode }} props
 */
export function HelpProvider({ children }) {
  const { user } = useAuth();
  const [helpEnabled, setHelpEnabledState] = useState(readLocalHelpEnabled);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    if (!user?.id) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const data = await api("/api/settings");
        if (cancelled) return;
        if (typeof data.settings?.helpEnabled === "boolean") {
          setHelpEnabledState(data.settings.helpEnabled);
          writeLocalHelpEnabled(data.settings.helpEnabled);
        }
      } catch {
        /* keep local preference */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  /**
   * @param {boolean} next
   */
  const setHelpEnabled = useCallback(
    async (next) => {
      const enabled = Boolean(next);
      setHelpEnabledState(enabled);
      writeLocalHelpEnabled(enabled);
      if (!user?.id) return;
      setSyncing(true);
      try {
        await api("/api/settings", {
          method: "PUT",
          body: JSON.stringify({ helpEnabled: enabled }),
        });
      } catch {
        /* local preference still applies */
      } finally {
        setSyncing(false);
      }
    },
    [user?.id]
  );

  const toggleHelp = useCallback(() => {
    setHelpEnabled(!helpEnabled);
  }, [helpEnabled, setHelpEnabled]);

  const value = useMemo(
    () => ({ helpEnabled, setHelpEnabled, toggleHelp, syncing }),
    [helpEnabled, setHelpEnabled, toggleHelp, syncing]
  );

  return <HelpContext.Provider value={value}>{children}</HelpContext.Provider>;
}

/**
 * @returns {{ helpEnabled: boolean, setHelpEnabled: (next: boolean) => Promise<void>, toggleHelp: () => void, syncing: boolean }}
 */
export function useHelp() {
  const ctx = useContext(HelpContext);
  if (!ctx) throw new Error("useHelp must be used within HelpProvider");
  return ctx;
}
