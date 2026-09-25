/**
 * @fileoverview Persist chat “remember …” / “forget …” / session-scratch facts.
 * Purpose: Auto used to only reply (or emit fake ACTION: memory) without writing.
 * Remember → Mem0 only (one store). Forget clears Mem0 + legacy Mongo curated rows.
 * Phase 2: “for this chat / for now” → Chat.sessionScratch (TTL), not durable MEMORY.
 * Downstream: chats.js Auto/Answer reply path; Agents → View Mem0.
 */

import {
  looksLikeMemoryStoreRequest,
  extractRememberFact,
  looksLikeMemoryForgetRequest,
  extractForgetNeedle,
  looksLikeSessionScratchRequest,
  extractSessionScratchFact,
} from "./messageIntent.js";
import { mutateCuratedMemory } from "./curatedMemoryOps.js";
import { mem0AddFact } from "./mem0Service.js";
import { addScratchNote, removeScratchNotes } from "./sessionScratch.js";
import { Chat } from "../models/Chat.js";

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
 * Save a temporary chat-only note (session scratch).
 * @param {{
 *   userId: string,
 *   chatId: string,
 *   userText: string,
 * }} opts
 * @returns {Promise<{
 *   ok: boolean,
 *   skipped?: string,
 *   fact?: string,
 *   reply?: string,
 * }>}
 */
export async function persistChatSessionScratchFact(opts) {
  const userText = String(opts.userText || "").trim();
  const userId = String(opts.userId || "").trim();
  const chatId = String(opts.chatId || "").trim();
  if (!userId || !chatId) return { ok: false, skipped: "missing" };
  if (!looksLikeSessionScratchRequest(userText)) return { ok: false, skipped: "not_scratch" };

  const fact = extractSessionScratchFact(userText);
  if (!fact || fact.length < 3) return { ok: false, skipped: "empty_fact" };

  const chat = await Chat.findOne({ _id: chatId, user: userId });
  if (!chat) return { ok: false, skipped: "chat_missing" };

  const { notes, added } = addScratchNote(chat.sessionScratch, fact, {
    source: "chat_session",
  });
  if (!added) return { ok: false, skipped: "empty_fact", fact };
  chat.sessionScratch = { notes, updatedAt: new Date() };
  await chat.save();

  return {
    ok: true,
    fact,
    reply: `Noted for this chat only — “${fact}” (expires in ~24h; not saved to durable MEMORY).`,
  };
}

/**
 * Save a remember-fact from chat into Mem0 only (one store, one scope).
 * Personal identity → USER Mem0; otherwise → this agent’s Mem0.
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

  const personal =
    looksPersonalAccountFact(userText) || looksPersonalAccountFact(fact);
  const scope = personal ? "user" : "agent";
  /** @type {string[]} */
  const targets = [personal ? "user" : "memory"];

  const result = await mem0AddFact({
    userId,
    agentId: personal ? null : agentId,
    scope,
    content: fact,
    metadata: {
      source: "chat_remember",
      sourceRef: opts.messageId || null,
    },
  });
  if (!result.ok && result.skipped !== "duplicate") {
    return {
      ok: false,
      skipped: result.skipped || "mem0_failed",
      fact,
      targets,
    };
  }

  const where = personal
    ? "account Mem0 (Settings → Memory / USER)"
    : "this agent’s Mem0 (View Mem0)";

  return {
    ok: true,
    fact,
    targets,
    reply:
      result.skipped === "duplicate"
        ? `Already saved — “${fact}” is in ${where}.`
        : `Got it — saved “${fact}” to ${where}.`,
  };
}

/**
 * Remove a forgotten fact from agent MEMORY (+ USER when personal) and Mem0.
 * Also clears matching session scratch notes when chatId is provided.
 * @param {{
 *   userId: string,
 *   agentId: string,
 *   userText: string,
 *   messageId?: string|null,
 *   chatId?: string|null,
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

  // Phase 2: also clear matching session scratch in this chat.
  const chatId = String(opts.chatId || "").trim();
  if (chatId) {
    try {
      const chat = await Chat.findOne({ _id: chatId, user: userId });
      if (chat?.sessionScratch) {
        const { notes, removed: scratchRemoved } = removeScratchNotes(
          chat.sessionScratch,
          needle
        );
        if (scratchRemoved.length) {
          chat.sessionScratch = { notes, updatedAt: new Date() };
          await chat.save();
          removed.push(...scratchRemoved);
          hitTargets.push("scratch");
        }
      }
    } catch {
      /* ignore */
    }
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
