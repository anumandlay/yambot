/**
 * @fileoverview Runs parallel completion follow-ups after goal/trigger tasks finish.
 * Purpose: LLM or rule pick → enqueue multiple instructions/goals on different agents.
 * Downstream: worker task complete handler.
 */

import { Goal, buildGoalRunText } from "../models/Goal.js";
import { Agent } from "../models/Agent.js";
import { Message } from "../models/Chat.js";
import { enqueueTask } from "./enqueueTask.js";
import { resolveLlmCredentials } from "./llmCredentials.js";
import { llmChatCompletion } from "./llmChat.js";
import {
  actionMatchesRunOn,
  formatParentContextBlock,
  pickCompletionActionsByRules,
  renderCompletionTemplate,
} from "./completionActions.js";

/**
 * @param {string} raw
 * @returns {object|null}
 */
function parsePickJson(raw) {
  const text = String(raw || "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const brace = candidate.match(/\{[\s\S]*\}/);
    if (!brace) return null;
    try {
      return JSON.parse(brace[0]);
    } catch {
      return null;
    }
  }
}

/**
 * @param {object} user
 * @param {import('./completionActions.js').CompletionAction[]} candidates
 * @param {{ goal: string, summary: string, error?: string, success: boolean }} ctx
 * @returns {Promise<import('./completionActions.js').CompletionAction[]>}
 */
