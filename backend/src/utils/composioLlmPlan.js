/**
 * @fileoverview LLM planner for Composio / connected-app step lists.
 * Purpose: Understand compound chat (“check email and give me update”) as one step,
 * not blind “and” splits. Heuristic planComposioMultiSteps remains the fallback.
 * Downstream: chatAutoTurn deterministic Composio; scheduler Composio ticks.
 */

import { llmChatCompletion } from "./llmChat.js";
import {
  COMPOSIO_INTENT_SPECS,
  planComposioMultiSteps,
  parseEmailRecipient,
} from "./composioAutoRuntime.js";

const SPEC_IDS = new Set(COMPOSIO_INTENT_SPECS.map((s) => s.id));

/**
 * True when the ask may need semantic planning (compound wording).
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeCompoundComposioAsk(text) {
  const t = String(text || "").trim();
  if (!t) return false;
  if (/\b(and|then|also|after\s+that|plus)\b/i.test(t)) return true;
  return planComposioMultiSteps(t).length >= 2;
}

/**
 * Collapse accidental duplicate consecutive intent steps (same specId).
 * @param {object[]} steps
 * @returns {object[]}
 */
export function collapseDuplicateComposioSteps(steps) {
  const list = Array.isArray(steps) ? steps : [];
  /** @type {object[]} */
  const out = [];
  for (const s of list) {
    const prev = out[out.length - 1];
    if (
      prev &&
      prev.kind === "intent" &&
      s.kind === "intent" &&
      prev.specId &&
      prev.specId === s.specId
    ) {
      continue;
    }
    if (
      prev &&
      prev.kind === s.kind &&
      prev.kind !== "intent" &&
      prev.toolkit === s.toolkit
    ) {
      continue;
    }
    out.push(s);
  }
  return out;
}

/**
 * Normalize one LLM step into a ComposioPlanStep.
 * @param {any} raw
 * @param {string} userText
 * @returns {object|null}
 */
function normalizeLlmStep(raw, userText) {
  if (!raw || typeof raw !== "object") return null;
  let kind = String(raw.kind || "").trim().toLowerCase();
  let specId = String(raw.specId || raw.spec_id || "").trim();
  let toolkit = String(raw.toolkit || "").trim().toLowerCase();
  const label = String(raw.label || "").trim();
  const stepText = String(raw.userText || raw.goal || userText || "").trim() || userText;
  const usePriorContent = Boolean(raw.usePriorContent ?? raw.use_prior_content);
  const to = String(raw.to || parseEmailRecipient(stepText) || "").trim();

  if (kind === "send_email") {
    return {
      kind: "send_email",
      label: label || (to ? `Email ${to}` : "Email"),
      userText: stepText,
      toolkit: "gmail",
      to,
      usePriorContent: usePriorContent || Boolean(to),
    };
  }
  if (kind === "send_slack" || (toolkit === "slack" && kind !== "intent")) {
    return {
      kind: "send_slack",
      label: label || "Slack message",
      userText: stepText,
      toolkit: "slack",
      usePriorContent,
    };
  }

  if (!specId && toolkit === "gmail") specId = "gmail_unread";
  if (!specId && toolkit === "notion") {
    specId = /\b(update|add|create|write)\b/i.test(stepText) ? "notion_write" : "notion_fetch";
  }
  if (!specId && toolkit === "googlesheets") specId = "sheets_list";
  if (!specId && toolkit === "slack") {
    return {
      kind: "send_slack",
      label: label || "Slack message",
      userText: stepText,
      toolkit: "slack",
      usePriorContent,
    };
  }

  if (!SPEC_IDS.has(specId)) {
    // Map common aliases
    const alias = {
      gmail: "gmail_unread",
      unread: "gmail_unread",
      inbox: "gmail_unread",
      sheets: "sheets_list",
      spreadsheet: "sheets_list",
      notion: "notion_fetch",
    };
    specId = alias[specId] || alias[toolkit] || "";
  }
  if (!SPEC_IDS.has(specId)) return null;

  const spec = COMPOSIO_INTENT_SPECS.find((s) => s.id === specId);
  return {
    kind: "intent",
    label: label || spec?.label || specId,
    userText: stepText,
    toolkit: spec?.toolkit || toolkit || "",
    specId,
    usePriorContent,
  };
}

