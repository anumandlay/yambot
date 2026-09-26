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

/** Cap learned examples stored per agent (oldest dropped). */
export const JEV_MAX_CASES = 80;
/** Cap user text stored on each learned case. */
export const JEV_CASE_MESSAGE_MAX = 500;
export const JEV_CASE_OUTCOMES = ["reply", "queue_goal", "composio"];

/**
 * Public redacted Jev settings for agent GET responses (includes learned cases).
 * @param {object} agent
 * @returns {object}
 */
export function publicJevSummary(agent) {
  const j = agent?.jev || {};
  const hasApiKey = Boolean(j.apiKeyEnc);
  const cases = (Array.isArray(j.cases) ? j.cases : [])
    .map((c) => ({
      id: c._id ? String(c._id) : "",
      userMessage: String(c.userMessage || "").slice(0, JEV_CASE_MESSAGE_MAX),
      outcome: String(c.outcome || ""),
      reason: String(c.reason || "").slice(0, 120),
      jevGuess: String(c.jevGuess || "").slice(0, 32),
      at: c.at || null,
    }))
    .filter((c) => c.userMessage && JEV_CASE_OUTCOMES.includes(c.outcome));
  return {
    enabled: Boolean(j.enabled),
    hasApiKey,
    apiKeyMasked: hasApiKey ? "••••••••" : "",
    configured: Boolean(j.enabled && hasApiKey),
    cases,
    caseCount: cases.length,
  };
}

/**
 * Map a finished Auto turn to the Jev outcome label we want to learn.
 * Why: final path wins (Composio tools / computer queue / chat reply), not Jev’s guess.
 * @param {object|null|undefined} turn
 * @returns {"reply"|"queue_goal"|"composio"}
 */
export function outcomeFromAutoTurn(turn) {
  if (!turn || typeof turn !== "object") return "reply";
  if (turn.action === "queue_goal" || turn.action === "goal" || turn.action === "run") {
    return "queue_goal";
  }
  const reason = String(turn.reason || "");
  const path = String(turn.timing?.path || "");
  const lookups = Array.isArray(turn.timing?.lookups) ? turn.timing.lookups : [];
  if (
    lookups.some((l) => /composio/i.test(String(l))) ||
    /composio/i.test(reason) ||
    /composio/i.test(path)
  ) {
    return "composio";
  }
  return "reply";
}

/**
 * Normalize user text for case dedupe.
 * @param {string} text
 * @returns {string}
 */
function normalizeJevCaseKey(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .slice(0, JEV_CASE_MESSAGE_MAX);
}

/**
 * Append one learned case from a finished Auto turn (when Jev is enabled on the agent).
 * @param {object} agent — mongoose Agent doc
 * @param {{
 *   userText: string,
 *   outcome?: string,
 *   turn?: object,
 *   reason?: string,
 *   jevGuess?: string,
 * }} opts
 * @returns {Promise<object|null>} public case or null if skipped
 */
export async function appendJevLearningCase(agent, opts = {}) {
  if (!agent || !agent.jev?.enabled) return null;
  const userMessage = String(opts.userText || "").trim().slice(0, JEV_CASE_MESSAGE_MAX);
  if (!userMessage) return null;
  const outcome = JEV_CASE_OUTCOMES.includes(String(opts.outcome || ""))
    ? String(opts.outcome)
    : outcomeFromAutoTurn(opts.turn);
  if (!JEV_CASE_OUTCOMES.includes(outcome)) return null;
  const reason = String(opts.reason || opts.turn?.reason || "").trim().slice(0, 120);
  const jevGuess = String(
    opts.jevGuess || opts.turn?.jev?.action || opts.turn?.jev?.choice || ""
  )
    .trim()
    .slice(0, 32);

  agent.jev = agent.jev || {};
  if (!Array.isArray(agent.jev.cases)) agent.jev.cases = [];
  const key = normalizeJevCaseKey(userMessage);
  const existing = agent.jev.cases.find(
    (c) =>
      normalizeJevCaseKey(c.userMessage) === key && String(c.outcome || "") === outcome
  );
  if (existing) {
    // Why: same question + same outcome — refresh timestamp / reason, don’t grow duplicates.
    existing.at = new Date();
    if (reason) existing.reason = reason;
    if (jevGuess) existing.jevGuess = jevGuess;
    agent.markModified("jev");
    await agent.save();
    return {
      id: existing._id ? String(existing._id) : "",
      userMessage: existing.userMessage,
      outcome: existing.outcome,
      reason: existing.reason,
      jevGuess: existing.jevGuess,
      at: existing.at,
    };
  }

  agent.jev.cases.push({
    userMessage,
    outcome,
    reason,
    jevGuess,
    at: new Date(),
  });
  // Why: keep the newest N examples so evaluate state stays small.
  if (agent.jev.cases.length > JEV_MAX_CASES) {
    agent.jev.cases = agent.jev.cases.slice(-JEV_MAX_CASES);
  }
  agent.markModified("jev");
  await agent.save();
  const last = agent.jev.cases[agent.jev.cases.length - 1];
  return {
    id: last?._id ? String(last._id) : "",
    userMessage: last?.userMessage || userMessage,
    outcome,
    reason,
    jevGuess,
    at: last?.at || new Date(),
  };
}