async function pickCompletionActionsWithLlm(user, candidates, ctx) {
  if (!candidates.length) return [];
  const creds = await resolveLlmCredentials(user);
  if (!creds.apiKey) return pickCompletionActionsByRules(candidates, ctx);

  const lines = candidates.map(
    (a, i) =>
      `${i + 1}. label: "${a.label}" | runOn: ${a.runOn} | kind: ${a.kind}${
        a.when ? ` | when: ${a.when}` : " | when: (always if parent outcome matches)"
      }`
  );

  const messages = [
    {
      role: "system",
      content:
        "You select which follow-up actions should run after a browser agent task completes. " +
        "Pick zero or more labels (parallel execution). Reply JSON only: " +
        '{"labels":["label1","label2"],"reason":"short plain English"}',
    },
    {
      role: "user",
      content: [
        `Parent task goal:\n${String(ctx.goal || "").slice(0, 1500)}`,
        `Run success: ${ctx.success !== false}`,
        ctx.error ? `Error: ${String(ctx.error).slice(0, 500)}` : "",
        `Agent result:\n${String(ctx.summary || "").slice(0, 2500)}`,
        `\nCandidate follow-ups (select any that should run now):\n${lines.join("\n")}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];

  try {
    const raw = await llmChatCompletion({
      apiKey: creds.apiKey,
      baseUrl: creds.llmBaseUrl,
      model: creds.llmModel,
      openAiAccountId: creds.openAiAccountId,
      messages,
      temperature: 0,
      maxTokens: 320,
      timeoutMs: 25_000,
    });
    const parsed = parsePickJson(raw);
    const labels = Array.isArray(parsed?.labels)
      ? parsed.labels.map((l) => String(l || "").trim()).filter(Boolean)
      : [];
    if (!labels.length) return [];
    const labelSet = new Set(labels);
    return candidates.filter((a) => labelSet.has(a.label));
  } catch (err) {
    console.error("[completionActionsRunner] LLM pick failed", err?.message || err);
    return pickCompletionActionsByRules(candidates, ctx);
  }
}

/**
 * @param {import('./completionActions.js').CompletionAction} action
 * @param {{
 *   userId: string,
 *   task: object,
 *   success: boolean,
 *   summary: string,
 *   error?: string,
 *   source: 'goal'|'trigger',
 *   sourceId: string,
 *   sourceName: string,
 * }} opts
 */
async function enqueueCompletionAction(action, opts) {
  const ctx = {
    goal: opts.task.goal,
    summary: opts.summary,
    error: opts.error,
    success: opts.success,
    sourceName: opts.sourceName,
  };
  const parentBlock = formatParentContextBlock(ctx);

  let agentId = action.agentId || null;
  let goalText = "";
  let goalRef = null;

  if (action.kind === "goal") {
    const goalDoc = await Goal.findOne({ _id: action.goalId, user: opts.userId });
    if (!goalDoc) return null;
    goalRef = goalDoc._id;
    if (!agentId && goalDoc.agent) agentId = String(goalDoc.agent);
    const childGoal = buildGoalRunText(goalDoc);
    goalText = `${parentBlock}\n\n${childGoal}`.trim();
  } else {
    const body = renderCompletionTemplate(action.instructions, ctx);
    goalText = `${parentBlock}\n\n${body}`.trim();
  }

  if (!agentId) {
    agentId = opts.task.agent ? String(opts.task.agent) : null;
  }
  if (!agentId || !goalText) return null;

  const agentOk = await Agent.exists({ _id: agentId, user: opts.userId });
  if (!agentOk) return null;

  const chatTitle = `Follow-up · ${opts.sourceName} · ${action.label}`.slice(0, 80);
  return enqueueTask({
    userId: opts.userId,
    agentId,
    goalText,
    goalRef,
    triggerRef: opts.source === "trigger" ? opts.sourceId : null,
    chatTitle,
    priority: "normal",
    source: `completion_action:${opts.source}:${opts.sourceId}`,
    meta: {
      completionAction: true,
      completionActionLabel: action.label,
      parentTaskId: String(opts.task._id),
      parentSource: opts.source,
      parentSourceId: opts.sourceId,
    },
  });
}

/**
 * Picks and runs completion actions in parallel (best-effort).
 * @param {{
 *   user: object,
 *   userId: string,
 *   task: object,
 *   success: boolean,
 *   summary: string,
 *   error?: string,
 *   source: 'goal'|'trigger',
 *   sourceId: string,
 *   sourceName: string,
 *   completionActionsEnabled: boolean,
 *   completionActionsPickMode: import('./completionActions.js').CompletionActionsPickMode,
 *   completionActions: import('./completionActions.js').CompletionAction[],
 * }} opts
 * @returns {Promise<{ picked: import('./completionActions.js').CompletionAction[], enqueued: number }|null>}
 */
export async function processCompletionActions(opts) {
  if (!opts.completionActionsEnabled || !opts.completionActions?.length) return null;

  const runOnPool = opts.completionActions.filter((a) =>
    actionMatchesRunOn(a, opts.success)
  );
  if (!runOnPool.length) return { picked: [], enqueued: 0 };

  let picked =
    opts.completionActionsPickMode === "llm"
      ? await pickCompletionActionsWithLlm(opts.user, runOnPool, {
          goal: opts.task.goal,
          summary: opts.summary,
          error: opts.error,
          success: opts.success,
        })
      : pickCompletionActionsByRules(runOnPool, {
          goal: opts.task.goal,
          summary: opts.summary,
          error: opts.error,
          success: opts.success,
        });

  if (!picked.length) return { picked: [], enqueued: 0 };

  const results = await Promise.allSettled(
    picked.map((action) => enqueueCompletionAction(action, opts))
  );
  const enqueued = results.filter((r) => r.status === "fulfilled" && r.value).length;

  if (opts.task.chat && enqueued > 0) {
    const lines = picked.map((a) => `• ${a.label} (${a.kind})`).join("\n");
    await Message.create({
      chat: opts.task.chat,
      role: "system",
      content: `Completion actions started (${enqueued} parallel):\n${lines}`,
      meta: {
        kind: "completion_actions",
        taskId: opts.task._id,
        source: opts.source,
        sourceId: opts.sourceId,
        labels: picked.map((a) => a.label),
        enqueued,
      },
    }).catch(() => {});
  }

  return { picked, enqueued };
}
