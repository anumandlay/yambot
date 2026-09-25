/**
 * @fileoverview Hermes Phase 2 — risky Composio side-effect approval + Auto wall budget helpers.
 * Purpose: Block Gmail/Slack/Notion write tools until the user affirms; allowlist read-only tools.
 * Downstream: chatAutoTurn.js (execute + deterministic intent), chats.js (pending meta), tests.
 */

/** Wall-clock budget for one Auto tool loop (ms). */
export const AUTO_CHAT_MAX_WALL_MS = 120_000;

/**
 * Soft token budget hint for one Auto turn (provider maxTokens already caps per call).
 * Why: gives tests/ops a single constant without hard-stopping mid-stream.
 */
export const AUTO_CHAT_SOFT_MAX_TOKENS = 8_000;

/**
 * Tool-slug substrings that are treated as external side effects (send/write/mutate).
 * Why: Composio slugs use underscores — avoid \b (underscore is a word char).
 */
const RISKY_SLUG_RE =
  /(^|_)(SEND|CREATE|POST|UPDATE|DELETE|WRITE|APPEND|MODIFY|UPLOAD|INSERT|PATCH|TRASH|REMOVE|ADD_LABEL|MOVE_TO|DESTROY|PUBLISH)(_|$)/i;

/**
 * Explicit read-only allowlist patterns — these never require chat approval.
 */
const READ_ONLY_SLUG_RE =
  /(^|_)(FETCH|LIST|GET|SEARCH|FIND|READ|BATCH_GET|VALUES_GET|LOOKUP|QUERY|RETRIEVE|CHECK|STATUS|WAIT|CONNECT)(_|$)/i;

/** Deterministic intent / multi-step kinds that mutate external systems. */
const RISKY_SPEC_IDS = new Set([
  "slack_send",
  "notion_write",
  "gmail_label",
]);

const RISKY_PLAN_KINDS = new Set(["send_email", "send_slack"]);

/**
 * True when this agent should skip chat confirm for Composio SEND/write.
 * @param {object|null|undefined} agent
 * @returns {boolean}
 */
export function agentComposioAutoApprovesRisky(agent) {
  return Boolean(agent?.composio?.autoApproveRisky);
}

/**
 * True when a Composio tool slug looks read-only (search / get / list / fetch).
 * @param {string} toolSlug
 * @returns {boolean}
 */
export function isComposioReadOnlyTool(toolSlug) {
  const slug = String(toolSlug || "").trim();
  if (!slug) return false;
  if (RISKY_SLUG_RE.test(slug)) return false;
  return READ_ONLY_SLUG_RE.test(slug);
}

/**
 * True when executing this Composio tool would send/write externally and needs user confirm.
 * @param {string} toolSlug
 * @returns {boolean}
 */
export function composioToolRequiresApproval(toolSlug) {
  const slug = String(toolSlug || "").trim();
  if (!slug) return false;
  if (isComposioReadOnlyTool(slug)) return false;
  if (RISKY_SLUG_RE.test(slug)) return true;
  // Unknown slugs that are not clearly read-only: require approval (safer default).
  return !READ_ONLY_SLUG_RE.test(slug);
}

/**
 * @param {string|null|undefined} specId
 * @returns {boolean}
 */
export function composioSpecRequiresApproval(specId) {
  return RISKY_SPEC_IDS.has(String(specId || "").trim());
}

/**
 * @param {{ kind?: string, specId?: string }[]|null|undefined} plan
 * @returns {boolean}
 */
export function composioPlanRequiresApproval(plan) {
  const steps = Array.isArray(plan) ? plan : [];
  for (const step of steps) {
    if (RISKY_PLAN_KINDS.has(String(step?.kind || ""))) return true;
    if (composioSpecRequiresApproval(step?.specId)) return true;
  }
  return false;
}