/**
 * Remove one learned case by id.
 * @param {object} agent
 * @param {string} caseId
 * @returns {Promise<boolean>}
 */
export async function deleteJevLearningCase(agent, caseId) {
  const id = String(caseId || "").trim();
  if (!agent || !id) return false;
  const before = Array.isArray(agent.jev?.cases) ? agent.jev.cases.length : 0;
  if (!before) return false;
  agent.jev.cases = agent.jev.cases.filter((c) => String(c._id || "") !== id);
  if (agent.jev.cases.length === before) return false;
  agent.markModified("jev");
  await agent.save();
  return true;
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
 * Cap Gateway answer fields for chat meta (no secrets; avoid huge blobs).
 * @param {object} ans
 * @returns {object}
 */
function redactJevAnswerRaw(ans) {
  if (!ans || typeof ans !== "object") return {};
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [k, v] of Object.entries(ans)) {
    const key = String(k).slice(0, 48);
    if (key === "probabilities" && v && typeof v === "object") {
      out.probabilities = Object.fromEntries(
        Object.entries(v).map(([pk, pv]) => [String(pk).slice(0, 32), Number(pv) || 0])
      );
      continue;
    }
    if (typeof v === "string") {
      out[key] = v.slice(0, 2000);
      continue;
    }
    if (typeof v === "number" || typeof v === "boolean" || v == null) {
      out[key] = v;
      continue;
    }
    if (Array.isArray(v)) {
      out[key] = v.slice(0, 20).map((item) =>
        typeof item === "string"
          ? item.slice(0, 400)
          : typeof item === "number" || typeof item === "boolean"
            ? item
            : JSON.stringify(item).slice(0, 400)
      );
      continue;
    }
    if (typeof v === "object") {
      try {
        out[key] = JSON.parse(JSON.stringify(v).slice(0, 3000));
      } catch {
        out[key] = String(v).slice(0, 400);
      }
    }
  }
  return out;
}

/**
 * Shared evaluate payload shape for Auto routing (also stored on message meta for the Jev peek).
 * @param {string} userMessage
 * @param {{ cases?: object[] }} [opts]
 * @returns {{
 *   state: object,
 *   questions: Record<string, object>,
 * }}
 */
