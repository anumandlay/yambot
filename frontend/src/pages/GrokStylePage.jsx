/**
 * @fileoverview Grok-style full-bleed workspace — agents | chat | live rail.
 * Purpose: Open in a new tab from the main nav; pick an agent on the left, chat in the
 * middle, and reuse ChatDetailPage’s right rail (live screen + composer) on the right.
 * Downstream: GET /api/agents, GET/POST /api/chats; nested ChatDetailPage at /grok/:chatId.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Outlet, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";

/**
 * Finds the newest agent-bound chat for a given agent id.
 * @param {object[]} chats
 * @param {string} agentId
 * @returns {object|null}
 */
function findAgentChat(chats, agentId) {
  const id = String(agentId);
  const matches = (chats || []).filter((c) => {
    if (c?.kind === "common") return false;
    const aid = c?.agent?._id || c?.agent;
    return aid && String(aid) === id;
  });
  if (!matches.length) return null;
  return matches.sort((a, b) => {
    const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return tb - ta;
  })[0];
}

/**
 * Auth-gated chrome-free shell for /grok (no AppSidebar).
 */
export function GrokStyleLayout() {
  // Why: layout chrome lives in GrokStylePage; this outlet host only fills the viewport.
  return (
    <div className="flex h-dvh max-h-dvh min-h-0 w-full overflow-hidden bg-[#0b1220] text-teal-50">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}

/**
 * Three-pane workspace: agent list (left) + chat outlet (middle+right via ChatDetailPage).
 */
export function GrokStylePage() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [chats, setChats] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState("");
  const [agentsOpen, setAgentsOpen] = useState(false);

  const reload = useCallback(async () => {
    const [agentData, chatData] = await Promise.all([
      api("/api/agents"),
      api("/api/chats?limit=100"),
    ]);
    setAgents(agentData.agents || []);
    setChats(chatData.chats || []);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await reload();
      } catch (err) {
        setError(err);
      }
    })();
  }, [reload]);

  // Why: refresh agent↔chat map when switching threads so live badges stay accurate.
  useEffect(() => {
    if (!chatId) return undefined;
    const t = window.setInterval(() => {
      void reload().catch(() => {});
    }, 15000);
    return () => window.clearInterval(t);
  }, [chatId, reload]);

  const selectedAgentId = useMemo(() => {
    if (!chatId) return "";
    const chat = chats.find((c) => String(c._id) === String(chatId));
    const aid = chat?.agent?._id || chat?.agent;
    return aid ? String(aid) : "";
  }, [chatId, chats]);

  /**
   * Opens existing agent chat or creates one, then navigates under /grok.
   * @param {string} agentId
   */
  async function openAgent(agentId) {
    const id = String(agentId);
    setBusyId(id);
    setError(null);
    setAgentsOpen(false);
    try {
      let chat = findAgentChat(chats, id);
      if (!chat) {
        const data = await api("/api/chats", {
          method: "POST",
          body: JSON.stringify({ agentId: id, kind: "agent" }),
        });
        chat = data.chat;
        setChats((prev) => [chat, ...prev.filter((c) => String(c._id) !== String(chat._id))]);
      }
      navigate(`/grok/${chat._id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusyId("");
    }
  }

  const agentRail = (
    <aside
      className={`flex h-full min-h-0 w-full flex-col border-teal-900/60 bg-[#0f172a] lg:w-64 lg:shrink-0 lg:border-r ${
        agentsOpen ? "absolute inset-0 z-40 lg:static" : "hidden lg:flex"
      }`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-teal-900/60 px-3 py-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-bold uppercase tracking-wider text-teal-400/80">
            grok-style
          </p>
          <p className="truncate text-sm font-semibold text-teal-50">Agents</p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-teal-800 text-teal-100 lg:hidden"
          onClick={() => setAgentsOpen(false)}
          aria-label="Close agents"
        >
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {agents.length === 0 ? (
          <p className="px-2 py-3 text-sm text-teal-200/70">
            No agents yet.{" "}
            <Link to="/agents/new" className="font-semibold text-teal-300 underline" target="_blank" rel="noreferrer">
              Create one
            </Link>
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {agents.map((a) => {
              const id = String(a._id);
              const active = selectedAgentId === id;
              const chat = findAgentChat(chats, id);
              const live = chat?.live?.status === "running";
              return (
                <li key={id}>
                  <button
                    type="button"
                    disabled={busyId === id}
                    onClick={() => void openAgent(id)}
                    className={`flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-semibold transition-colors ${
                      active
                        ? "bg-teal-600 text-white"
                        : "text-teal-100 hover:bg-teal-900/50"
                    } disabled:opacity-50`}
                  >
                    <span className="min-w-0 flex-1 truncate">{a.name || "Agent"}</span>
                    {live ? (
                      <span className="shrink-0 rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[0.65rem] font-bold uppercase text-emerald-300">
                        Live
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-teal-900/60 p-3">
        <Link
          to="/"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-teal-800 text-sm font-semibold text-teal-200 hover:bg-teal-900/40"
        >
          ← Classic YamBot
        </Link>
      </div>
    </aside>
  );

  return (
    <div className="relative flex h-full min-h-0 w-full flex-1 flex-col lg:flex-row">
      {agentsOpen ? (
        <button
          type="button"
          className="absolute inset-0 z-30 bg-black/50 lg:hidden"
          aria-label="Dismiss agents"
          onClick={() => setAgentsOpen(false)}
        />
      ) : null}
      {agentRail}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#f4faf8] text-teal-950">
        <div className="flex shrink-0 items-center gap-2 border-b border-teal-100 bg-white px-3 py-2 lg:hidden">
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-teal-100 bg-white text-lg font-bold"
            onClick={() => setAgentsOpen(true)}
            aria-label="Open agents"
          >
            ☰
          </button>
          <span className="min-w-0 flex-1 truncate text-sm font-bold">grok-style</span>
        </div>

        {error ? (
          <div className="shrink-0 px-3 pt-3">
            <ErrorAlert
              title={error.title}
              detail={error.detail || error.message}
              hint={error.hint}
              onClose={() => setError(null)}
            />
          </div>
        ) : null}

        {chatId ? (
          <div className="min-h-0 flex-1 overflow-hidden">
            <Outlet />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-lg font-bold tracking-tight text-teal-950">Pick an agent</p>
            <p className="max-w-md text-sm text-teal-900/70">
              Choose an agent on the left to open its chat in the middle. The live browser and goal
              composer stay on the right — same as the classic chat page.
            </p>
            <button
              type="button"
              className="inline-flex min-h-11 items-center rounded-xl bg-teal-700 px-4 font-semibold text-white lg:hidden"
              onClick={() => setAgentsOpen(true)}
            >
              Browse agents
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
