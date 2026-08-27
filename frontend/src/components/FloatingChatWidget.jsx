/**
 * @fileoverview Collapsible chat feed for full-screen live screen (zoom modal).
 * Purpose: User watches the browser full-screen but still sees agent messages and skill picks.
 * Inputs: chatId; Downstream: GET /api/chats/:id polling.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../lib/api.js";
import { formatChatMessageTime } from "../lib/formatDateTime.js";
import { skillPickFromMessage } from "../lib/skillPick.js";
import { SkillPickNotice } from "./SkillPickNotice.jsx";
import { HelpTooltip } from "./HelpTooltip.jsx";

/**
 * @param {{
 *   chatId: string,
 *   className?: string,
 * }} props
 */
export function FloatingChatWidget({ chatId, className = "" }) {
  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState([]);
  const [chatTitle, setChatTitle] = useState("");
  const [error, setError] = useState(null);
  const listRef = useRef(null);
  const stickRef = useRef(true);

  const load = useCallback(async () => {
    if (!chatId) return;
    try {
      const data = await api(`/api/chats/${chatId}`);
      setMessages(data.messages || []);
      setChatTitle(data.chat?.title || "Chat");
      setError(null);
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
    if (!open || !stickRef.current) return;
    const el = listRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [messages, open]);

  function onListScroll() {
    const el = listRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickRef.current = gap < 48;
  }

  const recent = messages.slice(-20);

  if (!chatId) return null;

  return (
    <div
      className={`pointer-events-auto flex max-w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-white/20 bg-slate-950/90 text-white shadow-2xl backdrop-blur-md ${className}`}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-10 items-center justify-between gap-2 border-b border-white/10 px-3 py-2 text-left text-xs font-semibold"
      >
        <span className="inline-flex items-center gap-1.5 truncate">
          <span className="rounded-full bg-teal-500/30 px-2 py-0.5 text-[0.65rem] uppercase tracking-wide text-teal-100">
            Chat
          </span>
          <span className="truncate font-normal text-white/80">{chatTitle}</span>
          <HelpTooltip helpId="chat.zoomChat" size="sm" />
        </span>
        <span className="shrink-0 text-white/50">{open ? "−" : "+"}</span>
      </button>

      {open ? (
        <div
          ref={listRef}
          onScroll={onListScroll}
          className="flex max-h-[min(40dvh,18rem)] flex-col gap-2 overflow-y-auto px-3 py-2"
        >
          {error ? (
            <p className="text-xs text-red-300">
              {error.detail || error.message || "Could not load chat"}
            </p>
          ) : null}
          {!recent.length && !error ? (
            <p className="text-xs text-white/50">No messages yet.</p>
          ) : null}
          {recent.map((m) => {
            const skillPick =
              m.meta?.kind === "skill_selected" && m.meta?.skillPick
                ? m.meta.skillPick
                : skillPickFromMessage(m);
            const isSkill = m.meta?.kind === "skill_selected";
            return (
              <article
                key={m._id}
                className={`rounded-xl px-2.5 py-2 text-[0.7rem] leading-snug ${
                  m.role === "user"
                    ? "bg-teal-800/80 text-teal-50"
                    : m.role === "assistant"
                      ? "bg-teal-900/50 text-teal-50"
                      : isSkill
                        ? "border border-violet-400/30 bg-violet-950/60 text-violet-50"
                        : "bg-white/5 text-white/80"
                }`}
              >
                <div className="mb-0.5 flex items-center justify-between gap-2 text-[0.6rem] uppercase opacity-60">
                  <span>{isSkill ? "skill" : m.role}</span>
                  {m.createdAt ? (
                    <time dateTime={new Date(m.createdAt).toISOString()}>
                      {formatChatMessageTime(m.createdAt)}
                    </time>
                  ) : null}
                </div>
                {isSkill && skillPick ? (
                  <SkillPickNotice pick={skillPick} className="!border-0 !bg-transparent !p-0 !text-[0.7rem]" />
                ) : (
                  <>
                    {m.role === "user" && skillPick ? (
                      <div className="mb-1.5 [&_.rounded-xl]:border-white/20 [&_.rounded-xl]:bg-black/20 [&_.rounded-xl]:text-white">
                        <SkillPickNotice pick={skillPick} />
                      </div>
                    ) : null}
                    <p className="whitespace-pre-wrap break-words">{m.content}</p>
                  </>
                )}
              </article>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
