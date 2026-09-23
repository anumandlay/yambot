/**
 * @fileoverview Persist chat “remember …” facts into curated MEMORY + Mem0.
 * Purpose: Auto used to only reply (or emit fake ACTION: memory) without writing.
 * Downstream: chats.js Auto/Answer reply path; Settings / Agents → View Mem0.
 */

import { looksLikeMemoryStoreRequest, extractRememberFact } from "./messageIntent.js";
import { mutateCuratedMemory } from "./curatedMemoryOps.js";

/**
 * @param {string} text
 * @returns {boolean}
 */
function looksPersonalAccountFact(text) {
  return /\b(i\s+(have|own|am|'m)|my\s+(name|car|email|phone|timezone|tz))\b/i.test(
    String(text || "")
  );
}

/**
 * Save a remember-fact from chat. Writes agent MEMORY (+ Mem0 agent) always;
 * also USER prefs (+ Mem0 USER) for personal identity lines.
 * @param {{
 *   userId: string,
 *   agentId: string,
 *   userText: string,
 * }} opts
 * @returns {Promise<{
 *   ok: boolean,
 *   skipped?: string,
 *   fact?: string,
 *   targets?: string[],
 *   reply?: string,
 * }>}
 */
export async function persistChatRememberFact(opts) {
  const userText = String(opts.userText || "").trim();
  const userId = String(opts.userId || "").trim();
  const agentId = String(opts.agentId || "").trim();
  if (!userId || !agentId) return { ok: false, skipped: "missing" };
  if (!looksLikeMemoryStoreRequest(userText)) return { ok: false, skipped: "not_remember" };

  const fact = extractRememberFact(userText);
  if (!fact || fact.length < 3) return { ok: false, skipped: "empty_fact" };

  /** @type {string[]} */
  const targets = ["memory"];
  if (looksPersonalAccountFact(userText) || looksPersonalAccountFact(fact)) {
    targets.push("user");
  }

  for (const target of targets) {
    const result = await mutateCuratedMemory({
      userId,
      agentId,
      action: "add",
      target,
      content: fact,
    });
    if (!result.success) {
      return {
        ok: false,
        skipped: result.error || "mutate_failed",
        fact,
        targets,
      };
    }
  }

  const where =
    targets.includes("user") && targets.includes("memory")
      ? "account USER prefs and this agent’s MEMORY (View Mem0)"
      : targets.includes("user")
        ? "account USER prefs (Settings → Memory)"
        : "this agent’s MEMORY (View Mem0)";

  return {
    ok: true,
    fact,
    targets,
    reply: `Got it — saved “${fact}” to ${where}.`,
  };
}

/**
 * Replace fake worker-style ACTION: memory(...) chat replies with a real ack.
 * @param {string} content
 * @param {string} [fallback]
 * @returns {string}
 */
export function sanitizeFakeMemoryActionReply(content, fallback) {
  const raw = String(content || "").trim();
  if (/^\s*ACTION\s*:\s*memory\s*\(/i.test(raw)) {
    return String(fallback || "Got it — I’ll remember that.").trim();
  }
  return raw;
}
