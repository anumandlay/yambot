/**
 * @fileoverview Grok-style full-bleed workspace — agents | chat | live rail.
 * Purpose: Open in a new tab from the main nav; pick an agent on the left, chat in the
 * middle, and reuse ChatDetailPage’s right rail (live screen + composer) on the right.
 * Downstream: GET /api/agents, GET/POST/DELETE /api/chats; nested ChatDetailPage at /grok/:chatId.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Outlet, useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";

/**
 * Agent-bound chats for one agent, newest first.
 * @param {object[]} chats
 * @param {string} agentId
 * @returns {object[]}
 */
function chatsForAgent(chats, agentId) {
  const id = String(agentId);
  return (chats || [])
    .filter((c) => {
      if (c?.kind === "common") return false;
      const aid = c?.agent?._id || c?.agent;
      return aid && String(aid) === id;
    })
    .sort((a, b) => {
      const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return tb - ta;
    });
}

/**
 * Finds the newest agent-bound chat for a given agent id.
 * @param {object[]} chats
 * @param {string} agentId
 * @returns {object|null}
 */
function findAgentChat(chats, agentId) {
  return chatsForAgent(chats, agentId)[0] || null;
}

/**
 * Display title for a chat row in the tree.
 * @param {object} chat
 * @returns {string}
 */
