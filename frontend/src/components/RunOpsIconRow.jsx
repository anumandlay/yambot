/**
 * @fileoverview Compact run-status icons for operational chat messages.
 * Purpose: Replace noisy agent/system run logs with small icon chips; click opens full content in a popup.
 * Downstream: ChatDetailPage, FloatingChatWidget.
 */

import { useCallback, useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { formatChatMessageTime } from "../lib/formatDateTime.js";

/**
 * Kinds / event types that should render as icons, not full bubbles.
 * @type {Set<string>}
 */
export const OPS_ICON_KINDS = new Set([
  "queued",
  "skill_selected",
  "llm_request",
  "llm_response",
  "step",
  "api_start",
  "intent_question",
  "computer_started",
  "plan",
  "observe",
  "page",
  "thinking",
  "opening",
  "captcha",
  "human_handoff",
  "human_handoff_done",
  "late_peer_resume",
  "operator_inject_ack",
  "agent_message_in",
  "agent_message_out",
  "agent_message_timeout",
  "peer_result",
  "peer_delegated",
  "soft_wait",
  "info",
  "event",
  "curated_pull",
]);

/**
 * @param {object} message
 * @returns {boolean}
 */
export function isOpsIconMessage(message) {
  if (!message) return false;
  if (message.meta?.ui === "icon") return true;
  const kind = String(message.meta?.kind || message.meta?.type || "").trim();
  if (kind && OPS_ICON_KINDS.has(kind)) return true;
  const content = String(message.content || "");
  // Why: A2A / peer / system status lines should stay as chips even when meta.kind is missing.
  if (message.role === "system") {
    if (
      /^(→|←)\s/.test(content) ||
      /^(PEER RESULT|PEER FAILED|SOFT WAIT|Late result from|Sent to the running agent)/i.test(
        content
      ) ||
      /^Goal queued|^Queued for/i.test(content)
    ) {
      return true;
    }
  }
  return (
    /^(Goal queued|Queued for|Cloud computer|Plan:|Looking at:|Thinking…|Opening |Step \d|No skill matched|Skill:|→ Sent to LLM|← Received from LLM|← LLM error|Cloud agent asks:|Cloud agent:|API agent |PEER RESULT|PEER FAILED|SOFT WAIT)/i.test(
      content
    ) || /^(→|←)\s/.test(content)
  );
}

/**
 * @param {object} message
 * @returns {{ icon: string, label: string }}
 */
export function opsIconMeta(message) {
  const kind = String(message.meta?.kind || message.meta?.type || "").trim();
  const content = String(message.content || "");
  if (kind === "queued" || /^Goal queued|^Queued for/i.test(content)) {
    return { icon: "Q", label: "Queued" };
  }
  if (kind === "skill_selected" || /^No skill matched|^Skill:/i.test(content)) {
    return { icon: "S", label: "Skill" };
  }
  if (kind === "llm_request" || /^→ Sent to LLM/i.test(content)) {
    return { icon: "↑", label: "LLM" };
  }
  if (kind === "llm_response" || /^← Received from LLM|^← LLM error/i.test(content)) {
    return { icon: "↓", label: "LLM reply" };
  }
  if (kind === "step" || /^Step \d/i.test(content)) {
    return { icon: "▸", label: "Step" };
  }
  if (
    kind === "computer_started" ||
    kind === "api_start" ||
    /^Cloud computer|^API agent /i.test(content)
  ) {
    return { icon: "C", label: "Started" };
  }
  if (kind === "plan" || /^Plan:/i.test(content)) {
    return { icon: "P", label: "Plan" };
  }
  if (kind === "observe" || kind === "page" || /^Looking at:/i.test(content)) {
    return { icon: "O", label: "Page" };
  }
  if (kind === "intent_question") {
    return { icon: "A", label: "Answer mode" };
  }
  if (kind === "late_peer_resume" || /^Late result from/i.test(content)) {
    return { icon: "↻", label: "Late peer" };
  }
  if (kind === "operator_inject_ack" || /^Sent to the running agent/i.test(content)) {
    return { icon: "→", label: "Injected" };
  }
  if (
    kind === "agent_message_out" ||
    (/^→\s/.test(content) && !/^→ Sent to LLM/i.test(content))
  ) {
    return { icon: "↦", label: "To peer" };
  }
  if (kind === "agent_message_in" || /^←\s/.test(content)) {
    return { icon: "↤", label: "From peer" };
  }
  if (kind === "peer_result" || /^(PEER RESULT|PEER FAILED)\b/i.test(content)) {
    return { icon: "⇄", label: "Peer result" };
  }
  if (kind === "soft_wait" || /^SOFT WAIT\b/i.test(content)) {
    return { icon: "⏳", label: "Soft wait" };
  }
  if (kind === "curated_pull" || /^Memory pull/i.test(content)) {
    return { icon: "M", label: "Memory" };
  }
  if (/^Thinking/i.test(content)) return { icon: "…", label: "Thinking" };
  if (/^Opening /i.test(content)) return { icon: "↗", label: "Navigate" };
  return { icon: "•", label: "Status" };
}

/**
 * Full-content popup for one ops icon message.
 * @param {{
 *   message: object,
 *   label: string,
 *   icon: string,
 *   onClose: () => void,
 * }} props
 */
function OpsIconPopup({ message, label, icon, onClose }) {
  const titleId = useId();
  const curated = message?.meta?.kind === "curated_pull" ? message.meta?.curatedMemory : null;
  const body = String(message?.content || "").trim() || label;

  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-[110] flex items-end justify-center bg-teal-950/45 p-0 sm:items-center sm:p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[min(85dvh,36rem)] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl border border-teal-100 bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-teal-100 px-4 py-3">
          <span
            className="inline-flex h-9 min-w-9 items-center justify-center rounded-full border border-teal-100 bg-teal-50 text-sm text-teal-900"
            aria-hidden="true"
          >
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="truncate text-sm font-bold text-teal-950">
              {label}
            </h2>
            {message?.createdAt ? (
              <p className="text-xs text-teal-900/60">
                {formatChatMessageTime(message.createdAt)}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl border border-teal-100 text-lg font-bold text-teal-900"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {curated ? (
            <CuratedPullDetails curated={curated} />
          ) : (
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-teal-950">
              {body}
            </pre>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}

/**
 * Ranked memory facts pulled into this run's prompt.
 * @param {{ curated: object }} props
 */
function CuratedPullDetails({ curated }) {
  const agent = curated?.agent || {};
  const user = curated?.user || {};
  return (
    <div className="flex flex-col gap-4 text-sm text-teal-950">
      <p className="text-xs text-teal-800/70">
        Facts injected into this run (ranked). Mode{" "}
        <span className="font-semibold">{agent.mode || "—"}</span> · agent{" "}
        {agent.selected || 0}/{agent.total || 0}
        {user.total ? (
          <>
            {" "}
            · user {user.mode || "—"} {user.selected || 0}/{user.total || 0}
          </>
        ) : null}
      </p>
      <PulledList title="Agent MEMORY" rows={agent.pulled} empty="None pulled for this goal." />
      {user.total ? (
        <PulledList title="USER prefs" rows={user.pulled} empty="None pulled." />
      ) : null}
    </div>
  );
}

/**
 * @param {{ title: string, rows?: object[], empty: string }} props
 */
function PulledList({ title, rows, empty }) {
  const list = Array.isArray(rows) ? rows : [];
  return (
    <section>
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-teal-900/60">{title}</h3>
      {list.length === 0 ? (
        <p className="text-xs text-teal-900/55">{empty}</p>
      ) : (
        <ol className="space-y-2">
          {list.map((row) => (
            <li
              key={`${row.rank}-${String(row.content || "").slice(0, 40)}`}
              className="rounded-xl border border-teal-50 bg-teal-50/40 px-3 py-2"
            >
              <div className="mb-0.5 flex flex-wrap items-baseline gap-2 text-[0.7rem] font-semibold text-teal-800/60">
                <span>#{row.rank}</span>
                {typeof row.score === "number" && row.score > 0 ? (
                  <span>score {row.score.toFixed(2)}</span>
                ) : null}
              </div>
              <div className="whitespace-pre-wrap break-words">{row.content}</div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/**
 * Renders one or more operational messages as a compact icon row.
 * Click an icon to open the full message content in a popup.
 * @param {{ messages: object[] }} props
 */
export function RunOpsIconRow({ messages }) {
  const list = Array.isArray(messages) ? messages : [];
  const [openMsg, setOpenMsg] = useState(/** @type {object|null} */ (null));
  const close = useCallback(() => setOpenMsg(null), []);

  if (!list.length) return null;

  const openMeta = openMsg ? opsIconMeta(openMsg) : null;

  return (
    <>
      <div
        className="flex flex-wrap items-center gap-1.5 self-start px-0.5 py-0.5"
        role="group"
        aria-label="Run status"
      >
        {list.map((m) => {
          const { icon, label } = opsIconMeta(m);
          const tip = String(m.content || label).slice(0, 120);
          const memoryChip = m.meta?.kind === "curated_pull";
          const llmChip =
            m.meta?.kind === "llm_request" ||
            m.meta?.kind === "llm_response" ||
            /^→ Sent to LLM|^← Received from LLM|^← LLM error/i.test(String(m.content || ""));
          const chipLabel = memoryChip ? "Memory" : llmChip ? (m.meta?.kind === "llm_response" ? "LLM↓" : "LLM") : null;
          return (
            <button
              key={m._id || `${label}-${tip.slice(0, 12)}`}
              type="button"
              title={`${label} — tap for details`}
              aria-label={`${label}: ${tip}`}
              onClick={() => setOpenMsg(m)}
              className={`inline-flex h-9 min-h-9 cursor-pointer items-center justify-center rounded-full border border-teal-100 bg-teal-50/80 text-xs text-teal-900 transition hover:bg-teal-100 focus:outline-none focus:ring-2 focus:ring-teal-500/40 active:scale-95 ${
                chipLabel ? "gap-1 px-2.5 font-semibold" : "min-w-9 px-2"
              }`}
            >
              <span aria-hidden="true">{icon}</span>
              {chipLabel ? <span>{chipLabel}</span> : null}
            </button>
          );
        })}
      </div>
      {openMsg && openMeta ? (
        <OpsIconPopup
          message={openMsg}
          label={openMeta.label}
          icon={openMeta.icon}
          onClose={close}
        />
      ) : null}
    </>
  );
}