/**
 * Ask the chat LLM for a Composio step plan (JSON only).
 * @param {string} userText
 * @param {{ apiKey?: string, llmBaseUrl?: string, llmModel?: string, openAiAccountId?: string }} creds
 * @returns {Promise<object[]|null>}
 */
export async function planComposioStepsWithLlm(userText, creds) {
  const text = String(userText || "").trim();
  if (!text || !creds?.apiKey) return null;

  const specList = COMPOSIO_INTENT_SPECS.map((s) => `${s.id} (${s.toolkit})`).join(", ");
  const system = [
    "You plan YamBot connected-app (Composio) steps. Reply with JSON only, no markdown.",
    `Allowed intent specId values: ${specList}`,
    'Also allowed kinds: "send_email" (needs to), "send_slack".',
    "Schema: {\"steps\":[{\"kind\":\"intent|send_email|send_slack\",\"specId\":\"...\",\"toolkit\":\"...\",\"label\":\"...\",\"userText\":\"...\",\"usePriorContent\":false,\"to\":\"\"}]}",
    "Rules:",
    '- \"check email and give me update/summary\" = ONE gmail_unread step — do NOT invent a second step for \"update\".',
    "- Only emit multiple steps when the user wants different actions in sequence (e.g. list a Sheet THEN email it; fetch Notion THEN Slack).",
    "- Prefer the fewest steps that satisfy the ask.",
    "- If this is not a connected-app ask, return {\"steps\":[]}.",
  ].join("\n");

  const raw = await llmChatCompletion({
    apiKey: creds.apiKey,
    baseUrl: creds.llmBaseUrl || "",
    model: creds.llmModel || "",
    openAiAccountId: creds.openAiAccountId,
    temperature: 0,
    maxTokens: 500,
    timeoutMs: 25_000,
    messages: [
      { role: "system", content: system },
      { role: "user", content: text },
    ],
  });

  const cleaned = String(raw || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  /** @type {any} */
  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
  const stepsIn = Array.isArray(parsed?.steps) ? parsed.steps : [];
  /** @type {object[]} */
  const steps = [];
  for (const row of stepsIn.slice(0, 6)) {
    const n = normalizeLlmStep(row, text);
    if (n) steps.push(n);
  }
  return collapseDuplicateComposioSteps(steps);
}

/**
 * Prefer LLM plan for compound asks; fall back to heuristic (+ collapse dupes).
 * @param {string} userText
 * @param {{ apiKey?: string, llmBaseUrl?: string, llmModel?: string, openAiAccountId?: string }|null} [creds]
 * @returns {Promise<object[]>}
 */
export async function resolveComposioPlan(userText, creds = null) {
  const text = String(userText || "").trim();
  const heuristic = collapseDuplicateComposioSteps(planComposioMultiSteps(text));

  if (!looksLikeCompoundComposioAsk(text) || !creds?.apiKey) {
    return heuristic;
  }

  try {
    const llmPlan = await planComposioStepsWithLlm(text, creds);
    if (Array.isArray(llmPlan) && llmPlan.length > 0) {
      return collapseDuplicateComposioSteps(llmPlan);
    }
    // LLM said no connected-app steps — keep heuristic only if it still looks useful.
    if (Array.isArray(llmPlan) && llmPlan.length === 0 && heuristic.length <= 1) {
      return heuristic;
    }
  } catch (err) {
    console.warn("[composioLlmPlan] plan failed:", err?.message || err);
  }
  return heuristic;
}
