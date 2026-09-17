/**
 * @fileoverview Grok-style full-bleed workspace — agents | chat | live rail.
 * Purpose: Open in a new tab from the main nav; pick an agent on the left (one chat each),
 * chat in the middle, and reuse ChatDetailPage’s right rail on the right.
 * Downstream: GET /api/agents, GET/POST/DELETE /api/chats; nested ChatDetailPage at /grok/:chatId.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Outlet, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";

/**
 * True when any of this agent's chats has a queued or active browser/API job.
 * @param {object[]} chats
 * @param {string} agentId
 * @returns {boolean}
 */
function agentIsWorking(chats, agentId) {
  const id = String(agentId);
  for (const c of chats || []) {
    if (c?.kind === "common") continue;
    const aid = c?.agent?._id || c?.agent;
    if (!aid || String(aid) !== id) continue;
    const s = c?.live?.status;
    if (s === "running" || s === "waiting_user" || s === "pending") return true;
  }
  return false;
}

/**
 * Auth-gated chrome-free shell for /grok (no AppSidebar).
 */
export function GrokStyleLayout() {
  return (
    <div className="flex h-dvh max-h-dvh min-h-0 w-full overflow-hidden bg-[#f7f5fc] text-teal-950">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Outlet />
      </div>
    </div>
  );
}

/**
 * Three-pane workspace: agent list (left) + chat outlet (middle+right via ChatDetailPage).
 * Why: one chat per agent — no “+ new chat” sprawl.
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

  // Why: keep green activity dots fresh even on the empty “pick an agent” screen.
  useEffect(() => {
    const t = window.setInterval(() => {
      void reload().catch(() => {});
    }, 5000);
    return () => window.clearInterval(t);
  }, [reload]);

  const selectedAgentId = useMemo(() => {
    if (!chatId) return "";
    const chat = chats.find((c) => String(c._id) === String(chatId));
    const aid = chat?.agent?._id || chat?.agent;
    return aid ? String(aid) : "";
  }, [chatId, chats]);

  /**
   * Opens the agent's sole chat (POST reuses via ensureAgentChat).
   * @param {string} agentId
   */
  async function openAgent(agentId) {
    const id = String(agentId);
    setBusyId(id);
    setError(null);
    setAgentsOpen(false);
    try {
      // Why: always POST so backend can retitle/migrate to the canonical sole chat.
      const data = await api("/api/chats", {
        method: "POST",
        body: JSON.stringify({ agentId: id, kind: "agent" }),
      });
      const chat = data.chat;
      setChats((prev) => [chat, ...prev.filter((c) => String(c._id) !== String(chat._id))]);
      navigate(`/grok/${chat._id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusyId("");
    }
  }

  const agentRail = (
    <aside
      className={`flex h-full min-h-0 w-full flex-col border-teal-100 bg-white lg:w-72 lg:shrink-0 lg:border-r ${
        agentsOpen ? "absolute inset-0 z-40 lg:static" : "hidden lg:flex"
      }`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-teal-100 bg-teal-50/80 px-3 py-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-bold uppercase tracking-wider text-teal-600">
            grok-style
          </p>
          <p className="truncate text-sm font-semibold text-teal-950">Agents</p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-teal-200 bg-white text-teal-900 lg:hidden"
          onClick={() => setAgentsOpen(false)}
          aria-label="Close agents"
        >
          ✕
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
        {agents.length === 0 ? (
          <p className="px-2 py-3 text-sm text-teal-900/70">
            No agents yet.{" "}
            <Link
              to="/agents/new"
              className="font-semibold text-teal-700 underline"
              target="_blank"
              rel="noreferrer"
            >
              Create one
            </Link>
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {agents.map((a) => {
              const id = String(a._id);
              const agentActive = selectedAgentId === id;
              const working = agentIsWorking(chats, id);
              return (
                <li key={id}>
                  <button
                    type="button"
                    disabled={busyId === id}
                    onClick={() => void openAgent(id)}
                    className={`flex min-h-11 w-full min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-sm font-semibold disabled:opacity-50 ${
                      agentActive
                        ? "bg-teal-600 text-white"
                        : "text-teal-950 hover:bg-teal-50"
                    }`}
                    title={working ? "Agent is working — open chat" : "Open chat"}
                  >
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        working
                          ? "animate-pulse bg-emerald-500 ring-2 ring-emerald-500/30"
                          : agentActive
                            ? "bg-white/35"
                            : "bg-teal-200"
                      }`}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate">{a.name || "Agent"}</span>
                    {working ? (
                      <span className="sr-only">Working</span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="shrink-0 border-t border-teal-100 p-3">
        <Link
          to="/"
          className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-teal-200 bg-white text-sm font-semibold text-teal-900 hover:bg-teal-50"
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

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[#f7f5fc] text-teal-950">
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
              Each agent has one ongoing chat. Goals, schedules, and agent-to-agent work all land
              there.
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
