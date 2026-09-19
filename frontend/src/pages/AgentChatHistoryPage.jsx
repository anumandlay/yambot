/**
 * @fileoverview Full chat history for one agent (current or archived).
 * Purpose: Read-only transcript of every chat thread tied to the agent.
 * Downstream: GET /api/agents/:id/chat-history (newest messages per thread).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { AgentAvatar } from "../components/AgentAvatar.jsx";

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

export function AgentChatHistoryPage() {
  const { agentId } = useParams();
  const [agent, setAgent] = useState(null);
  const [chats, setChats] = useState([]);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [openChatId, setOpenChatId] = useState("");
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
    // Newest messages are at the bottom of the chronological window.
    transcriptEndRef.current?.scrollIntoView({ block: "end" });
  }, [openChatId, loading, chats]);

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
              Complete chat history
              {agent.archived ? " · archived agent" : ""}
              {agent.skill ? ` · ${agent.skill}` : ""}
            </p>
          </div>
        </div>
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

      <ul className="flex flex-col gap-3">
        {chats.map((chat) => {
          const id = String(chat._id);
          const open = openChatId === id;
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
                    {total} messages
                    {chat.updatedAt
                      ? ` · updated ${new Date(chat.updatedAt).toLocaleString()}`
                      : ""}
                  </span>
                </span>
                <span className="text-xs font-bold text-teal-700">{open ? "Hide" : "Show"}</span>
              </button>
              {open ? (
                <div className="max-h-[28rem] space-y-2 overflow-y-auto border-t border-teal-50 bg-[#f7f5fc]/50 px-3 py-3">
                  {chat.truncated ? (
                    <p className="text-[0.7rem] text-teal-800/55">
                      Showing the latest {(chat.messages || []).length} of {total} messages.
                    </p>
                  ) : null}
                  {(chat.messages || []).map((msg) => {
                    if (msg.meta?.ui === "icon") {
                      return (
                        <p
                          key={msg._id}
                          className="text-[0.7rem] text-teal-800/45"
                          title={msg.content}
                        >
                          {String(msg.content || "").slice(0, 160)}
                        </p>
                      );
                    }
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
                        <div className="whitespace-pre-wrap break-words">{msg.content}</div>
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
                  {!chat.messages?.length ? (
                    <p className="text-xs text-teal-900/55">No messages in this thread.</p>
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
