/**
 * @fileoverview Persist Hermes-style curated memory mutations on User / Agent.
 * Purpose: Shared add|replace|remove path for JWT UI routes and worker tools.
 * Phase 1: provenance on writes, Mem0 sync on delete/replace, audit ledger.
 * Downstream: settings routes, agents routes, worker tools/memory, apiAgentRunner, chat remember/forget.
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
import { invalidateChatContextSummariesForUser } from "./chatContext.js";
import { writeAudit } from "./audit.js";

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
 * Mirror Mongo remove/replace into Mem0 (best-effort).
 * @param {{
 *   userId: string,
 *   agentId?: string|null,
 *   scope: "user"|"agent",
 *   content?: string|null,
 *   alsoRemove?: string|null,
 * }} opts
 */
async function syncMem0AfterMutation(opts) {
  try {
    const { mem0DeleteByContent, mem0AddFact } = await import("./mem0Service.js");
    const removals = [opts.content, opts.alsoRemove]
      .map((c) => String(c || "").trim())
      .filter(Boolean);
    for (const content of removals) {
      await mem0DeleteByContent({
        userId: opts.userId,
        agentId: opts.agentId,
        scope: opts.scope,
        content,
      });
    }
  } catch (err) {
    console.warn("[curatedMemory] mem0 sync failed:", err?.message || err);
  }
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
 *   source?: string|null,
 *   sourceRef?: string|null,
 *   confidence?: number|null,
 *   tags?: string[],
 *   messageId?: string|null,
 *   taskId?: string|null,
 * }} opts
 * @returns {Promise<object>}
 */
export async function mutateCuratedMemory(opts) {
  const action = String(opts.action || "").trim().toLowerCase();
  const target = String(opts.target || "memory").trim().toLowerCase();
  const payload = {
    content: opts.content,
    oldText: opts.oldText,
    source: opts.source || null,
    sourceRef: opts.sourceRef || opts.messageId || opts.taskId || null,
    confidence: opts.confidence,
    tags: opts.tags,
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
    // Why: chat contextSummary often absorbed tone/identity from USER.md — drop it so deletes stick.
    await invalidateChatContextSummariesForUser(opts.userId).catch((err) => {
      console.warn("[curatedMemory] chat summary invalidate failed:", err?.message || err);
    });

    if (action === "remove") {
      void syncMem0AfterMutation({
        userId: opts.userId,
        scope: "user",
        content: String(result.removedContent || payload.oldText || "").trim(),
      });
    } else if (action === "replace") {
      void syncMem0AfterMutation({
        userId: opts.userId,
        scope: "user",
        content: String(payload.oldText || "").trim(),
        alsoRemove: result.removedContent || null,
      }).then(async () => {
        const { mem0AddFact } = await import("./mem0Service.js");
        await mem0AddFact({
          userId: opts.userId,
          scope: "user",
          content: String(payload.content || "").trim(),
          metadata: { source: payload.source || "yambot_curated" },
        });
      });
    } else if (action === "add") {
      if (result.replaced && result.removedContent) {
        void syncMem0AfterMutation({
          userId: opts.userId,
          scope: "user",
          content: result.removedContent,
        });
      }
      const { mem0AddFact } = await import("./mem0Service.js");
      void mem0AddFact({
        userId: opts.userId,
        scope: "user",
        content: String(payload.content || "").trim(),
        metadata: { source: payload.source || "yambot_curated" },
      }).catch(() => {});
    }

    void writeAudit({
      userId: opts.userId,
      agentId: opts.agentId || null,
      taskId: opts.taskId || null,
      action: `memory_${action}_user`,
      detail: String(payload.content || payload.oldText || "").slice(0, 400),
      meta: {
        target: "user",
        source: payload.source || null,
        sourceRef: payload.sourceRef || null,
        replaced: Boolean(result.replaced),
      },
    });

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
    agent.memoryContentChangedAt = now;
    await agent.save();

    if (action === "remove") {
      void syncMem0AfterMutation({
        userId: opts.userId,
        agentId,
        scope: "agent",
        content: String(result.removedContent || payload.oldText || "").trim(),
      });
    } else if (action === "replace") {
      void syncMem0AfterMutation({
        userId: opts.userId,
        agentId,
        scope: "agent",
        content: String(payload.oldText || "").trim(),
        alsoRemove: result.removedContent || null,
      }).then(async () => {
        const { mem0AddFact } = await import("./mem0Service.js");
        await mem0AddFact({
          userId: opts.userId,
          agentId,
          scope: "agent",
          content: String(payload.content || "").trim(),
          metadata: { source: payload.source || "yambot_curated" },
        });
      });
    } else if (action === "add") {
      if (result.replaced && result.removedContent) {
        void syncMem0AfterMutation({
          userId: opts.userId,
          agentId,
          scope: "agent",
          content: result.removedContent,
        });
      }
      const { mem0AddFact } = await import("./mem0Service.js");
      void mem0AddFact({
        userId: opts.userId,
        agentId,
        scope: "agent",
        content: String(payload.content || "").trim(),
        metadata: { source: payload.source || "yambot_curated" },
      }).catch(() => {});
    }

    void writeAudit({
      userId: opts.userId,
      agentId,
      taskId: opts.taskId || null,
      action: `memory_${action}_agent`,
      detail: String(payload.content || payload.oldText || "").slice(0, 400),
      meta: {
        target: "memory",
        source: payload.source || null,
        sourceRef: payload.sourceRef || null,
        replaced: Boolean(result.replaced),
      },
    });

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
      source: prev?.source || "ui_set",
      sourceRef: prev?.sourceRef || null,
      confidence: prev?.confidence ?? 0.9,
      tags: prev?.tags || [],
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
  const clearing = persistable.length === 0;

  if (target === "user") {
    const user = await User.findById(opts.userId);
    if (!user) return { success: false, target, error: "User not found." };
    user.curatedMemory = { entries: persistable, updatedAt: now };
    await user.save();
    await invalidateChatContextSummariesForUser(opts.userId).catch((err) => {
      console.warn("[curatedMemory] chat summary invalidate failed:", err?.message || err);
    });
    if (clearing) {
      try {
        const { mem0ClearScope } = await import("./mem0Service.js");
        void mem0ClearScope({ userId: opts.userId, scope: "user" });
      } catch {
        /* ignore */
      }
    }
    void writeAudit({
      userId: opts.userId,
      action: clearing ? "memory_clear_user" : "memory_set_user",
      detail: clearing ? "cleared USER curated store" : `set ${persistable.length} USER entries`,
    });
    return {
      success: true,
      target,
      ...publicCuratedStore(persistable, limit, now),
    };
  }

  const agent = await Agent.findOne({ _id: opts.agentId, user: opts.userId });
  if (!agent) return { success: false, target, error: "Agent not found." };
  agent.curatedMemory = { entries: persistable, updatedAt: now };
  if (!opts.skipContentChangedBump) {
    agent.memoryContentChangedAt = now;
  }
  await agent.save();
  if (clearing) {
    try {
      const { mem0ClearScope } = await import("./mem0Service.js");
      void mem0ClearScope({
        userId: opts.userId,
        agentId: opts.agentId,
        scope: "agent",
      });
    } catch {
      /* ignore */
    }
  }
  void writeAudit({
    userId: opts.userId,
    agentId: opts.agentId,
    action: clearing ? "memory_clear_agent" : "memory_set_agent",
    detail: clearing
      ? "cleared agent MEMORY store"
      : `set ${persistable.length} agent MEMORY entries`,
  });
  return {
    success: true,
    target,
    ...publicCuratedStore(persistable, limit, now),
  };
}
