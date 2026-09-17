/**
 * @fileoverview Compact run-status icons for operational chat messages.
 * Purpose: Replace noisy agent/system run logs with small icon chips (tooltip = full text).
 * Downstream: ChatDetailPage, FloatingChatWidget.
 */

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
  return /^(Goal queued|Queued for|Cloud computer|Plan:|Looking at:|Thinking…|Opening |Step \d|No skill matched|Skill:|→ Sent to LLM|← Received from LLM|← LLM error|Cloud agent asks:|Cloud agent:|API agent )/i.test(
    content
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
    return { icon: "↑", label: "LLM out" };
  }
  if (kind === "llm_response" || /^← Received from LLM|^← LLM error/i.test(content)) {
    return { icon: "↓", label: "LLM in" };
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
  if (kind === "operator_inject_ack") {
    return { icon: "→", label: "Injected" };
  }
  if (/^Thinking/i.test(content)) return { icon: "…", label: "Thinking" };
  if (/^Opening /i.test(content)) return { icon: "↗", label: "Navigate" };
  return { icon: "•", label: "Status" };
}

/**
 * Renders one or more operational messages as a compact icon row.
 * @param {{ messages: object[] }} props
 */
export function RunOpsIconRow({ messages }) {
  const list = Array.isArray(messages) ? messages : [];
  if (!list.length) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-1 self-start px-0.5 py-0.5"
      role="group"
      aria-label="Run status"
    >
      {list.map((m) => {
        const { icon, label } = opsIconMeta(m);
        const tip = String(m.content || label).slice(0, 500);
        return (
          <span
            key={m._id || `${label}-${tip.slice(0, 12)}`}
            title={tip}
            className="inline-flex h-7 min-w-7 cursor-default items-center justify-center rounded-full border border-teal-100 bg-teal-50/80 px-1.5 text-xs text-teal-900"
            aria-label={tip}
          >
            <span aria-hidden="true">{icon}</span>
            <span className="sr-only">{tip}</span>
          </span>
        );
      })}
    </div>
  );
}