function chatLabel(chat) {
  const t = String(chat?.title || "").trim();
  if (t && t !== "New chat" && !t.startsWith("Chat ·")) return t;
  return "Untitled chat";
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
 * Three-pane workspace: agent→chats tree (left) + chat outlet (middle+right via ChatDetailPage).
 */
export function GrokStylePage() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [chats, setChats] = useState([]);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState("");
  const [deletingId, setDeletingId] = useState("");
  const [agentsOpen, setAgentsOpen] = useState(false);
  /** Agent ids whose chat trees are expanded. */
  const [expanded, setExpanded] = useState(() => new Set());

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

  // Why: keep the active agent’s branch open so the chat tree is visible without hunting.
  useEffect(() => {
    if (!selectedAgentId) return;
    setExpanded((prev) => {
      if (prev.has(selectedAgentId)) return prev;
      const next = new Set(prev);
      next.add(selectedAgentId);
      return next;
    });
  }, [selectedAgentId]);

  /**
   * @param {string} agentId
   */
  function toggleExpand(agentId) {
    const id = String(agentId);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Opens an existing chat in the workspace.
   * @param {string} id
   */
  function openChat(id) {
    setAgentsOpen(false);
    navigate(`/grok/${id}`);
  }

  /**
   * Opens newest agent chat or creates one, then navigates under /grok.
   * @param {string} agentId
   */
  async function openAgent(agentId) {
    const id = String(agentId);
    setBusyId(id);
    setError(null);
    setAgentsOpen(false);
    setExpanded((prev) => new Set(prev).add(id));
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

  /**
   * Always creates a new chat under the agent (tree “+” control).
   * @param {string} agentId
   * @param {React.MouseEvent} [e]
   */
  async function createChat(agentId, e) {
    e?.stopPropagation?.();
    const id = String(agentId);
    setBusyId(`new:${id}`);
    setError(null);
    setExpanded((prev) => new Set(prev).add(id));
    try {
      const data = await api("/api/chats", {
        method: "POST",
        body: JSON.stringify({ agentId: id, kind: "agent" }),
      });
      const chat = data.chat;
      setChats((prev) => [chat, ...prev.filter((c) => String(c._id) !== String(chat._id))]);
      setAgentsOpen(false);
      navigate(`/grok/${chat._id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusyId("");
    }
  }

  /**
   * Deletes a chat from the tree (same cascade as classic Chats page).
   * @param {object} chat
   * @param {React.MouseEvent} e
   */
  async function deleteChat(chat, e) {
    e?.stopPropagation?.();
    e?.preventDefault?.();
    const label = chatLabel(chat);
    const id = String(chat._id);
    if (
      !window.confirm(
        `Delete “${label}”? Messages and queued goals for this thread will be removed. Running work from this thread will be stopped.`
      )
    ) {
      return;
    }
    setDeletingId(id);
    setError(null);
    setChats((prev) => prev.filter((c) => String(c._id) !== id));
    try {
      await api(`/api/chats/${id}`, { method: "DELETE" });
      if (String(chatId) === id) {
        const aid = chat?.agent?._id || chat?.agent;
        const remaining = aid ? chatsForAgent(
          // Why: local state already dropped this id — use filtered list for navigation.
          chats.filter((c) => String(c._id) !== id),
          String(aid)
        ) : [];
        if (remaining[0]) navigate(`/grok/${remaining[0]._id}`);
        else navigate("/grok");
      }
    } catch (err) {
      setError(err);
      await reload();
    } finally {
      setDeletingId("");
    }
  }

  const agentRail = (
    <aside
      className={`flex h-full min-h-0 w-full flex-col border-teal-900/60 bg-[#0f172a] lg:w-72 lg:shrink-0 lg:border-r ${
        agentsOpen ? "absolute inset-0 z-40 lg:static" : "hidden lg:flex"
      }`}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-teal-900/60 px-3 py-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-bold uppercase tracking-wider text-teal-400/80">
            grok-style
          </p>
          <p className="truncate text-sm font-semibold text-teal-50">Agents & chats</p>
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
            <Link
              to="/agents/new"
              className="font-semibold text-teal-300 underline"
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
              const agentChats = chatsForAgent(chats, id);
              const isOpen = expanded.has(id);
              const anyLive = agentChats.some(
                (c) => c?.live?.status === "running" || c?.live?.status === "waiting_user"
              );
              return (
                <li key={id} className="rounded-xl">
                  <div
                    className={`flex min-h-11 items-center gap-0.5 rounded-xl ${
                      agentActive ? "bg-teal-800/80" : "hover:bg-teal-900/50"
                    }`}
                  >
                    <button
                      type="button"
                      className="inline-flex min-h-11 min-w-9 shrink-0 items-center justify-center text-teal-300/80"
                      aria-label={isOpen ? "Collapse chats" : "Expand chats"}
                      aria-expanded={isOpen}
                      onClick={() => toggleExpand(id)}
                    >
                      {isOpen ? "▾" : "▸"}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === id}
                      onClick={() => void openAgent(id)}
                      className="flex min-h-11 min-w-0 flex-1 items-center gap-2 py-2 pr-1 text-left text-sm font-semibold text-teal-50 disabled:opacity-50"
                      title="Open latest chat"
                    >
                      <span className="min-w-0 flex-1 truncate">{a.name || "Agent"}</span>
                      {anyLive ? (
                        <span className="shrink-0 rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[0.65rem] font-bold uppercase text-emerald-300">
                          Live
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busyId)}
                      onClick={(e) => void createChat(id, e)}
                      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-lg text-lg font-bold text-teal-300 hover:bg-teal-700/50 disabled:opacity-50"
                      title="New chat"
                      aria-label={`New chat for ${a.name || "agent"}`}
                    >
                      +
                    </button>
                  </div>

                  {isOpen ? (
                    <ul className="ml-3 mt-0.5 flex flex-col gap-0.5 border-l border-teal-800/80 pl-2">
                      {agentChats.length === 0 ? (
                        <li className="px-2 py-2 text-xs text-teal-400/70">No chats yet</li>
                      ) : (
                        agentChats.map((c) => {
                          const cid = String(c._id);
                          const selected = String(chatId) === cid;
                          const live =
                            c?.live?.status === "running" || c?.live?.status === "waiting_user";
                          return (
                            <li key={cid} className="group flex min-h-10 items-center gap-0.5">
                              <button
                                type="button"
                                onClick={() => openChat(cid)}
                                className={`flex min-h-10 min-w-0 flex-1 items-center gap-1.5 rounded-lg px-2 text-left text-xs font-medium transition-colors ${
                                  selected
                                    ? "bg-teal-600 text-white"
                                    : "text-teal-200/90 hover:bg-teal-900/60"
                                }`}
                              >
                                <span className="min-w-0 flex-1 truncate">{chatLabel(c)}</span>
                                {live ? (
                                  <span className="shrink-0 text-[0.6rem] font-bold uppercase text-emerald-300">
                                    ·
                                  </span>
                                ) : null}
                              </button>
                              <button
                                type="button"
                                disabled={deletingId === cid}
                                onClick={(e) => void deleteChat(c, e)}
                                className="inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center rounded-lg text-teal-400/70 opacity-70 hover:bg-red-950/50 hover:text-red-300 group-hover:opacity-100 disabled:opacity-40"
                                title="Delete chat"
                                aria-label={`Delete ${chatLabel(c)}`}
                              >
                                {deletingId === cid ? "…" : "🗑"}
                              </button>
                            </li>
                          );
                        })
                      )}
                    </ul>
                  ) : null}
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
            <p className="text-lg font-bold tracking-tight text-teal-950">Pick an agent or chat</p>
            <p className="max-w-md text-sm text-teal-900/70">
              Expand an agent on the left to see its chats. Use + for a new thread, or the trash icon
              to delete one.
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
