/**
 * @fileoverview Jev (TypeSafe System One) via Vercel AI Gateway HTTP evaluate API.
 * Purpose: Fast typed decisions (reply vs queue_goal) without prose parsing.
 * Inputs: AI_GATEWAY_API_KEY (+ optional JEV_MODEL / JEV_ENABLED); user message state.
 * Downstream: chatAutoTurn runChatAutoTurn — falls back to Hermes Auto LLM when unset/failing.
 */

import { env } from "./env.js";

const GATEWAY_EVALUATE_URL = "https://ai-gateway.vercel.sh/v1/evaluate";
const DEFAULT_MODEL = "typesafe-ai/jev";
/** Why: below this, let the Auto LLM own the decision (uncertain Jev). */
export const JEV_CONFIDENT_MIN = 0.72;

/**
 * @param {"auto"|"on"|"off"|string|undefined|null} [mode]
 * @returns {boolean}
 */
export function isJevEnabled(mode = "auto") {
  const m = String(mode || "auto").trim().toLowerCase();
  if (m === "off" || m === "0" || m === "false" || m === "no") return false;
  const hasKey = Boolean(String(env.AI_GATEWAY_API_KEY || "").trim());
  if (m === "on" || m === "1" || m === "true" || m === "yes") return hasKey;
  const flag = String(env.JEV_ENABLED || "").trim().toLowerCase();
  if (flag === "0" || flag === "false" || flag === "off" || flag === "no") return false;
  return hasKey;
}

/**
 * Raw Gateway evaluate call.
 * @param {{
 *   state: string|object|unknown[],
 *   questions: Record<string, object>,
 *   model?: string,
 *   timeoutMs?: number,
 * }} opts
 * @returns {Promise<{ answers: Record<string, object>, usage?: object, model?: string }>}
 */
export async function jevEvaluate(opts) {
  const apiKey = String(env.AI_GATEWAY_API_KEY || "").trim();
  if (!apiKey) {
    const err = new Error("AI_GATEWAY_API_KEY is not configured");
    err.code = "jev_no_key";
    throw err;
  }
  const model = String(opts.model || env.JEV_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
  const timeoutMs = Math.max(2000, Number(opts.timeoutMs) || 12_000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(GATEWAY_EVALUATE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        state: opts.state,
        questions: opts.questions,
      }),
      signal: controller.signal,
    });
    const rawText = await res.text();
    let data = {};
    try {
      data = rawText ? JSON.parse(rawText) : {};
    } catch {
      data = { error: { message: rawText.slice(0, 400) } };
    }
    if (!res.ok) {
      const msg =
        data?.error?.message ||
        data?.message ||
        `Jev evaluate HTTP ${res.status}`;
      const err = new Error(msg);
      err.code = "jev_http";
      err.status = res.status;
      err.body = data;
      throw err;
    }
    return {
      answers: data.answers || {},
      usage: data.usage,
      model: data.model || model,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask Jev whether this Auto message should REPLY in chat or QUEUE_GOAL a computer/peer job.
 * @param {string} text
 * @param {{ jevMode?: "auto"|"on"|"off" }} [opts]
 * @returns {Promise<{
 *   ok: boolean,
 *   action: "reply"|"queue_goal"|"uncertain",
 *   choice: string,
 *   confidence: number,
 *   probabilities: Record<string, number>,
 *   reason: string,
 *   error?: string,
 * }>}
 */
export async function classifyAutoActionWithJev(text, opts = {}) {
  const body = String(text || "").trim().slice(0, 4000);
  if (!body) {
    return {
      ok: false,
      action: "uncertain",
      choice: "",
      confidence: 0,
      probabilities: {},
      reason: "empty",
    };
  }
  if (!isJevEnabled(opts.jevMode)) {
    return {
      ok: false,
      action: "uncertain",
      choice: "",
      confidence: 0,
      probabilities: {},
      reason: "jev_disabled",
    };
  }

  try {
    const result = await jevEvaluate({
      state: {
        product: "YamBot",
        role: "YamBot Auto router",
        user_message: body,
        rules: [
          "reply = answer in chat only (no Chromium / no peer fan-out this turn)",
          "queue_goal = start live computer or message peers NOW",
          "Past-work questions (did we open X today?) = reply",
          "Memory/preference store with URLs = reply",
          "Capability questions (can you open websites?) = reply until they name a concrete live job",
          "Imperative open/go to/visit/click/fill/log in NOW = queue_goal",
          "Gmail / Slack / Sheets / Notion / GitHub / Composio app actions (search inbox, send Slack, etc.) = reply — NOT queue_goal (apps use API tools, not the browser)",
        ],
      },
      questions: {
        action: {
          type: "choice",
          instructions:
            "Should YamBot answer in chat (reply) or start a live computer / peer task (queue_goal)?",
          criteria: {
            reply:
              "Chat answer only: greetings, past work / day history, status, memory store, preferences, planning, drafts, capability/policy, OR connected-app actions via Gmail/Slack/Sheets/Notion/GitHub/Composio (search email, send Slack, etc.). Naming a domain in a question is not enough.",
            queue_goal:
              "Live browser/computer job now: open/go to/navigate/visit a website in Chromium, click, fill, submit, log in on a page, live browse research, or message_agent / peer fan-out. Do NOT choose queue_goal for Gmail/Slack/Composio API actions.",
          },
        },
      },
      timeoutMs: 12_000,
    });

    const ans = result.answers?.action || {};
    const choice = String(ans.choice || "").trim().toLowerCase();
    const probs =
      ans.probabilities && typeof ans.probabilities === "object"
        ? Object.fromEntries(
            Object.entries(ans.probabilities).map(([k, v]) => [
              String(k),
              Number(v) || 0,
            ])
          )
        : {};
    const confidence =
      Number(probs[choice]) ||
      Math.max(0, ...Object.values(probs).map((n) => Number(n) || 0));

    if (choice !== "reply" && choice !== "queue_goal") {
      return {
        ok: true,
        action: "uncertain",
        choice,
        confidence,
        probabilities: probs,
        reason: "jev_unknown_choice",
      };
    }
    if (confidence < JEV_CONFIDENT_MIN) {
      return {
        ok: true,
        action: "uncertain",
        choice,
        confidence,
        probabilities: probs,
        reason: "jev_low_confidence",
      };
    }
    return {
      ok: true,
      action: choice,
      choice,
      confidence,
      probabilities: probs,
      reason: "jev_confident",
    };
  } catch (err) {
    return {
      ok: false,
      action: "uncertain",
      choice: "",
      confidence: 0,
      probabilities: {},
      reason: "jev_error",
      error: String(err?.message || err).slice(0, 240),
    };
  }
}