export function buildJevAutoEvaluatePayload(userMessage, opts = {}) {
  const body = String(userMessage || "").trim().slice(0, 4000);
  const cases = (Array.isArray(opts.cases) ? opts.cases : [])
    .map((c) => ({
      user_message: String(c.userMessage || c.user_message || "")
        .trim()
        .slice(0, JEV_CASE_MESSAGE_MAX),
      correct_action: String(c.outcome || c.correct_action || "").trim(),
    }))
    .filter((c) => c.user_message && JEV_CASE_OUTCOMES.includes(c.correct_action))
    .slice(-40);

  /** @type {string[]} */
  const rules = [
    "reply = answer in chat only (no Chromium, no peer fan-out, no Composio execute this turn)",
    "queue_goal = start live computer / Chromium or message peers NOW",
    "composio = connected-app API tools (Gmail, Sheets, Slack, Drive, Notion, GitHub, etc.) — NOT the browser",
    "Past-work questions (did we open X today?) = reply",
    "Memory/preference store with URLs = reply",
    "Capability questions (can you open websites?) = reply until they name a concrete live job",
    "Imperative open/go to/visit/click/fill/log in NOW on a website = queue_goal",
    "Search inbox, send email via Gmail, list spreadsheets, Slack message, etc. = composio",
  ];
  if (cases.length) {
    rules.push(
      "learned_cases lists prior user messages with the correct_action that actually ran — when the new user_message is similar, prefer that correct_action"
    );
  }

  return {
    state: {
      product: "YamBot",
      role: "YamBot Auto router",
      user_message: body,
      rules,
      ...(cases.length ? { learned_cases: cases } : {}),
    },
    questions: {
      action: {
        type: "choice",
        instructions: cases.length
          ? "Should YamBot answer in chat (reply), start a live computer / peer task (queue_goal), or use connected-app API tools (composio)? Prefer matching learned_cases when the user_message is similar."
          : "Should YamBot answer in chat (reply), start a live computer / peer task (queue_goal), or use connected-app API tools (composio)?",
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
  };
}

/**
 * Ask Jev: REPLY in chat, QUEUE_GOAL (computer/peers), or COMPOSIO (connected apps).
 * @param {string} text
 * @param {{
 *   enabled?: boolean,
 *   apiKey?: string,
 *   jevMode?: "auto"|"on"|"off",
 *   cases?: object[],
 * }} [opts]
 * @returns {Promise<{
 *   ok: boolean,
 *   action: "reply"|"queue_goal"|"composio"|"uncertain",
 *   choice: string,
 *   confidence: number,
 *   probabilities: Record<string, number>,
 *   reason: string,
 *   error?: string,
 *   evaluate?: object,
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

  const payload = buildJevAutoEvaluatePayload(body, { cases: opts.cases });

  try {
    const result = await jevEvaluate({
      apiKey,
      state: payload.state,
      questions: payload.questions,
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

    const evaluate = {
      model: String(result.model || env.JEV_MODEL || "typesafe-ai/jev").slice(0, 120),
      state: payload.state,
      questions: payload.questions,
      answer: {
        choice,
        probabilities: probs,
        // Why: keep Gateway extras (e.g. rationale) for the detailed J peek.
        raw: redactJevAnswerRaw(ans),
      },
      usage: result.usage
        ? {
            promptTokens: Number(result.usage.promptTokens ?? result.usage.prompt_tokens) || null,
            completionTokens:
              Number(result.usage.completionTokens ?? result.usage.completion_tokens) || null,
            totalTokens: Number(result.usage.totalTokens ?? result.usage.total_tokens) || null,
          }
        : null,
    };

    const allowed = new Set(["reply", "queue_goal", "composio"]);
    if (!allowed.has(choice)) {
      return {
        ok: true,
        action: "uncertain",
        choice,
        confidence,
        probabilities: probs,
        reason: "jev_unknown_choice",
        evaluate,
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
        evaluate,
      };
    }
    return {
      ok: true,
      action: /** @type {"reply"|"queue_goal"|"composio"} */ (choice),
      choice,
      confidence,
      probabilities: probs,
      reason: "jev_confident",
      evaluate,
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
      // Why: still show the question structure even when the Gateway call failed.
      evaluate: {
        model: String(env.JEV_MODEL || "typesafe-ai/jev").slice(0, 120),
        state: payload.state,
        questions: payload.questions,
        answer: { choice: "", probabilities: {} },
      },
    };
  }
}

/**
 * Redacted Jev summary for chat message meta (no API key).
 * Why: UI chips + Jev peek need choice, probabilities, and the evaluate question structure.
 * @param {object|null|undefined} jevDecision — from classifyAutoActionWithJev / turn.jev
 * @param {{ enabled?: boolean }} [opts]
 * @returns {object|undefined}
 */
export function summarizeJevForChatMeta(jevDecision, opts = {}) {
  const enabled = Boolean(opts.enabled);
  const j = jevDecision && typeof jevDecision === "object" ? jevDecision : null;
  const reason = String(j?.reason || "").trim();
  // Why: omit entirely when the agent never opted into Jev and nothing ran.
  if (!enabled && !j) return undefined;
  const used =
    Boolean(j) &&
    reason !== "" &&
    reason !== "jev_disabled" &&
    reason !== "empty" &&
    reason !== "not_called";
  const decided = reason === "jev_confident";
  /** @type {Record<string, number>} */
  const probabilities = {};
  if (j?.probabilities && typeof j.probabilities === "object") {
    for (const [k, v] of Object.entries(j.probabilities)) {
      probabilities[String(k).slice(0, 32)] = Math.max(0, Math.min(1, Number(v) || 0));
    }
  }
  /** @type {object} */
  const out = {
    enabled,
    used,
    decided,
    action: String(j?.action || "").slice(0, 32),
    choice: String(j?.choice || "").slice(0, 32),
    confidence: Math.max(0, Math.min(1, Number(j?.confidence) || 0)),
    reason: (reason || (enabled ? "not_called" : "disabled")).slice(0, 64),
    probabilities,
  };
  if (j?.error) out.error = String(j.error).slice(0, 240);
  if (j?.evaluate && typeof j.evaluate === "object") {
    out.evaluate = {
      model: String(j.evaluate.model || "").slice(0, 120),
      state: j.evaluate.state || null,
      questions: j.evaluate.questions || null,
      answer: j.evaluate.answer || {
        choice: out.choice,
        probabilities,
      },
      usage: j.evaluate.usage || null,
    };
  }
  return out;
}
