/**
 * @fileoverview Readable chat transcript helpers for History / archives.
 * Purpose: Hide worker ops noise (page looks, LLM schema dumps, action JSON)
 * so humans see a conversation, not the agent control protocol.
 * Downstream: AgentChatHistoryPage.
 */

import { humanizeGoalOrMessage } from "./goalDisplay.js";
import { isOpsIconMessage } from "../components/RunOpsIconRow.jsx";

/** Content that is clearly the browser/API action schema pasted into a bubble. */
const SCHEMA_NOISE_RE =
  /Action fields:|You control a real Chromium|Reply with ONE JSON object|MULTI-ACTION BATCHES|buildActionSchema|"actions"\s*:\s*\[\s*\{\s*"type"/i;

/**
 * True when this message should not appear in a human history transcript.
 * @param {object} message
 * @returns {boolean}
 */
export function isHistoryNoiseMessage(message) {
  if (!message) return true;
  if (isOpsIconMessage(message)) return true;
  const kind = String(message.meta?.kind || message.meta?.type || "").trim();
  if (
    kind &&
    /^(llm_request|llm_response|step|observe|page|plan|thinking|queued|skill_selected|computer_started|api_start)$/i.test(
      kind
    )
  ) {
    return true;
  }
  const content = String(message.content || "");
  if (SCHEMA_NOISE_RE.test(content)) return true;
  // Raw model control JSON with no user-facing prose.
  if (looksLikeActionOnlyJson(content) && !extractThought(content)) return true;
  return false;
}

/**
 * @param {string} content
 * @returns {boolean}
 */
function looksLikeActionOnlyJson(content) {
  const t = String(content || "").trim();
  if (!t.startsWith("{") || !t.includes('"type"')) return false;
  try {
    const parsed = JSON.parse(t);
    return Boolean(
      parsed &&
        typeof parsed === "object" &&
        (parsed.action || parsed.actions || parsed.type)
    );
  } catch {
    // Why: models often wrap JSON in fences or trailing prose — still noise if schema-ish.
    return /"actions"\s*:|"action"\s*:\s*\{|"type"\s*:\s*"(click|type|navigate|finish|ask_user|message_agent)"/i.test(
      t
    );
  }
}

/**
 * @param {string} content
 * @returns {string}
 */
function extractThought(content) {
  const t = String(content || "").trim();
  try {
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const raw = fence ? fence[1].trim() : t;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      const thought = String(parsed.thought || parsed.reason || "").trim();
      if (thought) return thought;
      if (parsed.action?.type === "finish" && parsed.action?.message) {
        return String(parsed.action.message).trim();
      }
      if (parsed.action?.type === "ask_user" && parsed.action?.question) {
        return String(parsed.action.question).trim();
      }
      if (Array.isArray(parsed.actions)) {
        const fin = parsed.actions.find((a) => a?.type === "finish" && a?.message);
        if (fin) return String(fin.message).trim();
        const ask = parsed.actions.find((a) => a?.type === "ask_user" && a?.question);
        if (ask) return String(ask.question).trim();
      }
    }
  } catch {
    /* not JSON */
  }
  return "";
}

/**
 * Plain text for a history bubble (no action schema / hop framing).
 * @param {string} content
 * @param {object} [meta]
 * @returns {string}
 */
export function readableHistoryContent(content, meta = null) {
  const fromThought = extractThought(String(content || ""));
  if (fromThought) return fromThought;
  return humanizeGoalOrMessage(content, meta);
}
