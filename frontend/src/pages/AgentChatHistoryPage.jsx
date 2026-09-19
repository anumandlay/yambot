/**
 * @fileoverview Full chat history for one agent (current or archived).
 * Purpose: Read-only, human-readable transcript (no action-schema / ops dumps).
 * Downstream: GET /api/agents/:id/chat-history (newest messages per thread).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { AgentAvatar } from "../components/AgentAvatar.jsx";
import {
  isHistoryNoiseMessage,
  readableHistoryContent,
} from "../lib/readableChat.js";

/**
 * @param {object} msg
 * @returns {string}
 */
function msgLabel(msg) {
  if (msg.role === "user") return "You";
  if (msg.meta?.fromAgentName) return String(msg.meta.fromAgentName);
  if (msg.role === "agent") return "Agent";
  if (msg.role === "assistant") return "Assistant";
  if (msg.role === "system") return "System";
  return msg.role || "Message";
}

/**
 * @param {string} q
 * @param {string} hay
 * @returns {boolean}
 */
function textMatches(q, hay) {
  const query = String(q || "").trim().toLowerCase();
  if (!query) return true;
  const h = String(hay || "").toLowerCase();
  return query
    .split(/\s+/)
    .filter(Boolean)
    .every((tok) => h.includes(tok));
}

export function AgentChatHistoryPage() {
  const { agentId } = useParams();
  const [agent, setAgent] = useState(null);
  const [chats, setChats] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openChatId, setOpenChatId] = useState("");
  const [search, setSearch] = useState("");
  /** Scroll the open transcript to the latest bubble after load/expand. */
  const transcriptEndRef = useRef(null);

  const load = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const data = await api(`/api/agents/${agentId}/chat-history?messageLimit=800`);
      setAgent(data.agent);
      setChats(data.chats || []);
      if (data.chats?.[0]?._id) setOpenChatId(String(data.chats[0]._id));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!openChatId || loading) return;
    transcriptEndRef.current?.scrollIntoView({ block: "end" });
  }, [openChatId, loading, chats, search]);

  /** Precompute readable rows so expand is cheap and counts stay honest. */
  const chatsView = useMemo(
    () =>
      chats.map((chat) => {
        const readable = (chat.messages || [])
          .filter((m) => !isHistoryNoiseMessage(m))
          .map((m) => ({
            ...m,
            display: readableHistoryContent(m.content, m.meta),
          }))
          .filter((m) => String(m.display || "").trim());
        return { chat, readable };
      }),
    [chats]
  );

  const filteredView = useMemo(() => {
    const q = search.trim();
    if (!q) return chatsView.map(({ chat, readable }) => ({ chat, readable, filtered: readable }));
    return chatsView
      .map(({ chat, readable }) => {
        const titleHit = textMatches(q, chat.title || "Chat");
        const filtered = readable.filter(
          (m) =>
            titleHit ||
            textMatches(q, m.display) ||
            textMatches(q, msgLabel(m))
        );
        const chatMatches = titleHit || filtered.length > 0;
        return chatMatches ? { chat, readable, filtered } : null;
      })
      .filter(Boolean);
  }, [chatsView, search]);

  useEffect(() => {
    if (!search.trim()) return;
    // Why: when searching, auto-expand the first matching thread so hits are visible.
    if (filteredView[0]?.chat?._id) {
      setOpenChatId(String(filteredView[0].chat._id));
    }
  }, [search, filteredView]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-3 py-4 sm:px-4 sm:py-6 md:px-6">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/history" className="text-sm font-semibold text-teal-700 hover:underline">
          ← History
        </Link>
      </div>

      {agent ? (
        <div className="flex items-start gap-3">
          <AgentAvatar agent={agent} size="md" />
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">{agent.name}</h1>
            <p className="text-sm text-teal-900/70">
              Conversation history
              {agent.archived ? " · archived agent" : ""}
              {agent.skill ? ` · ${agent.skill}` : ""}
            </p>
          </div>
        </div>
      ) : null}

      {!loading && chats.length > 0 ? (
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search messages by keyword…"
          className="min-h-11 w-full rounded-xl border border-teal-200 bg-white px-3 text-sm"
          aria-label="Search chat history"
        />
      ) : null}

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}

      {loading ? <p className="text-sm text-teal-900/60">Loading transcripts…</p> : null}

      {!loading && !chats.length ? (
        <p className="text-sm text-teal-900/60">No chats on record for this agent.</p>
      ) : null}

      {!loading && chats.length > 0 && !filteredView.length ? (
        <p className="text-sm text-teal-900/60">No messages match “{search.trim()}”.</p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {filteredView.map(({ chat, readable, filtered }) => {
          const id = String(chat._id);
          const open = openChatId === id;
          const shown = search.trim() ? filtered : readable;
          const total =
            typeof chat.messageCount === "number"
              ? chat.messageCount
              : (chat.messages || []).length;
          return (
            <li
              key={id}
              className="overflow-hidden rounded-2xl border border-teal-100 bg-white shadow-sm"
            >
              <button
                type="button"
                className="flex min-h-12 w-full items-center justify-between gap-2 px-4 py-3 text-left"
                onClick={() => setOpenChatId(open ? "" : id)}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-teal-950">
                    {chat.title || "Chat"}
                  </span>
                  <span className="text-xs text-teal-900/60">
                    {search.trim()
                      ? `${shown.length} match${shown.length === 1 ? "" : "es"}`
                      : `${readable.length} messages`}
                    {!search.trim() && total > readable.length ? ` · ${total} total logged` : ""}
                    {chat.updatedAt
                      ? ` · updated ${new Date(chat.updatedAt).toLocaleString()}`
                      : ""}
                  </span>
                </span>
                <span className="text-xs font-bold text-teal-700">{open ? "Hide" : "Show"}</span>
              </button>
              {open ? (
                <div className="max-h-[28rem] space-y-2 overflow-y-auto border-t border-teal-50 bg-[#f7f5fc]/50 px-3 py-3">
                  {chat.truncated && !search.trim() ? (
                    <p className="text-[0.7rem] text-teal-800/55">
                      Showing the latest window of this thread.
                    </p>
                  ) : null}
                  {shown.map((msg) => {
                    const mine = msg.role === "user";
                    return (
                      <div
                        key={msg._id}
                        className={`max-w-[95%] rounded-2xl px-3 py-2 text-sm ${
                          mine
                            ? "ml-auto bg-teal-700 text-white"
                            : msg.role === "system"
                              ? "border border-teal-100 bg-white text-teal-900/75"
                              : "border border-teal-100 bg-white text-teal-950"
                        }`}
                      >
                        {!mine ? (
                          <div className="mb-0.5 text-[0.65rem] font-bold uppercase tracking-wide opacity-70">
                            {msgLabel(msg)}
                          </div>
                        ) : null}
                        <div className="whitespace-pre-wrap break-words">{msg.display}</div>
                        {msg.createdAt ? (
                          <div
                            className={`mt-1 text-[0.65rem] ${
                              mine ? "text-white/70" : "text-teal-800/45"
                            }`}
                          >
                            {new Date(msg.createdAt).toLocaleString()}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                  {!shown.length ? (
                    <p className="text-xs text-teal-900/55">
                      {search.trim()
                        ? "No messages in this thread match the search."
                        : "No conversation messages in this window (only run activity was logged)."}
                    </p>
                  ) : null}
                  <div ref={open ? transcriptEndRef : null} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
