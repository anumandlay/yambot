/**
 * @fileoverview Persist Hermes-style curated memory mutations on User / Agent.
 * Purpose: Shared add|replace|remove path for JWT UI routes and worker tools.
 * Downstream: settings routes, agents routes, worker tools/memory, apiAgentRunner.
 */

import { User } from "../models/User.js";
import { Agent } from "../models/Agent.js";
import {
  MEMORY_CHAR_LIMIT,
  USER_CHAR_LIMIT,
  applyCuratedMemoryAction,
  charCount,
  normalizeEntries,
  normalizeEntryRecords,
  publicCuratedStore,
  toPersistableEntries,
} from "./curatedMemory.js";
import { resolveLlmCredentials, resolveLlmCredentialsForAgent } from "./llmCredentials.js";
import { embedCuratedContent } from "./semanticMemory.js";

/**
 * @param {string} userId
 * @returns {Promise<object>}
 */
export async function getUserCuratedMemory(userId) {
  const user = await User.findById(userId).select("curatedMemory").lean();
  return publicCuratedStore(
    user?.curatedMemory?.entries,
    USER_CHAR_LIMIT,
    user?.curatedMemory?.updatedAt || null
  );
}

/**
 * @param {import('mongoose').Document|object} agentDoc
 * @returns {object}
 */
export function getAgentCuratedMemoryPublic(agentDoc) {
  const entries = agentDoc?.curatedMemory?.entries;
  return publicCuratedStore(
    entries,
    MEMORY_CHAR_LIMIT,
    agentDoc?.curatedMemory?.updatedAt || null
  );
}

/**
 * Stamp embedding onto the newest / replaced persistable row when possible.
 * @param {object[]} persistable
 * @param {string} focusContent
 * @param {{ apiKey?: string, llmBaseUrl?: string }|null} creds
 */
async function stampFocusEmbedding(persistable, focusContent, creds) {
  const needle = String(focusContent || "").trim();
  if (!needle || !creds?.apiKey) return persistable;
  const emb = await embedCuratedContent(needle, creds);
  if (!Array.isArray(emb) || !emb.length) return persistable;
  return persistable.map((row) =>
    row.content === needle ? { ...row, embedding: emb } : row
  );
}

/**
 * Apply a curated memory tool action and persist.
 * @param {{
 *   userId: string,
 *   agentId?: string|null,
 *   action: string,
 *   target: string,
 *   content?: string,
 *   oldText?: string,
 * }} opts
 * @returns {Promise<object>}
 */
export async function mutateCuratedMemory(opts) {
  const action = String(opts.action || "").trim().toLowerCase();
  const target = String(opts.target || "memory").trim().toLowerCase();
  const payload = {
    content: opts.content,
    oldText: opts.oldText,
  };

  if (target === "user") {
    const user = await User.findById(opts.userId);
    if (!user) {
      return { success: false, target, error: "User not found." };
    }
    const current = user.curatedMemory?.entries;
    const result = applyCuratedMemoryAction(action, "user", payload, current);
    if (!result.success || !Array.isArray(result.persistable || result.entries)) {
      return result;
    }
    const now = new Date();
    let persistable =
      result.persistable || toPersistableEntries(result.items || result.entries);
    if (action === "add" || action === "replace") {
      const creds = await resolveLlmCredentials(user);
      persistable = await stampFocusEmbedding(persistable, payload.content, creds);
    }
    user.curatedMemory = {
      entries: persistable,
      updatedAt: now,
    };
    await user.save();
    return {
      ...result,
      ...publicCuratedStore(user.curatedMemory.entries, USER_CHAR_LIMIT, now),
    };
  }

  if (target === "memory") {
    const agentId = String(opts.agentId || "").trim();
    if (!agentId) {
      return { success: false, target, error: "agentId required for target memory." };
    }
    const agent = await Agent.findOne({ _id: agentId, user: opts.userId });
    if (!agent) {
      return { success: false, target, error: "Agent not found." };
    }
    const current = agent.curatedMemory?.entries;
    const result = applyCuratedMemoryAction(action, "memory", payload, current);
    if (!result.success || !Array.isArray(result.persistable || result.entries)) {
      return result;
    }
    const now = new Date();
    let persistable =
      result.persistable || toPersistableEntries(result.items || result.entries);
    if (action === "add" || action === "replace") {
      const owner = await User.findById(opts.userId);
      const creds = owner
        ? await resolveLlmCredentialsForAgent(owner, agent)
        : null;
      persistable = await stampFocusEmbedding(persistable, payload.content, creds);
    }
    agent.curatedMemory = {
      entries: persistable,
      updatedAt: now,
    };
    await agent.save();
    return {
      ...result,
      ...publicCuratedStore(agent.curatedMemory.entries, MEMORY_CHAR_LIMIT, now),
    };
  }

  return {
    success: false,
    target,
    error: `Invalid target '${target}'. Use 'memory' or 'user'.`,
  };
}

/**
 * Replace entire store (operator clear / set from UI).
 * @param {{ userId: string, target: "user"|"memory", agentId?: string, entries: unknown[] }} opts
 * @returns {Promise<object>}
 */
export async function setCuratedMemoryEntries(opts) {
  const target = opts.target === "user" ? "user" : "memory";
  const limit = target === "user" ? USER_CHAR_LIMIT : MEMORY_CHAR_LIMIT;
  const now = new Date();
  // Why: clearing/replacing from UI — new strings get `at=now`; keep prior `at`/embedding when content matches.
  const previous =
    target === "user"
      ? normalizeEntryRecords(
          (await User.findById(opts.userId).select("curatedMemory.entries").lean())?.curatedMemory
            ?.entries
        )
      : normalizeEntryRecords(
          (
            await Agent.findOne({ _id: opts.agentId, user: opts.userId })
              .select("curatedMemory.entries")
              .lean()
          )?.curatedMemory?.entries
        );
  const prevByContent = new Map(previous.map((r) => [r.content, r]));
  const records = normalizeEntries(opts.entries).map((content) => {
    const prev = prevByContent.get(content);
    return {
      content,
      at: prev?.at || now,
      embedding: prev?.embedding || null,
    };
  });
  const total = charCount(records);
  if (total > limit) {
    return {
      success: false,
      target,
      error: `Entries total ${total.toLocaleString()} chars; limit is ${limit.toLocaleString()}.`,
    };
  }

  const persistable = toPersistableEntries(records);

  if (target === "user") {
    const user = await User.findById(opts.userId);
    if (!user) return { success: false, target, error: "User not found." };
    user.curatedMemory = { entries: persistable, updatedAt: now };
    await user.save();
    return {
      success: true,
      target,
      ...publicCuratedStore(persistable, limit, now),
    };
  }

  const agent = await Agent.findOne({ _id: opts.agentId, user: opts.userId });
  if (!agent) return { success: false, target, error: "Agent not found." };
  agent.curatedMemory = { entries: persistable, updatedAt: now };
  await agent.save();
  return {
    success: true,
    target,
    ...publicCuratedStore(persistable, limit, now),
  };
}
