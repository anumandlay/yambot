/**
 * @fileoverview Chat header control to inspect the folded session context summary.
 * Purpose: Context folds silently at ~50% fill — this modal lets operators read what the LLM sees.
 * Downstream: ChatDetailPage.
 */

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api.js";

/**
 * @param {{
 *   chatId: string,
 *   summary?: string,
 *   onUpdated?: (nextSummary: string) => void,
 * }} props
 */
export function ChatContextButton({ chatId, summary = "", onUpdated }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [localSummary, setLocalSummary] = useState(String(summary || ""));

  useEffect(() => {
    setLocalSummary(String(summary || ""));
  }, [summary]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const text = String(localSummary || "").trim();
  const hasText = Boolean(text);

  async function copyText() {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }

  async function summarizeNow() {
    if (!chatId || busy) return;
    setBusy(true);
    setError("");
    try {
      const data = await api(`/api/chats/${chatId}/summarize`, {
        method: "POST",
        body: JSON.stringify({}),
        timeoutMs: 120000,
      });
      const next = String(data?.contextSummary || "").trim();
      setLocalSummary(next);
      if (typeof onUpdated === "function") onUpdated(next);
    } catch (err) {
      setError(String(err?.detail || err?.message || err || "Summarize failed"));
    } finally {
      setBusy(false);
    }
  }

  const modal =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-label="Chat context summary"
          >
            <button
              type="button"
              className="absolute inset-0 bg-slate-900/50"
              aria-label="Close context summary"
              onClick={() => setOpen(false)}
            />
            <div className="relative z-10 flex max-h-[min(92dvh,40rem)] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-teal-200 bg-white text-teal-950 shadow-2xl sm:rounded-2xl">
              <div className="flex shrink-0 items-start justify-between gap-2 border-b border-teal-100 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-base font-semibold text-teal-950">Chat context</p>
                  <p className="mt-0.5 text-[0.75rem] text-teal-900/65">
                    Folded summary used when the thread fills ~50% of the model window (not shown as a
                    bubble).
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void summarizeNow()}
                    className="rounded-lg border border-teal-200 px-2.5 py-1.5 text-xs font-semibold text-teal-950 hover:bg-teal-50 disabled:opacity-50"
                  >
                    {busy ? "Summarizing…" : "Summarize now"}
                  </button>
                  <button
                    type="button"
                    disabled={!hasText}
                    onClick={() => void copyText()}
                    className="rounded-lg border border-teal-200 px-2.5 py-1.5 text-xs font-semibold text-teal-950 hover:bg-teal-50 disabled:opacity-50"
                  >
                    Copy
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="rounded-lg border border-teal-200 px-2.5 py-1.5 text-xs font-semibold text-teal-950 hover:bg-teal-50"
                  >
                    Close
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-slate-50 px-4 py-3">
                {error ? (
                  <p className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                    {error}
                  </p>
                ) : null}
                {hasText ? (
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed text-slate-800">
                    {text}
                  </pre>
                ) : (
                  <p className="text-sm text-teal-900/70">
                    No folded context yet. It appears after the chat grows to about half the model
                    window, or tap <strong>Summarize now</strong>.
                  </p>
                )}
              </div>
            </div>
          </div>,
          document.body
        )
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title={hasText ? "View folded chat context summary" : "No context summary yet — open to summarize"}
        className="inline-flex min-h-9 shrink-0 items-center rounded-xl border border-teal-200 bg-white px-3 text-xs font-semibold text-teal-900 hover:bg-teal-50 sm:min-h-10 sm:text-sm"
      >
        Context
        {hasText ? (
          <span className="ml-1.5 hidden rounded-full bg-teal-100 px-1.5 py-0.5 text-[0.65rem] font-bold text-teal-800 sm:inline">
            on
          </span>
        ) : null}
      </button>
      {modal}
    </>
  );
}
