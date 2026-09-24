/**
 * @fileoverview Cross-block char budgets for agent prompt assembly.
 * Purpose: Rank USER / MEMORY / dayLogs / chat / company under one token-derived budget
 * so retrieved memory cannot crowd out the current request or tool state.
 * Downstream: semanticMemory resolve, chatContext packing callers.
 */

import { MEMORY_CHAR_LIMIT, USER_CHAR_LIMIT } from "./curatedMemory.js";
import { resolveContextTokens } from "./llmContextWindow.js";

/**
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Allocate soft char budgets across prompt context blocks.
 * Priority (highest wins at assembly time — this only sizes retrieval):
 * current user request > tool/task state > USER > MEMORY > dayLogs > chat summary.
 * @param {unknown} contextTokensOrCreds
 * @returns {{
 *   contextTokens: number,
 *   totalChars: number,
 *   userChars: number,
 *   memoryChars: number,
 *   dayLogChars: number,
 *   chatChars: number,
 *   companyChars: number,
 * }}
 */
export function assembleAgentContextBudget(contextTokensOrCreds) {
  const contextTokens = resolveContextTokens(contextTokensOrCreds);
  // ~4 chars ≈ 1 token; leave majority for system/tools/completion.
  const totalChars = clamp(Math.floor(contextTokens * 0.28 * 4), 8_000, 120_000);
  const userChars = Math.min(USER_CHAR_LIMIT, clamp(Math.floor(totalChars * 0.1), 400, USER_CHAR_LIMIT));
  const memoryChars = Math.min(
    MEMORY_CHAR_LIMIT,
    clamp(Math.floor(totalChars * 0.32), 1_200, MEMORY_CHAR_LIMIT)
  );
  const dayLogChars = clamp(Math.floor(totalChars * 0.12), 600, 12_000);
  const chatChars = clamp(Math.floor(totalChars * 0.36), 2_000, 80_000);
  const companyChars = clamp(Math.floor(totalChars * 0.1), 400, 8_000);
  return {
    contextTokens,
    totalChars,
    userChars,
    memoryChars,
    dayLogChars,
    chatChars,
    companyChars,
  };
}
