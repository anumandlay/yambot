/**
 * @fileoverview Jev (TypeSafe System One) via Vercel AI Gateway HTTP evaluate API.
 * Purpose: Optional per-agent Auto router — reply vs queue_goal (computer) vs composio.
 * When the agent has Jev enabled + API key, Auto calls evaluate before the chat LLM.
 * Inputs: agent.jev.apiKeyEnc (decrypted) or opts.apiKey; optional JEV_MODEL env.
 */

import { env } from "./env.js";
import { decryptSecret } from "./crypto.js";

const GATEWAY_EVALUATE_URL = "https://ai-gateway.vercel.sh/v1/evaluate";
const DEFAULT_MODEL = "typesafe-ai/jev";
/** Why: below this, let the Auto LLM own the decision (uncertain Jev). */
export const JEV_CONFIDENT_MIN = 0.72;

/**
 * Public redacted Jev settings for agent GET responses.
 * @param {object} agent
 * @returns {{ enabled: boolean, hasApiKey: boolean, apiKeyMasked: string, configured: boolean }}
 */
export function publicJevSummary(agent) {
  const j = agent?.jev || {};
  const hasApiKey = Boolean(j.apiKeyEnc);
  return {
    enabled: Boolean(j.enabled),
    hasApiKey,
    apiKeyMasked: hasApiKey ? "••••••••" : "",
    configured: Boolean(j.enabled && hasApiKey),
  };
}

/**
 * Decrypt agent-stored Jev / AI Gateway API key (empty if missing/invalid).
 * @param {object} agent
 * @returns {string}
 */
export function decryptAgentJevApiKey(agent) {
  const enc = String(agent?.jev?.apiKeyEnc || "").trim();
  if (!enc) return "";
  try {
    return String(decryptSecret(enc) || "").trim();
  } catch {
    return "";
  }
}

/**
 * Whether Jev should run for this Auto turn.
 * Per-agent only: needs enabled + non-empty apiKey. String modes are legacy no-ops.
 * @param {{
 *   enabled?: boolean,
 *   apiKey?: string,
 *   jevMode?: "auto"|"on"|"off"|string,
 * }|string|undefined|null} [opts]
 * @returns {boolean}
 */
export function isJevEnabled(opts = {}) {
  if (opts == null || typeof opts === "string") {
    // Why: global/env Jev is retired — only per-agent { enabled, apiKey } turns it on.
    return false;
  }
  if (String(opts.jevMode || "").toLowerCase() === "off") return false;
  const apiKey = String(opts.apiKey || "").trim();
  return Boolean(opts.enabled) && Boolean(apiKey);
}

/**
 * Raw Gateway evaluate call.
 * @param {{
 *   state: string|object|unknown[],
 *   questions: Record<string, object>,
 *   model?: string,
 *   apiKey?: string,
 *   timeoutMs?: number,
 * }} opts
 * @returns {Promise<{ answers: Record<string, object>, usage?: object, model?: string }>}
 */
export async function jevEvaluate(opts) {
  const apiKey =
    String(opts.apiKey || "").trim() || String(env.AI_GATEWAY_API_KEY || "").trim();
  if (!apiKey) {
    const err = new Error("Jev API key is not configured");
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
 * Ask Jev: REPLY in chat, QUEUE_GOAL (computer/peers), or COMPOSIO (connected apps).
 * @param {string} text
 * @param {{
 *   enabled?: boolean,
 *   apiKey?: string,
 *   jevMode?: "auto"|"on"|"off",
 * }} [opts]
 * @returns {Promise<{
 *   ok: boolean,
 *   action: "reply"|"queue_goal"|"composio"|"uncertain",
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
  const apiKey = String(opts.apiKey || "").trim();
  if (
    !isJevEnabled({
      enabled: opts.enabled !== false && Boolean(apiKey),
      apiKey,
      jevMode: opts.jevMode,
    })
  ) {
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
      apiKey,
      state: {
        product: "YamBot",
        role: "YamBot Auto router",
        user_message: body,
        rules: [
          "reply = answer in chat only (no Chromium, no peer fan-out, no Composio execute this turn)",
          "queue_goal = start live computer / Chromium or message peers NOW",
          "composio = connected-app API tools (Gmail, Sheets, Slack, Drive, Notion, GitHub, etc.) — NOT the browser",
          "Past-work questions (did we open X today?) = reply",
          "Memory/preference store with URLs = reply",
          "Capability questions (can you open websites?) = reply until they name a concrete live job",
          "Imperative open/go to/visit/click/fill/log in NOW on a website = queue_goal",
          "Search inbox, send email via Gmail, list spreadsheets, Slack message, etc. = composio",
        ],
      },
      questions: {
        action: {
          type: "choice",
          instructions:
            "Should YamBot answer in chat (reply), start a live computer / peer task (queue_goal), or use connected-app API tools (composio)?",
          criteria: {
            reply:
              "Chat answer only: greetings, past work / day history, status, memory store, preferences, planning, drafts, capability/policy. Naming a domain in a question is not enough for queue_goal.",
            queue_goal:
              "Live browser/computer job now: open/go to/navigate/visit a website in Chromium, click, fill, submit, log in on a page, live browse research, or message_agent / peer fan-out. Do NOT choose queue_goal for Gmail/Slack/Sheets/spreadsheet/Composio API actions.",
            composio:
              "Connected-app actions via Gmail/Slack/Sheets/Notion/GitHub/Drive/Composio APIs (search email, send Slack, list spreadsheets, label mail, etc.). Not Chromium.",
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

    const allowed = new Set(["reply", "queue_goal", "composio"]);
    if (!allowed.has(choice)) {
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
      action: /** @type {"reply"|"queue_goal"|"composio"} */ (choice),
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
