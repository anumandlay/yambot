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
  publicCuratedStore,
} from "./curatedMemory.js";

/**
 * @param {string} userId
 * @returns {Promise<object>}
 */
export async function getUserCuratedMemory(userId) {
  const user = await User.findById(userId).select("curatedMemory").lean();
  return publicCuratedStore(user?.curatedMemory?.entries, USER_CHAR_LIMIT);
}

/**
 * @param {import('mongoose').Document|object} agentDoc
 * @returns {object}
 */
export function getAgentCuratedMemoryPublic(agentDoc) {
  const entries = agentDoc?.curatedMemory?.entries;
  return publicCuratedStore(entries, MEMORY_CHAR_LIMIT);
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
    const current = normalizeEntries(user.curatedMemory?.entries);
    const result = applyCuratedMemoryAction(action, "user", payload, current);
    if (!result.success || !Array.isArray(result.entries)) {
      return result;
    }
    user.curatedMemory = {
      entries: result.entries,
      updatedAt: new Date(),
    };
    await user.save();
    return result;
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
    const current = normalizeEntries(agent.curatedMemory?.entries);
    const result = applyCuratedMemoryAction(action, "memory", payload, current);
    if (!result.success || !Array.isArray(result.entries)) {
      return result;
    }
    agent.curatedMemory = {
      entries: result.entries,
      updatedAt: new Date(),
    };
    await agent.save();
    return result;
  }

  return {
    success: false,
    target,
    error: `Invalid target '${target}'. Use 'memory' or 'user'.`,
  };
}

/**
 * Replace entire store (operator clear / set from UI).
 * @param {{ userId: string, target: "user"|"memory", agentId?: string, entries: string[] }} opts
 * @returns {Promise<object>}
 */
export async function setCuratedMemoryEntries(opts) {
  const target = opts.target === "user" ? "user" : "memory";
  const limit = target === "user" ? USER_CHAR_LIMIT : MEMORY_CHAR_LIMIT;
  const entries = normalizeEntries(opts.entries);
  const total = charCount(entries);
  if (total > limit) {
    return {
      success: false,
      target,
      error: `Entries total ${total.toLocaleString()} chars; limit is ${limit.toLocaleString()}.`,
    };
  }

  if (target === "user") {
    const user = await User.findById(opts.userId);
    if (!user) return { success: false, target, error: "User not found." };
    user.curatedMemory = { entries, updatedAt: new Date() };
    await user.save();
    return { success: true, target, ...publicCuratedStore(entries, limit) };
  }

  const agent = await Agent.findOne({ _id: opts.agentId, user: opts.userId });
  if (!agent) return { success: false, target, error: "Agent not found." };
  agent.curatedMemory = { entries, updatedAt: new Date() };
  await agent.save();
  return { success: true, target, ...publicCuratedStore(entries, limit) };
}
