/**
 * @fileoverview Group room transcript — shared multi-agent channel UI.
 * Purpose: Show room members, post messages, render reply/PASS/delegate bubbles.
 * Downstream: GET/POST /api/rooms/:id(/messages).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { api } from "../lib/api.js";
import { ErrorAlert } from "../components/ErrorAlert.jsx";
import { AgentAvatar } from "../components/AgentAvatar.jsx";
import {
  getMentionComposeState,
  insertMentionAt,
  listMentionSuggestions,
} from "../lib/mentionAgent.js";

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

/**
 * @param {object|null} room
 * @returns {string}
 */
function facilitatorId(room) {
  const f = room?.facilitatorAgent;
  if (!f) return "";
  return typeof f === "object" ? String(f._id) : String(f);
}

export function RoomDetailPage() {
  const { roomId } = useParams();
  const location = useLocation();
  const roomsBase = location.pathname.startsWith("/grok") ? "/grok/rooms" : "/rooms";
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [composeCursor, setComposeCursor] = useState(0);
  const [mentionHighlight, setMentionHighlight] = useState(0);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
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

  const members = room?.participantAgents || [];
  const facId = facilitatorId(room);

  /** Room members only — @picker must not offer agents outside this room. */
  const mentionAgents = useMemo(() => {
    return (members || [])
      .filter((a) => a && typeof a === "object" && a._id && a.name)
      .map((a) => ({
        _id: String(a._id),
        name: a.name,
        skill: a.skill || "",
        mode: a.mode || "browser",
      }));
  }, [members]);

  const mentionCompose = useMemo(
    () => getMentionComposeState(draft, composeCursor),
    [draft, composeCursor]
  );

  const mentionSuggestions = useMemo(() => {
    return listMentionSuggestions(draft, mentionAgents, composeCursor);
  }, [draft, mentionAgents, composeCursor]);

  useEffect(() => {
    setMentionHighlight(0);
  }, [draft, mentionSuggestions.length, mentionCompose.start]);

  /**
   * @param {{ _id: string, name: string }} agent
   */
  function pickMentionAgent(agent) {
    const state = getMentionComposeState(draft, composeCursor);
    const start = state.open ? state.start : draft.length;
    const end = state.open ? state.end : draft.length;
    const { text, cursor } = insertMentionAt(draft, agent.name, start, end);
    setDraft(text);
    setComposeCursor(cursor);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(cursor, cursor);
    });
  }

  /**
   * @param {React.KeyboardEvent<HTMLTextAreaElement>} e
   */
  function onComposeKeyDown(e) {
    if (mentionSuggestions.length) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionHighlight((i) => (i + 1) % mentionSuggestions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionHighlight(
          (i) => (i - 1 + mentionSuggestions.length) % mentionSuggestions.length
        );
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        const state = getMentionComposeState(draft, composeCursor);
        if (!state.open) {
          /* fall through to send */
        } else {
          if (e.key === "Enter" && e.shiftKey) return;
          e.preventDefault();
          const agent = mentionSuggestions[mentionHighlight] || mentionSuggestions[0];
          if (agent) pickMentionAgent(agent);
          return;
        }
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setComposeCursor(draft.length);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.currentTarget.form?.requestSubmit();
    }
  }

  /**
   * @param {HTMLTextAreaElement} el
   */
  function syncCursor(el) {
    if (!el) return;
    setComposeCursor(el.selectionStart ?? draft.length);
  }

  async function send(e) {
    e.preventDefault();
    if (mentionSuggestions.length && mentionCompose.open) return;
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
      setComposeCursor(0);
      if (data.messages) setMessages(data.messages);
      else await load();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col px-3 py-3 sm:px-4 sm:py-4"
      data-chat-shell
    >
      <div className="mb-3 flex shrink-0 flex-col gap-2 border-b border-teal-100 pb-3">
        <div className="flex items-center gap-2">
          <Link
            to={roomsBase}
            className="text-sm font-semibold text-teal-700 hover:underline"
          >
            ← Rooms
          </Link>
          <h1 className="min-w-0 flex-1 truncate text-lg font-bold tracking-tight sm:text-xl">
            {room?.title || "Room"}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {members.map((a) => {
            const id = typeof a === "object" ? String(a._id) : String(a);
            const isFac = facId && id === facId;
            return (
              <span
                key={id}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-xs font-semibold ${
                  isFac
                    ? "border-teal-300 bg-teal-100 text-teal-950"
                    : "border-teal-100 bg-teal-50 text-teal-900"
                }`}
              >
                <AgentAvatar agent={typeof a === "object" ? a : null} size="sm" />
                {typeof a === "object" ? a.name : String(a)}
                {isFac ? (
                  <span className="text-[0.6rem] font-bold uppercase tracking-wide text-teal-700">
                    fac
                  </span>
                ) : null}
              </span>
            );
          })}
        </div>
        <p className="text-xs text-teal-900/60">
          Type <code className="text-[0.7rem]">@</code> to mention a room member. Example:{" "}
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
        <div className="relative">
          {mentionSuggestions.length ? (
            <ul
              className="absolute bottom-full left-0 z-30 mb-1 max-h-56 w-full overflow-y-auto rounded-2xl border border-teal-200 bg-white py-1 shadow-lg"
              role="listbox"
              aria-label="Mention a room member"
            >
              <li className="px-3 py-1.5 text-[0.65rem] font-bold uppercase tracking-wide text-teal-800/55">
                Room members
              </li>
              {mentionSuggestions.map((a, idx) => {
                const active = idx === mentionHighlight;
                return (
                  <li key={a._id} role="option" aria-selected={active}>
                    <button
                      type="button"
                      className={`flex min-h-11 w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                        active ? "bg-teal-100 text-teal-950" : "text-teal-950 hover:bg-teal-50"
                      }`}
                      onMouseDown={(ev) => {
                        ev.preventDefault();
                        pickMentionAgent(a);
                      }}
                      onMouseEnter={() => setMentionHighlight(idx)}
                    >
                      <AgentAvatar agent={a} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold">@{a.name}</span>
                        {a.skill ? (
                          <span className="ml-2 text-xs text-teal-800/65">{a.skill}</span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : null}
          <textarea
            ref={textareaRef}
            className="min-h-[5.5rem] w-full resize-y rounded-2xl border border-teal-200 px-3 py-2 text-sm"
            placeholder="Message the room… Enter to send, Shift+Enter for a new line, @ to mention"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              syncCursor(e.target);
            }}
            onClick={(e) => syncCursor(e.currentTarget)}
            onKeyUp={(e) => syncCursor(e.currentTarget)}
            onSelect={(e) => syncCursor(e.currentTarget)}
            onKeyDown={onComposeKeyDown}
            disabled={busy}
          />
        </div>
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
