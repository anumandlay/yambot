/**
 * @fileoverview Hook that tracks whether a new user has finished first-run setup.
 * Purpose: Drive GettingStartedCard and sidebar hints without duplicating API calls.
 * Inputs: `/api/settings`, `/api/agents`, `/api/chats`.
 * Downstream: GettingStartedCard, StartPage, ChatsPage, AppSidebar.
 */

import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api.js";

/**
 * @typedef {{
 *   loading: boolean,
 *   hasLlm: boolean,
 *   agentCount: number,
 *   chatCount: number,
 *   complete: boolean,
 *   refresh: () => Promise<void>,
 * }} SetupStatus
 */

/**
 * Loads setup milestones so the UI can show a guided checklist.
 * Why: New users land on empty Chats with no pointer to Settings or agent creation.
 * @returns {SetupStatus}
 */
export function useSetupStatus() {
  const [loading, setLoading] = useState(true);
  const [hasLlm, setHasLlm] = useState(false);
  const [agentCount, setAgentCount] = useState(0);
  const [chatCount, setChatCount] = useState(0);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsData, agentsData, chatsData] = await Promise.all([
        api("/api/settings"),
        api("/api/agents"),
        api("/api/chats"),
      ]);
      const s = settingsData.settings || {};
      const llmReady = Boolean(s.hasLlmApiKey || s.llmOAuthConnected);
      setHasLlm(llmReady);
      setAgentCount((agentsData.agents || []).length);
      setChatCount((chatsData.chats || []).length);
    } catch {
      /* Why: partial failure should not block the rest of the app shell. */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const complete = hasLlm && agentCount > 0 && chatCount > 0;

  return { loading, hasLlm, agentCount, chatCount, complete, refresh };
}
