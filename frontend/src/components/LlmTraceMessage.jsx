/**
 * @fileoverview Collapsible chat bubble for LLM request/response traces.
 * Purpose: Show what was sent to / received from the model without flooding the thread.
 * Inputs: chat Message with meta.type llm_request | llm_response; Downstream: ChatDetailPage, FloatingChatWidget.
 */

import { formatChatMessageTime } from "../lib/formatDateTime.js";

/**
 * @param {{
 *   type: string,
 *   content: string,
 *   meta?: object,
 *   createdAt?: string|Date|number|null,
 *   compact?: boolean,
 * }} props
 */
export function LlmTraceMessage({
  type,
  content,
  meta,
  createdAt = null,
  compact = false,
}) {
  const isRequest = type === "llm_request";
  const model = meta?.payload?.model || meta?.model || "";
  const step = meta?.payload?.step;
  const label = isRequest ? "Sent to LLM" : "Received from LLM";
  const arrow = isRequest ? "→" : "←";
  const summary = [
    arrow,
    label,
    model ? `(${model})` : "",
    step != null ? `· step ${step}` : "",
  ]
    .filter(Boolean)
    .join(" ");

  const timeLabel = createdAt ? formatChatMessageTime(createdAt) : "";
  const timeIso = createdAt ? new Date(createdAt).toISOString() : "";

  // Why: body may start with the same header line — strip it for the expanded panel.
  const body = String(content || "")
    .replace(/^[→←]\s*(Sent to LLM|Received from LLM)[^\n]*\n*/i, "")
    .trim();

  return (
    <details
      className={`rounded-lg border ${
        isRequest
          ? "border-sky-200/80 bg-sky-50/80 text-sky-950"
          : "border-emerald-200/80 bg-emerald-50/80 text-emerald-950"
      } ${compact ? "text-[0.7rem]" : "text-xs"}`}
    >
      <summary
        className={`flex cursor-pointer list-none items-baseline justify-between gap-2 select-none font-semibold ${
          compact ? "px-2 py-1.5" : "px-2.5 py-2"
        }`}
      >
        <span className="min-w-0">
          {summary}
          {meta?.payload?.truncated ? (
            <span className="ml-1 font-normal opacity-60">(truncated)</span>
          ) : null}
        </span>
        {timeLabel ? (
          <time
            dateTime={timeIso}
            className={`shrink-0 font-normal tabular-nums opacity-60 ${
              compact ? "text-[0.6rem]" : "text-[0.7rem]"
            }`}
          >
            {timeLabel}
          </time>
        ) : null}
      </summary>
      <pre
        className={`max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-black/5 bg-black/[0.03] font-mono ${
          compact ? "px-2 py-1.5 text-[0.65rem]" : "px-2.5 py-2 text-[0.7rem]"
        }`}
      >
        {body || "(empty)"}
      </pre>
    </details>
  );
}
