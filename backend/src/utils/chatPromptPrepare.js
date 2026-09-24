/**
 * @fileoverview Parallel chat prompt prep (context + curated memory) for fast TTFT.
 * Purpose: Load session context and memory concurrently before the first LLM call (Hermes-style).
 * Downstream: chats.js Auto / Answer / queue_goal snapshot paths.
 */

import { toAgentSnapshot } from "../models/Agent.js";
import {
  buildChatContextPrompt,
  refreshChatContextIfNeeded,
  withChatContext,
} from "./chatContext.js";

/**
 * Build snapshot + chat context without blocking on summary LLM.
 * Context pack and curated/Mem0 retrieval run in parallel.
 * @param {{
 *   chat: object,
 *   messageId: string,
 *   questionText: string,
 *   userDoc: object|null,
 *   agentDoc: object,
 *   creds: object,
 *   userId: string,
 *   light?: boolean,
 * }} opts
 * @returns {Promise<{
 *   chatContextBlock: string,
 *   curated: { userCuratedEntries: string[], agentCuratedEntries: string[], meta: object },
 *   snapshot: object,
 * }>}
 */
export async function prepareChatPromptContext(opts) {
  const {
    chat,
    messageId,
    questionText,
    userDoc,
    agentDoc,
    creds,
    userId,
    light = false,
  } = opts;

  // Why: never block first token on a summary LLM — refresh in background.
  void refreshChatContextIfNeeded(chat, creds).catch(() => {});

  const { resolveCuratedMemoryForPrompt } = await import("./semanticMemory.js");

  const [ctxResult, curated] = await Promise.all([
    buildChatContextPrompt(chat, {
      excludeIds: [String(messageId)],
      creds,
    }),
    resolveCuratedMemoryForPrompt({
      userEntries: userDoc?.curatedMemory?.entries,
      agentEntries: agentDoc.curatedMemory?.entries,
      goal: questionText,
      creds,
      userId: String(userId || userDoc?._id || ""),
      agentId: String(agentDoc._id),
      skipMem0: Boolean(light),
      skipEmbeddings: Boolean(light),
    }),
  ]);

  const chatContextBlock = String(ctxResult?.block || "");
  const snapshot = withChatContext(
    toAgentSnapshot(agentDoc, {
      goal: questionText,
      userCuratedEntries: curated.userCuratedEntries,
      agentCuratedEntries: curated.agentCuratedEntries,
    }),
    chatContextBlock
  );

  return { chatContextBlock, curated, snapshot };
}
