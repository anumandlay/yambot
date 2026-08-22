/**
 * @fileoverview Hierarchical goal planner — decompose goal into subgoals for focused execution.
 * Purpose: One upfront LLM call produces subgoals; each step focuses on the current subgoal.
 * Downstream: worker/src/agent.js task loop.
 */

import { extractFirstJsonObject, parseJsonLenient } from "../actions.js";

/**
 * Fallback single-step plan when LLM planning fails.
 * @param {string} goal
 * @returns {object}
 */
export function defaultPlan(goal) {
  return {
    subgoals: [{ id: "1", title: String(goal || "Complete goal").slice(0, 240), status: "pending" }],
    currentIndex: 0,
    source: "default",
  };
}

/**
 * Parses planner JSON from model output.
 * @param {string} raw
 * @param {string} goal
 * @returns {object}
 */
export function parsePlanResponse(raw, goal) {
  const text = String(raw || "").trim();
  const blob = extractFirstJsonObject(text) || text;
  const parsed = parseJsonLenient(blob);
  const list = Array.isArray(parsed?.subgoals) ? parsed.subgoals : Array.isArray(parsed) ? parsed : [];
  const subgoals = list
    .map((s, i) => ({
      id: String(s?.id ?? i + 1),
      title: String(s?.title ?? s ?? "").trim(),
      status: "pending",
    }))
    .filter((s) => s.title.length > 2)
    .slice(0, 10);

  if (!subgoals.length) return defaultPlan(goal);
  return { subgoals, currentIndex: 0, source: "llm" };
}

/**
 * Creates an ordered subgoal plan via one LLM call.
 * @param {{ goal: string, chatCompletion: Function, apiKey: string, baseUrl: string, model: string }} params
 * @returns {Promise<object>}
 */
export async function createGoalPlan({ goal, chatCompletion, apiKey, baseUrl, model }) {
  const trimmed = String(goal || "").trim();
  if (!trimmed) return defaultPlan(goal);

  try {
    const { content } = await chatCompletion({
      apiKey,
      baseUrl,
      model,
      messages: [
        {
          role: "system",
          content: [
            "You break browser automation goals into 3–8 ordered subgoals.",
            "Reply with ONE JSON object only (no markdown):",
            '{"subgoals":[{"id":"1","title":"Open Gmail inbox"},{"id":"2","title":"Click Compose"}, ...]}',
            "Each title is one concrete browser step or milestone. Stop before payment if the goal says so.",
          ].join("\n"),
        },
        { role: "user", content: `GOAL:\n${trimmed}` },
      ],
    });
    return parsePlanResponse(content, trimmed);
  } catch {
    return defaultPlan(trimmed);
  }
}

/**
 * Returns the active subgoal title for relevance scoring.
 * @param {object|null} plan
 * @returns {string}
 */
export function getCurrentSubgoalTitle(plan) {
  if (!plan?.subgoals?.length) return "";
  const idx = plan.currentIndex ?? 0;
  const sg = plan.subgoals[idx];
  return sg?.status === "done" ? plan.subgoals[idx + 1]?.title || "" : sg?.title || "";
}

/**
 * Formats plan for LLM user message.
 * @param {object|null} plan
 * @returns {string}
 */
export function formatPlanBlock(plan) {
  if (!plan?.subgoals?.length) return "";
  const idx = plan.currentIndex ?? 0;
  const lines = ["PLAN:"];
  for (let i = 0; i < plan.subgoals.length; i += 1) {
    const sg = plan.subgoals[i];
    const mark = sg.status === "done" ? "✓" : i === idx ? "→" : " ";
    lines.push(`  ${mark} ${sg.id}. ${sg.title}${sg.status === "done" ? " [done]" : ""}`);
  }
  const current = plan.subgoals[idx];
  if (current && current.status !== "done") {
    lines.push("", `CURRENT SUBGOAL: ${current.title}`);
  }
  return lines.join("\n");
}

/**
 * Heuristically marks subgoals complete from page state.
 * @param {object} plan
 * @param {object} pageState
 * @param {object} obs
 * @returns {object}
 */
export function updatePlanFromObservation(plan, pageState, obs) {
  if (!plan?.subgoals?.length) return plan;
  const updated = {
    ...plan,
    subgoals: plan.subgoals.map((s) => ({ ...s })),
  };
  let idx = updated.currentIndex ?? 0;
  while (idx < updated.subgoals.length && updated.subgoals[idx].status === "done") {
    idx += 1;
  }
  updated.currentIndex = idx;
  const current = updated.subgoals[idx];
  if (!current || current.status === "done") return updated;

  const title = current.title.toLowerCase();
  const url = String(obs?.url || "").toLowerCase();
  const text = String(obs?.text || "").slice(0, 2500).toLowerCase();
  let done = false;

  if (/navigate|open|go to|visit/.test(title)) {
    const tokens = title.split(/\W+/).filter((w) => w.length > 4);
    if (tokens.some((t) => url.includes(t))) done = true;
  }
  if (/search/.test(title) && (/search\?|\/search|q=/.test(url) || /results for/i.test(text))) {
    done = true;
  }
  if (/compose|write|draft/.test(title) && pageState?.ui?.modal_open) done = true;
  if (/send|submit/.test(title) && /sent|submitted|thank you|confirmation/i.test(text)) done = true;
  if (/add to cart|add to bag/.test(title) && /added|cart updated/i.test(text)) done = true;
  if (/cart|basket/.test(title) && /\/cart|\/basket|\/bag\b/.test(url)) done = true;
  if (/checkout/.test(title) && /checkout/.test(url)) done = true;
  if (/login|sign in/.test(title) && pageState?.auth?.state === "authenticated") done = true;

  if (done) {
    updated.subgoals[idx].status = "done";
    if (idx + 1 < updated.subgoals.length) updated.currentIndex = idx + 1;
  }
  return updated;
}
