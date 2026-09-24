/**
 * @fileoverview Persist chat “remember …” / “forget …” facts into curated MEMORY + Mem0.
 * Purpose: Auto used to only reply (or emit fake ACTION: memory) without writing.
 * Phase 1: forget removes Mongo + Mem0; remember stamps provenance source=chat_remember.
 * Downstream: chats.js Auto/Answer reply path; Settings / Agents → View Mem0.
 */

import {
  looksLikeMemoryStoreRequest,
  extractRememberFact,
  looksLikeMemoryForgetRequest,
  extractForgetNeedle,
} from "./messageIntent.js";
import { mutateCuratedMemory } from "./curatedMemoryOps.js";

/**
 * @param {string} text
 * @returns {boolean}
 */
export function looksPersonalAccountFact(text) {
  return /\b(i\s+(have|own|am|'m)|my\s+(name|car|email|phone|timezone|tz)|owns?\s+a\b|user prefers)\b/i.test(
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
 *   messageId?: string|null,
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
      source: "chat_remember",
      sourceRef: opts.messageId || null,
      confidence: 0.95,
      messageId: opts.messageId || null,
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
 * Remove a forgotten fact from agent MEMORY (+ USER when personal) and Mem0.
 * @param {{
 *   userId: string,
 *   agentId: string,
 *   userText: string,
 *   messageId?: string|null,
 * }} opts
 * @returns {Promise<{
 *   ok: boolean,
 *   skipped?: string,
 *   needle?: string,
 *   targets?: string[],
 *   removed?: string[],
 *   reply?: string,
 * }>}
 */
export async function persistChatForgetFact(opts) {
  const userText = String(opts.userText || "").trim();
  const userId = String(opts.userId || "").trim();
  const agentId = String(opts.agentId || "").trim();
  if (!userId || !agentId) return { ok: false, skipped: "missing" };
  if (!looksLikeMemoryForgetRequest(userText)) return { ok: false, skipped: "not_forget" };

  const needle = extractForgetNeedle(userText);
  if (!needle || needle.length < 2) return { ok: false, skipped: "empty_needle" };

  /** @type {string[]} */
  const targets = ["memory", "user"];
  /** @type {string[]} */
  const removed = [];
  /** @type {string[]} */
  const hitTargets = [];

  for (const target of targets) {
    const result = await mutateCuratedMemory({
      userId,
      agentId,
      action: "remove",
      target,
      oldText: needle,
      source: "chat_forget",
      sourceRef: opts.messageId || null,
      messageId: opts.messageId || null,
    });
    if (result.success && result.removedContent) {
      removed.push(result.removedContent);
      hitTargets.push(target);
    }
  }

  // Also wipe Mem0 matches even if Mongo had no substring hit (Mem0-only facts).
  try {
    const { mem0DeleteByContent } = await import("./mem0Service.js");
    await mem0DeleteByContent({
      userId,
      agentId,
      scope: "agent",
      content: needle,
    });
    await mem0DeleteByContent({
      userId,
      scope: "user",
      content: needle,
    });
  } catch {
    /* ignore */
  }

  if (!hitTargets.length && !removed.length) {
    return {
      ok: true,
      needle,
      targets: [],
      removed: [],
      reply: `I looked for “${needle}” in USER prefs and this agent’s MEMORY — nothing matched. Say it another way, or clear it in Settings → Memory / View Mem0.`,
    };
  }

  const sample = removed[0] || needle;
  return {
    ok: true,
    needle,
    targets: hitTargets,
    removed,
    reply: `Forgotten — removed “${sample}” from ${hitTargets.join(" + ") || "Mem0"}.`,
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
