/**
 * @fileoverview LLM result router — picks which outcome event to emit from task result text.
 * Purpose: After task completion, classify agent reply into a configured branch (alongside success/failure events).
 * Downstream: worker task complete handler, eventBus → triggerEngine.
 */

import { resolveLlmCredentials } from "./llmCredentials.js";
import { llmChatCompletion } from "./llmChat.js";
import { emitEvent } from "./eventBus.js";
import { Message } from "../models/Chat.js";
import { outcomeBranchEventTypes } from "./outcomeBranches.js";

/**
 * @param {string} raw
 * @returns {object|null}
 */
function parseRouterJson(raw) {
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
 * @typedef {{ eventType: string, confidence: number, reason: string, branchLabel?: string }} OutcomeRouteResult
 */

/**
 * Uses the user's LLM to pick one outcome branch from the task result.
 * @param {object} user — User document with settings
 * @param {{
 *   goal: string,
 *   summary: string,
 *   success: boolean,
 *   error?: string,
 *   branches: import('./outcomeBranches.js').OutcomeBranch[],
 * }} opts
 * @returns {Promise<OutcomeRouteResult|null>}
 */
export async function routeTaskResultWithLlm(user, opts) {
  const branches = opts.branches || [];
  if (!branches.length) return null;

  const creds = await resolveLlmCredentials(user);
  if (!creds.apiKey) return null;

  const allowed = outcomeBranchEventTypes(branches);
  const branchLines = branches
    .map(
      (b, i) =>
        `${i + 1}. eventType: "${b.eventType}" | label: ${b.label}${b.description ? ` | when: ${b.description}` : ""}`
    )
    .join("\n");

  const messages = [
    {
      role: "system",
      content:
        "You classify a browser agent's task result into exactly one outcome branch. " +
        "Reply with JSON only: " +
        '{"eventType":"<must be one of the listed eventType values>","confidence":0.0-1.0,"reason":"short plain English"}',
    },
    {
      role: "user",
      content: [
        `Task goal:\n${String(opts.goal || "").slice(0, 1500)}`,
        `Run success: ${opts.success !== false}`,
        opts.error ? `Error: ${String(opts.error).slice(0, 500)}` : "",
        `Agent result:\n${String(opts.summary || "").slice(0, 2500)}`,
        `\nOutcome branches (pick exactly one eventType):\n${branchLines}`,
      ]
        .filter(Boolean)
        .join("\n\n"),
    },
  ];

  const raw = await llmChatCompletion({
    apiKey: creds.apiKey,
    baseUrl: creds.llmBaseUrl,
    model: creds.llmModel,
    openAiAccountId: creds.openAiAccountId,
    messages,
    temperature: 0,
    maxTokens: 220,
    timeoutMs: 22_000,
  });

  const parsed = parseRouterJson(raw);
  const eventType = String(parsed?.eventType || "").trim();
  if (!eventType || !allowed.has(eventType)) return null;

  const branch = branches.find((b) => b.eventType === eventType);
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5));
  return {
    eventType,
    confidence,
    reason: String(parsed.reason || branch?.description || branch?.label || "LLM outcome pick").slice(
      0,
      300
    ),
    branchLabel: branch?.label || eventType,
  };
}

/**
 * Runs LLM outcome routing and emits the chosen event on the bus (best-effort).
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
 *   outcomeRoutingEnabled: boolean,
 *   outcomeBranches: import('./outcomeBranches.js').OutcomeBranch[],
 * }} opts
 * @returns {Promise<OutcomeRouteResult|null>}
 */
export async function processOutcomeRouting(opts) {
  if (!opts.outcomeRoutingEnabled || !opts.outcomeBranches?.length) return null;

  let pick = null;
  try {
    pick = await routeTaskResultWithLlm(opts.user, {
      goal: opts.task.goal,
      summary: opts.summary,
      success: opts.success,
      error: opts.error,
      branches: opts.outcomeBranches,
    });
  } catch (err) {
    console.error("[resultRouter] LLM outcome routing failed", err?.message || err);
    return null;
  }

  if (!pick?.eventType) return null;

  await emitEvent({
    userId: opts.userId,
    type: pick.eventType,
    source: opts.source,
    significance: "medium",
    agentId: opts.task.agent,
    goalId: opts.source === "goal" ? opts.sourceId : opts.task.goalRef || null,
    taskId: opts.task._id,
    summary: pick.reason.slice(0, 500),
    payload: {
      outcomeRouting: true,
      source: opts.source,
      sourceId: opts.sourceId,
      sourceName: opts.sourceName,
      branchLabel: pick.branchLabel,
      confidence: pick.confidence,
      reason: pick.reason,
      taskSuccess: opts.success,
      chatId: opts.task.chat ? String(opts.task.chat) : null,
      resultPreview: String(opts.summary || "").slice(0, 400),
    },
  });

  if (opts.task.chat) {
    await Message.create({
      chat: opts.task.chat,
      role: "system",
      content: `Outcome routed → ${pick.eventType} (${pick.branchLabel}): ${pick.reason}`,
      meta: {
        kind: "outcome_routed",
        taskId: opts.task._id,
        eventType: pick.eventType,
        confidence: pick.confidence,
        reason: pick.reason,
        source: opts.source,
      },
    }).catch(() => {});
  }

  return pick;
}
