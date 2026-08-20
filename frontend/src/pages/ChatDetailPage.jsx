/**
 * @fileoverview Single chat view — send goals, poll messages/tasks, watch live cloud screen.
 * Purpose: Live control plane UI for one browser-agent run thread (mobile-first).
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
  const bottomRef = useRef(null);

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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const waitingTask = tasks.find((t) => t.status === "waiting_user");
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
    try {
      await api(`/api/chats/${chatId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
      });
      setInput("");
      await load();
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
    try {
      await api(`/api/chats/${chatId}/tasks/${waitingTask._id}/answer`, {
        method: "POST",
        body: JSON.stringify({ answer: answer.trim() }),
      });
      setAnswer("");
      await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-3 py-4 sm:gap-4 sm:px-4 sm:py-6 md:px-6">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
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
            {chat.agent.name} · {chat.agent.skill}
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

      {/* Why: on phones show live screen first; side-by-side from lg up */}
      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
        <div className="order-1 flex flex-col gap-2 lg:order-2">
          <h2 className="text-sm font-semibold text-teal-900/80">Agent screen</h2>
          {agentId ? (
            <LiveScreen agentId={String(agentId)} />
          ) : (
            <p className="rounded-2xl border border-dashed border-teal-200 bg-white p-4 text-sm text-teal-900/70">
              This chat has no agent bound, so there is no cloud screen to show.
            </p>
          )}
        </div>

        <div className="order-2 flex min-w-0 flex-col gap-3 lg:order-1 sm:gap-4">
          {tasks[0] ? (
            <div className="break-words rounded-xl border border-teal-100 bg-white px-3 py-2 text-sm">
              Latest task: <strong>{tasks[0].status}</strong>
              {tasks[0].resultSummary ? ` — ${tasks[0].resultSummary.slice(0, 120)}` : ""}
            </div>
          ) : null}

          <div className="flex max-h-[40vh] min-h-48 flex-col gap-3 overflow-y-auto overscroll-contain rounded-2xl border border-teal-100 bg-white p-3 shadow-sm sm:max-h-[50vh] sm:p-4 md:max-h-[55vh]">
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
            <div ref={bottomRef} />
          </div>

          {waitingTask ? (
            <form
              onSubmit={sendAnswer}
              className="flex flex-col gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3"
            >
              <p className="text-sm font-semibold text-amber-950">
                Agent is waiting for your answer
              </p>
              <input
                className="min-h-11 w-full rounded-xl border border-amber-200 bg-white px-3"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Type your reply…"
              />
              <button
                type="submit"
                disabled={busy}
                className="min-h-11 w-full rounded-xl bg-amber-700 px-4 font-semibold text-white disabled:opacity-50 sm:w-auto"
              >
                Send answer
              </button>
            </form>
          ) : null}

          <form
            onSubmit={sendGoal}
            className="flex flex-col gap-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:flex-row"
          >
            <textarea
              className="min-h-24 w-full flex-1 rounded-2xl border border-teal-100 bg-white px-3 py-3 shadow-sm"
              placeholder="Goal / instructions…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
            <button
              type="submit"
              disabled={busy}
              className="min-h-11 w-full shrink-0 rounded-xl bg-teal-700 px-4 font-semibold text-white disabled:opacity-50 sm:w-auto sm:self-end"
            >
              {busy ? "Sending…" : "Send goal"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
