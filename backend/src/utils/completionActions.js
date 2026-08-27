/**
 * @fileoverview Completion follow-up actions — normalize, rule match, template render.
 * Purpose: After goal/trigger task completes, pick parallel follow-ups (instructions or goals).
 * Downstream: completionActionsRunner.js, Goal/Trigger models, goals/triggers API.
 */

/** @typedef {'success'|'failure'|'both'} CompletionRunOn */
/** @typedef {'instruction'|'goal'} CompletionActionKind */
/** @typedef {'rules'|'llm'} CompletionActionsPickMode */

/**
 * @typedef {{
 *   label: string,
 *   runOn: CompletionRunOn,
 *   when: string,
 *   kind: CompletionActionKind,
 *   agentId: string,
 *   goalId: string,
 *   instructions: string,
 * }} CompletionAction
 */

const RUN_ON_VALUES = new Set(["success", "failure", "both"]);
const KIND_VALUES = new Set(["instruction", "goal"]);
const PICK_MODES = new Set(["rules", "llm"]);

/**
 * @param {unknown} raw
 * @returns {CompletionAction[]}
 */
export function normalizeCompletionActions(raw) {
  if (!Array.isArray(raw)) return [];
  /** @type {CompletionAction[]} */
  const out = [];
  for (const row of raw.slice(0, 20)) {
    if (!row || typeof row !== "object") continue;
    const label = String(row.label || "").trim().slice(0, 80);
    const runOn = RUN_ON_VALUES.has(row.runOn) ? row.runOn : "success";
    const when = String(row.when || "").trim().slice(0, 500);
    const kind = KIND_VALUES.has(row.kind) ? row.kind : "instruction";
    const agentId = String(row.agentId || row.agent || "").trim();
    const goalId = String(row.goalId || row.goal || "").trim();
    const instructions = String(row.instructions || row.text || "").trim().slice(0, 4000);
    if (!label) continue;
    if (kind === "goal" && !goalId) continue;
    if (kind === "instruction" && !instructions && !goalId) continue;
    out.push({ label, runOn, when, kind, agentId, goalId, instructions });
  }
  return out;
}

/**
 * @param {unknown} value
 * @returns {CompletionActionsPickMode}
 */
export function normalizeCompletionActionsPickMode(value) {
  const v = String(value || "").trim();
  return PICK_MODES.has(v) ? /** @type {CompletionActionsPickMode} */ (v) : "rules";
}

/**
 * @param {CompletionAction} action
 * @param {boolean} success
 * @returns {boolean}
 */
export function actionMatchesRunOn(action, success) {
  if (action.runOn === "both") return true;
  if (action.runOn === "success") return success;
  if (action.runOn === "failure") return !success;
  return false;
}

/**
 * @param {string} when
 * @param {string} blob
 * @returns {boolean}
 */
export function matchWhenRule(when, blob) {
  const rule = String(when || "").trim();
  if (!rule) return true;
  const text = String(blob || "");
  if (!text) return false;

  const slash = rule.match(/^\/(.+)\/([a-z]*)$/i);
  if (slash) {
    try {
      return new RegExp(slash[1], slash[2] || "i").test(text);
    } catch {
      return false;
    }
  }

  const parts = rule.split(/\||;/).map((p) => p.trim()).filter(Boolean);
  if (!parts.length) return true;
  const lower = text.toLowerCase();
  return parts.some((p) => lower.includes(p.toLowerCase()));
}

/**
 * Rule-based selection from configured actions.
 * @param {CompletionAction[]} actions
 * @param {{ success: boolean, summary: string, error?: string, goal?: string }} ctx
 * @returns {CompletionAction[]}
 */
export function pickCompletionActionsByRules(actions, ctx) {
  const blob = [ctx.goal, ctx.summary, ctx.error].filter(Boolean).join("\n");
  return (actions || []).filter((action) => {
    if (!actionMatchesRunOn(action, ctx.success)) return false;
    return matchWhenRule(action.when, blob);
  });
}

/**
 * Substitutes parent run context into follow-up text.
 * @param {string} template
 * @param {{ goal?: string, summary?: string, error?: string, success?: boolean, sourceName?: string }} ctx
 * @returns {string}
 */
export function renderCompletionTemplate(template, ctx) {
  const map = {
    "{{result}}": String(ctx.summary || ""),
    "{{summary}}": String(ctx.summary || ""),
    "{{error}}": String(ctx.error || ""),
    "{{goal}}": String(ctx.goal || ""),
    "{{parentGoal}}": String(ctx.goal || ""),
    "{{success}}": ctx.success ? "true" : "false",
    "{{sourceName}}": String(ctx.sourceName || ""),
  };
  let out = String(template || "");
  for (const [key, val] of Object.entries(map)) {
    out = out.split(key).join(val);
  }
  return out.trim();
}

/**
 * @param {{ goal?: string, summary?: string, error?: string, success?: boolean, sourceName?: string }} ctx
 * @returns {string}
 */
export function formatParentContextBlock(ctx) {
  return [
    "CONTEXT FROM PARENT RUN:",
    `Success: ${ctx.success ? "yes" : "no"}`,
    ctx.sourceName ? `Source: ${ctx.sourceName}` : "",
    ctx.goal ? `Parent goal:\n${String(ctx.goal).slice(0, 1500)}` : "",
    ctx.summary ? `Parent result:\n${String(ctx.summary).slice(0, 2000)}` : "",
    ctx.error ? `Parent error:\n${String(ctx.error).slice(0, 800)}` : "",
    "---",
  ]
    .filter(Boolean)
    .join("\n");
}