/**
 * Short affirmation that unlocks a pending risky Composio action.
 * Why: reuses Auto “yes” style plus explicit “confirm send”.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeComposioRiskyConfirm(text) {
  const q = String(text || "").trim();
  if (!q || q.length > 64) return false;
  if (
    /^(yes|yep|yeah|yup|sure|ok|okay|k|do it|go ahead|please|please do|go|proceed|do that|yes please|yes do it)([!?.\s]*)$/i.test(
      q
    )
  ) {
    return true;
  }
  return /^(confirm(\s+send)?|send(\s+it)?|approve(d)?|approved)([!?.\s]*)$/i.test(q);
}

/**
 * Explicit cancel of a pending risky action.
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeComposioRiskyDeny(text) {
  const q = String(text || "").trim();
  if (!q || q.length > 64) return false;
  return /^(no|nope|cancel|stop|don'?t|do\s+not|never\s*mind|deny)([!?.\s]*)$/i.test(q);
}

/**
 * Build the chat reply that pauses the turn until the user confirms.
 * @param {{
 *   summary?: string,
 *   tool?: string,
 *   label?: string,
 * }} pending
 * @returns {string}
 */
export function formatPendingComposioApprovalReply(pending = {}) {
  const label = String(pending.label || pending.tool || "this connected-app action").trim();
  const summary = String(pending.summary || "").trim();
  const lines = [
    `I need your confirmation before I run a send/write action (${label}).`,
  ];
  if (summary) lines.push(summary.slice(0, 1200));
  lines.push('Reply "confirm send" or "yes" to proceed, or "cancel" to abort.');
  return lines.join("\n\n");
}

/**
 * Summarize tool args for the approval prompt (no huge bodies).
 * @param {string} toolSlug
 * @param {Record<string, unknown>|null|undefined} args
 * @returns {string}
 */
export function summarizeComposioExecuteForApproval(toolSlug, args) {
  const slug = String(toolSlug || "").trim() || "unknown tool";
  const a = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  const bits = [];
  for (const key of ["to", "recipient", "email", "channel", "subject", "title", "text", "body", "message", "content"]) {
    const v = a[key];
    if (v == null || v === "") continue;
    const s = String(v).replace(/\s+/g, " ").trim();
    if (!s) continue;
    bits.push(`${key}: ${s.slice(0, key === "body" || key === "text" || key === "content" || key === "message" ? 160 : 80)}`);
  }
  if (!bits.length) {
    const keys = Object.keys(a).slice(0, 6);
    if (keys.length) bits.push(`args: ${keys.join(", ")}`);
  }
  return bits.length ? `Pending: ${slug}\n${bits.join("\n")}` : `Pending: ${slug}`;
}

/**
 * @param {number} startedAtMs
 * @param {number} [nowMs]
 * @param {number} [maxMs]
 * @returns {boolean}
 */
export function isAutoWallBudgetExceeded(startedAtMs, nowMs = Date.now(), maxMs = AUTO_CHAT_MAX_WALL_MS) {
  const start = Number(startedAtMs) || 0;
  if (!start) return false;
  return Number(nowMs) - start >= Math.max(1_000, Number(maxMs) || AUTO_CHAT_MAX_WALL_MS);
}

/**
 * Clear reply when Auto stops for disconnect or wall clock.
 * @param {"abort"|"wall"} reason
 * @returns {string}
 */
export function formatAutoBudgetStopReply(reason) {
  if (reason === "abort") {
    return "Stopped — the chat disconnected before this turn finished.";
  }
  return "Stopped — this Auto turn hit the time budget. Send another message to continue.";
}

/**
 * Pull the newest pending risky Composio payload from recent messages (newest-first ok).
 * @param {{ role?: string, content?: string, meta?: object, _id?: unknown }[]} messages
 * @param {{ excludeIds?: string[] }} [opts]
 * @returns {object|null}
 */
export function resolvePendingComposioApprovalFromMessages(messages, opts = {}) {
  const exclude = new Set((opts.excludeIds || []).map((id) => String(id)));
  const rows = (Array.isArray(messages) ? messages : []).filter(
    (m) => m && !exclude.has(String(m._id || ""))
  );
  const newestFirst = [...rows].sort((a, b) => {
    const aid = String(a._id || "");
    const bid = String(b._id || "");
    if (aid && bid) return bid.localeCompare(aid);
    return 0;
  });
  for (const m of newestFirst) {
    const role = String(m?.role || "");
    if (role !== "assistant" && role !== "agent") continue;
    const pending = m?.meta?.pendingComposioApproval;
    if (pending && typeof pending === "object") return pending;
    // Why: stop at first assistant without pending — older pendings are stale.
    break;
  }
  return null;
}
