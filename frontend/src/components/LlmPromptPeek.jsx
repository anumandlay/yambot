/**
 * @fileoverview Small “Prompt” bubble beside a user chat message.
 * Purpose: Let the user inspect the exact LLM prompt (system + history + user) for that turn.
 * Downstream: ChatDetailPage message list.
 */

import { useState } from "react";

/**
 * @param {{
 *   prompt: {
 *     mode?: string,
 *     model?: string,
 *     toolNames?: string[],
 *     note?: string,
 *     messageCount?: number,
 *     text?: string,
 *     capturedAt?: string,
 *   } | null | undefined,
 * }} props
 */
export function LlmPromptPeek({ prompt }) {
  const [open, setOpen] = useState(false);
  if (!prompt || typeof prompt !== "object") return null;
  const text = String(prompt.text || "").trim();
  if (!text) return null;

  const mode = String(prompt.mode || "").trim();
  const model = String(prompt.model || "").trim();
  const title = [mode && `mode=${mode}`, model && `model=${model}`].filter(Boolean).join(" · ");

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="relative shrink-0 self-start">
      <button
        type="button"
        title={title || "View exact LLM prompt for this message"}
        onClick={() => setOpen((v) => !v)}
        aria-label="View exact LLM prompt"
        className="flex h-4 items-center justify-center rounded border border-teal-200/80 bg-white/90 px-1 text-[0.55rem] font-medium leading-none text-teal-800/80 hover:bg-teal-50 hover:text-teal-900"
      >
        Prompt
      </button>
      {open ? (
        <div className="absolute right-0 z-30 mt-1 w-[min(92vw,28rem)] overflow-hidden rounded-xl border border-teal-200 bg-white text-teal-950 shadow-lg">
          <div className="flex items-center justify-between gap-2 border-b border-teal-100 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold">LLM prompt</p>
              {title ? <p className="truncate text-[0.65rem] text-teal-900/60">{title}</p> : null}
            </div>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => void copyText()}
                className="rounded-lg border border-teal-200 px-2 py-1 text-[0.65rem] font-semibold text-teal-900 hover:bg-teal-50"
              >
                Copy
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg border border-teal-200 px-2 py-1 text-[0.65rem] font-semibold text-teal-900 hover:bg-teal-50"
              >
                Close
              </button>
            </div>
          </div>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words bg-slate-50 px-3 py-2 font-mono text-[0.65rem] leading-relaxed text-slate-800">
            {text}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
