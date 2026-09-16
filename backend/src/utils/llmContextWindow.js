/**
 * @fileoverview Resolve LLM context-window size and chat-packing budgets.
 * Purpose: Scale chat session memory (recent turns / summarize thresholds) to the
 * model’s context tokens instead of fixed 16/24/14k constants.
 * Downstream: chatContext.js; LlmProfile.contextTokens; User.settings.llmContextTokens.
 */

/** Default when model is unknown and no override is set (safe mid-size). */
export const DEFAULT_CONTEXT_TOKENS = 128_000;

/** Hard floor / ceiling for stored overrides. */
export const MIN_CONTEXT_TOKENS = 8_000;
export const MAX_CONTEXT_TOKENS = 2_000_000;

/**
 * Clamp a number into [lo, hi].
 * @param {number} n
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Normalize an operator-supplied context size (tokens).
 * @param {unknown} raw
 * @returns {number} 0 when unset / invalid (caller should infer from model)
 */
export function normalizeContextTokens(raw) {
  if (raw == null || raw === "") return 0;
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return clamp(n, MIN_CONTEXT_TOKENS, MAX_CONTEXT_TOKENS);
}

/**
 * Infer context window from common model id strings.
 * Why: most operators never set an explicit size; model name is enough for a good default.
 * @param {string} [model]
 * @returns {number}
 */
export function inferContextTokens(model) {
  const m = String(model || "")
    .trim()
    .toLowerCase();
  if (!m) return DEFAULT_CONTEXT_TOKENS;

  // Explicit size in the name, e.g. "foo-1m", "bar-200k"
  const named = m.match(/(?:^|[-_/])(\d+)\s*(k|m)(?:[-_/]|$)/i);
  if (named) {
    const n = Number(named[1]);
    const mul = String(named[2]).toLowerCase() === "m" ? 1_000_000 : 1_000;
    if (n > 0) return clamp(n * mul, MIN_CONTEXT_TOKENS, MAX_CONTEXT_TOKENS);
  }

  if (/gpt-5|o3|o4|o1/.test(m)) return 200_000;
  if (/gpt-4\.1|gpt-4o|chatgpt-4o|gpt-4-turbo|gpt-4-1106|gpt-4-0125/.test(m)) return 128_000;
  if (/gpt-4(?!o)/.test(m)) return 8_192;
  if (/gpt-3\.5|gpt-35/.test(m)) return 16_384;

  if (/claude-opus-4|claude-sonnet-4|claude-3\.5|claude-3-5|claude-3-opus|claude-3-sonnet|claude-3-haiku/.test(m)) {
    return 200_000;
  }
  if (/claude/.test(m)) return 200_000;

  if (/gemini-1\.5|gemini-2|gemini-flash|gemini-pro/.test(m)) return 1_000_000;
  if (/gemini/.test(m)) return 128_000;

  if (/minimax|m2\.|m1\./.test(m)) return 204_800;
  if (/deepseek/.test(m)) return 128_000;
  if (/qwen.*(72|32|14|7|2\.5|2)/.test(m) || /qwen/.test(m)) return 128_000;
  if (/llama-3\.1|llama3\.1|llama-3\.3/.test(m)) return 128_000;
  if (/mistral-large|mistral-small|mixtral|codestral/.test(m)) return 128_000;
  if (/kimi|moonshot/.test(m)) return 128_000;

  return DEFAULT_CONTEXT_TOKENS;
}

/**
 * Effective context tokens: explicit override wins, else infer from model.
 * @param {{ contextTokens?: unknown, llmModel?: string, model?: string }|number|null|undefined} source
 * @returns {number}
 */
export function resolveContextTokens(source) {
  if (typeof source === "number") {
    const n = normalizeContextTokens(source);
    return n || DEFAULT_CONTEXT_TOKENS;
  }
  const explicit = normalizeContextTokens(source?.contextTokens);
  if (explicit) return explicit;
  return inferContextTokens(source?.llmModel || source?.model || "");
}

/**
 * @typedef {object} ChatContextBudget
 * @property {number} contextTokens
 * @property {number} recent — verbatim turns kept at the tail
 * @property {number} summarizeMin — summarize when eligible count ≥ this
 * @property {number} summarizeChars — summarize when raw eligible chars ≥ this
 * @property {number} summaryMax — stored summary cap (chars)
 * @property {number} lineMax — per-message line cap in the packed block
 * @property {number} chatChars — target budget for the packed chat block
 */

/**
 * Derive chat packing limits from a model context window.
 * Why: leave most of the window for system/agent/tools/output; pack ~20–25% as chat memory.
 * @param {unknown} contextTokensOrCreds
 * @returns {ChatContextBudget}
 */
export function chatContextBudgetFromTokens(contextTokensOrCreds) {
  const contextTokens = resolveContextTokens(contextTokensOrCreds);
  // ~4 chars ≈ 1 token (rough); reserve majority for agent prompt + tools + completion.
  const chatChars = clamp(Math.floor(contextTokens * 0.22 * 4), 6_000, 400_000);
  const recent = clamp(Math.floor(chatChars / 900), 12, 120);
  const summarizeMin = clamp(Math.floor(recent * 1.5), recent + 4, 200);
  const summarizeChars = clamp(Math.floor(chatChars * 1.2), chatChars, 500_000);
  const summaryMax = clamp(Math.floor(contextTokens * 0.015 * 4), 2_500, 24_000);
  const lineMax = clamp(Math.floor(contextTokens * 0.004 * 4), 800, 6_000);
  return {
    contextTokens,
    recent,
    summarizeMin,
    summarizeChars,
    summaryMax,
    lineMax,
    chatChars,
  };
}
