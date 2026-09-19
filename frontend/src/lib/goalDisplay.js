/**
 * @fileoverview Strip worker-only framing from goals / chat messages for human UI.
 * Purpose: Company memory + [AGENT MESSAGE] hop rules stay on Task.goal for the LLM;
 * chat bubbles and queue cards should show only the real assignment.
 * Downstream: ChatDetailPage, AgentTaskQueue, FloatingChatWidget.
 */

/**
 * Removes COMPANY MEMORY / entity context preamble prepended for workers.
 * @param {string} text
 * @returns {string}
 */
export function stripCompanyContextPreamble(text) {
  let t = String(text || "");
  if (!t) return "";
  // Why: enqueueTask joins context with `\n\n---\n\n`.
  const sep = t.search(/\n---\n+/);
  if (
    sep >= 0 &&
    (/^COMPANY MEMORY:/i.test(t) ||
      /^PRIMARY ENTITY:/i.test(t) ||
      t.includes("COMPANY MEMORY:"))
  ) {
    t = t.slice(sep).replace(/^\n---\n+/, "").trim();
  }
  return t;
}

/**
 * Removes [AGENT MESSAGE …] hop / finish instructions; keeps the real ask.
 * @param {string} text
 * @returns {string}
 */
export function stripAgentMessageFraming(text) {
  let t = String(text || "").trim();
  if (!t) return "";
  if (!/\[AGENT MESSAGE from/i.test(t) && !/^Type:\s*(task|question|approval|handoff|event)/im.test(t)) {
    return t;
  }
  const marker = "Reply with finish when done.";
  const idx = t.indexOf(marker);
  if (idx >= 0) {
    const rest = t.slice(idx + marker.length).replace(/^\s+/, "").trim();
    if (rest) return rest;
  }
  // Why: fallback — last blank-line block is usually the human task body.
  const parts = t.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (last && !/^\[AGENT MESSAGE/i.test(last) && !/^CRITICAL:/i.test(last)) {
      return last;
    }
  }
  return t;
}

/**
 * User-facing text for a chat bubble or queue row.
 * Prefers explicit clean fields from meta when present (new enqueues).
 * @param {string} content
 * @param {object} [meta]
 * @returns {string}
 */
export function humanizeGoalOrMessage(content, meta = null) {
  const fromMeta =
    String(meta?.userFacingGoal || meta?.userFacingContent || meta?.displayContent || "").trim();
  if (fromMeta) return fromMeta;
  return stripAgentMessageFraming(stripCompanyContextPreamble(content));
}
