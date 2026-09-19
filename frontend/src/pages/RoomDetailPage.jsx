/**
 * @fileoverview Group room transcript — shared multi-agent channel UI.
 * Purpose: Show room members, post messages, render reply/PASS/delegate bubbles.
 * Downstream: GET/POST /api/rooms/:id(/messages).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { AgentAvatar } from "../components/AgentAvatar.jsx";

/**
 * @param {object} msg
 * @returns {boolean}
 */
function isIconOnly(msg) {
  return msg?.meta?.ui === "icon";
}

/**
 * @param {object} msg
 * @returns {string}
 */
function speakerLabel(msg) {
  if (msg.role === "user") return "You";
  if (msg.meta?.fromAgentName) return String(msg.meta.fromAgentName);
  if (msg.role === "agent") return "Agent";
  if (msg.role === "system") return "System";
  return msg.role || "Message";
}

/**
 * @param {object[]} msgs
 * @returns {boolean}
 */
function hasPendingTurn(msgs) {
  return (msgs || []).some((m) => m?.meta?.kind === "room_turn_pending");
}

export function RoomDetailPage() {
  const { roomId } = useParams();
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef(null);
  const pollRef = useRef(0);
  const turnPending = hasPendingTurn(messages);

  const load = useCallback(async () => {
    if (!roomId) return;
    try {
      const data = await api(`/api/rooms/${roomId}?limit=100`);
      setRoom(data.room);
      setMessages(data.messages || []);
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [roomId]);

  // Why: while members are answering, poll every 2s; otherwise every 8s.
  useEffect(() => {
    void load();
    const ms = turnPending ? 2000 : 8000;
    pollRef.current = window.setInterval(() => void load(), ms);
    return () => window.clearInterval(pollRef.current);
  }, [load, turnPending]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send(e) {
    e.preventDefault();
    const content = draft.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Why: server returns as soon as the user bubble is saved; turn runs in background.
      const data = await api(`/api/rooms/${roomId}/messages`, {
        method: "POST",
        body: JSON.stringify({ content }),
        timeoutMs: 30_000,
      });
      setDraft("");
      if (data.messages) setMessages(data.messages);
      else await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const members = room?.participantAgents || [];

  return (
    <div
      className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col px-3 py-3 sm:px-4 sm:py-4"
      data-chat-shell
    >
      <div className="mb-3 flex shrink-0 flex-col gap-2 border-b border-teal-100 pb-3">
        <div className="flex items-center gap-2">
          <Link
            to="/rooms"
            className="text-sm font-semibold text-teal-700 hover:underline"
          >
            ← Rooms
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight sm:text-xl">
            {room?.title || "Room"}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {members.map((a) => (
            <span
              key={a._id || a}
              className="inline-flex items-center gap-1.5 rounded-full border border-teal-100 bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-900"
            >
              <AgentAvatar agent={typeof a === "object" ? a : null} size="sm" />
              {typeof a === "object" ? a.name : String(a)}
            </span>
          ))}
        </div>
        <p className="text-xs text-teal-900/60">
          Members reply or PASS. Example:{" "}
          <code className="text-[0.7rem]">@Content Inspector open mellow.io</code>
        </p>
        {turnPending ? (
          <p className="text-xs font-semibold text-amber-800">Members are responding…</p>
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

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loading && !messages.length ? (
          <p className="text-sm text-teal-900/60">Loading…</p>
        ) : null}
        <ul className="flex flex-col gap-2 pb-4">
          {messages.map((msg) => {
            if (isIconOnly(msg)) {
              return (
                <li
                  key={msg._id}
                  className="px-1 text-[0.7rem] text-teal-800/50"
                  title={msg.content}
                >
                  {msg.content}
                </li>
              );
            }
            const mine = msg.role === "user";
            return (
              <li
                key={msg._id}
                className={`max-w-[92%] rounded-2xl px-3 py-2 text-sm shadow-sm ${
                  mine
                    ? "ml-auto bg-teal-700 text-white"
                    : msg.role === "system"
                      ? "border border-teal-100 bg-teal-50/80 text-teal-900/80"
                      : "border border-teal-100 bg-white text-teal-950"
                }`}
              >
                {!mine ? (
                  <div className="mb-0.5 text-[0.65rem] font-bold uppercase tracking-wide opacity-70">
                    {speakerLabel(msg)}
                  </div>
                ) : null}
                <div className="whitespace-pre-wrap break-words">{msg.content}</div>
              </li>
            );
          })}
        </ul>
        <div ref={bottomRef} />
      </div>

      <form
        onSubmit={send}
        className="shrink-0 border-t border-teal-100 bg-white pt-3"
      >
        <textarea
          className="min-h-[5.5rem] w-full resize-y rounded-2xl border border-teal-200 px-3 py-2 text-sm"
          placeholder="Message the room… (@mention someone for work)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
        />
        <div className="mt-2 flex justify-end">
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            className="min-h-11 rounded-xl bg-teal-700 px-5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Sending…" : "Send"}
          </button>
        </div>
      </form>
    </div>
  );
}
