/**
 * @fileoverview Single chat view — send goals, poll messages/tasks, watch live cloud screen.
 * Purpose: Left thread sticks to the latest live text; right rail keeps screen + goal sticky.
 * On mobile, screen + goal stay sticky at the bottom. Stop cancels the active run.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { LiveScreen } from "../components/LiveScreen.jsx";

export function ChatDetailPage() {
  const { chatId } = useParams();
  const [chat, setChat] = useState(null);
  const [messages, setMessages] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [input, setInput] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  const threadRef = useRef(null);
  const bottomRef = useRef(null);
  /** Why: follow live agent text unless the user scrolls the thread up to read history. */
  const stickToBottomRef = useRef(true);

  const load = useCallback(async () => {
    try {
      const data = await api(`/api/chats/${chatId}`);
      setChat(data.chat);
      setMessages(data.messages || []);
      setTasks(data.tasks || []);
    } catch (err) {
      setError(err);
    }
  }, [chatId]);

  useEffect(() => {
    load();
    const id = setInterval(load, 2500);
    return () => clearInterval(id);
  }, [load]);

  /**
   * Keeps the left thread pinned to the newest messages while the agent streams.
   */
  const scrollThreadToBottom = useCallback((smooth = false) => {
    const el = threadRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      if (smooth) {
        bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      } else {
        el.scrollTop = el.scrollHeight;
      }
    });
  }, []);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    scrollThreadToBottom(false);
  }, [messages, scrollThreadToBottom]);

  function onThreadScroll() {
    const el = threadRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = gap < 96;
  }

  const waitingTask = tasks.find((t) => t.status === "waiting_user");
  const activeTask = tasks.find((t) =>
    ["pending", "running", "waiting_user"].includes(t.status)
  );
  const agentId = chat?.agent?._id || chat?.agent || null;

  /**
   * @param {React.FormEvent} e
   */
  async function sendGoal(e) {
    e.preventDefault();
    const content = input.trim();
    if (!content) return;
    setBusy(true);
    setError(null);
    stickToBottomRef.current = true;
    try {
      await api(`/api/chats/${chatId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      setInput("");
      await load();
      scrollThreadToBottom(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  /**
   * @param {React.FormEvent} e
   */
  async function sendAnswer(e) {
    e.preventDefault();
    if (!waitingTask || !answer.trim()) return;
    setBusy(true);
    stickToBottomRef.current = true;
    try {
      await api(`/api/chats/${chatId}/tasks/${waitingTask._id}/answer`, {
        method: "POST",
        body: JSON.stringify({ answer: answer.trim() }),
      });
      setAnswer("");
      await load();
      scrollThreadToBottom(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function stopAgent() {
    if (!activeTask) return;
    if (!window.confirm("Stop the agent for this chat?")) return;
    setStopping(true);
    setError(null);
    try {
      await api(`/api/chats/${chatId}/stop`, { method: "POST", body: "{}" });
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setStopping(false);
    }
  }

  const controlPanel = (
    <div className="flex min-h-0 w-full flex-col gap-2 lg:flex-1 lg:gap-3">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-teal-900/80">Agent screen</h2>
        {activeTask ? (
          <button
            type="button"
            onClick={stopAgent}
            disabled={stopping}
            className="inline-flex min-h-11 items-center rounded-xl bg-red-600 px-4 text-sm font-bold text-white disabled:opacity-50"
          >
            {stopping ? "Stopping…" : "Stop"}
          </button>
        ) : null}
      </div>

      {agentId ? (
        <LiveScreen
          agentId={String(agentId)}
          fill
          className="min-h-[36vh] flex-1 lg:min-h-0"
        />
      ) : (
        <p className="rounded-2xl border border-dashed border-teal-200 bg-white p-4 text-sm text-teal-900/70">
          This chat has no agent bound, so there is no cloud screen to show.
        </p>
      )}

      {waitingTask ? (
        <form
          onSubmit={sendAnswer}
          className="flex shrink-0 flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3"
        >
          <p className="text-sm font-semibold text-amber-950">Agent is waiting for your answer</p>
          <input
            className="min-h-11 w-full rounded-xl border border-amber-200 bg-white px-3"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Type your reply…"
          />
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 w-full rounded-xl bg-amber-700 px-4 font-semibold text-white disabled:opacity-50"
          >
            Send answer
          </button>
        </form>
      ) : null}

      <form onSubmit={sendGoal} className="flex shrink-0 flex-col gap-2">
        <textarea
          className="min-h-20 w-full rounded-2xl border border-teal-100 bg-white px-3 py-3 text-base shadow-sm lg:min-h-24"
          placeholder="Goal / instructions…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button
          type="submit"
          disabled={busy || Boolean(activeTask)}
          className="min-h-11 w-full rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50"
          title={activeTask ? "Stop the current run before sending another goal" : undefined}
        >
          {busy ? "Sending…" : activeTask ? "Running…" : "Send goal"}
        </button>
      </form>
    </div>
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-3 py-3 sm:gap-4 sm:px-4 sm:py-4 md:px-6 lg:h-[calc(100dvh-0.5rem)] lg:max-h-[calc(100dvh-0.5rem)] lg:overflow-hidden">
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">
        <Link
          to="/"
          className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-teal-100 bg-white px-3 text-sm font-semibold"
        >
          ← Chats
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight sm:text-xl">
          {chat?.title || "Chat"}
        </h1>
        {chat?.agent?.name ? (
          <span className="max-w-full truncate rounded-full border border-teal-100 bg-teal-50 px-3 py-2 text-xs font-semibold text-teal-900">
            {chat.agent.name}
            {chat.agent.skill ? ` · ${chat.agent.skill}` : ""}
          </span>
        ) : null}
      </div>

      {error ? (
        <ErrorAlert
          title={error.title}
          detail={error.detail || error.message}
          hint={error.hint}
          onClose={() => setError(null)}
        />
      ) : null}

      {tasks[0] ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 break-words rounded-xl border border-teal-100 bg-white px-3 py-2 text-sm">
          <span>
            Latest task: <strong>{tasks[0].status}</strong>
            {tasks[0].resultSummary ? ` — ${tasks[0].resultSummary.slice(0, 120)}` : ""}
          </span>
          {activeTask ? (
            <button
              type="button"
              onClick={stopAgent}
              disabled={stopping}
              className="inline-flex min-h-11 shrink-0 items-center rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 disabled:opacity-50 lg:hidden"
            >
              {stopping ? "Stopping…" : "Stop"}
            </button>
          ) : null}
        </div>
      ) : null}

      {/* Why: left thread scrolls to latest live text; right rail stays sticky with screen + goal. */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] lg:items-stretch lg:gap-5">
        <div
          ref={threadRef}
          onScroll={onThreadScroll}
          className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto rounded-2xl border border-teal-100 bg-white p-3 shadow-sm sm:p-4 lg:max-h-full"
        >
          {messages.length === 0 ? (
            <p className="text-sm text-teal-900/60">No messages yet. Send a goal on the right.</p>
          ) : null}
          {messages.map((m) => (
            <article
              key={m._id}
              className={`max-w-[95%] break-words rounded-xl px-3 py-2 text-sm sm:max-w-[85%] ${
                m.role === "user"
                  ? "self-end bg-teal-700 text-white"
                  : m.role === "assistant"
                    ? "self-start bg-teal-50 text-teal-950"
                    : "self-start bg-slate-50 text-slate-700"
              }`}
            >
              <div className="mb-1 text-[0.7rem] uppercase opacity-70">{m.role}</div>
              <div className="whitespace-pre-wrap break-words">{m.content}</div>
            </article>
          ))}
          <div ref={bottomRef} className="h-px w-full shrink-0" />
        </div>

        <aside className="hidden min-h-0 lg:sticky lg:top-0 lg:flex lg:max-h-full lg:flex-col lg:overflow-hidden lg:rounded-2xl lg:border lg:border-teal-100 lg:bg-[color-mix(in_srgb,var(--yb-bg)_88%,white)] lg:p-3 lg:shadow-sm lg:backdrop-blur-md">
          {controlPanel}
        </aside>
      </div>

      <div className="sticky bottom-0 z-30 -mx-3 mt-1 flex max-h-[55dvh] flex-col overflow-hidden border-t border-teal-100 bg-[color-mix(in_srgb,var(--yb-bg)_94%,white)] shadow-[0_-8px_24px_rgba(16,35,31,0.08)] backdrop-blur-md lg:hidden">
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pt-2 pb-2">
          {controlPanel}
        </div>
        {/* Why: same dock color into the home-indicator inset — avoids a second tinted strip under the goal box. */}
        <div
          className="shrink-0 bg-[color-mix(in_srgb,var(--yb-bg)_94%,white)]"
          style={{ height: "env(safe-area-inset-bottom, 0px)" }}
          aria-hidden
        />
      </div>
    </div>
  );
}
