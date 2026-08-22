/**
 * @fileoverview LLM usage accumulator for governance / cost control (Layer 5).
 * Purpose: Sum token counts across chatCompletion calls in one task run.
 * Downstream: worker agent.js complete payload → Task.llmUsage in Mongo.
 */

/**
 * @returns {{ promptTokens: number, completionTokens: number, totalTokens: number, calls: number, estimatedUsd: number }}
 */
export function createLlmUsageTracker() {
  return {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    calls: 0,
    estimatedUsd: 0,
  };
}

/**
 * Merges OpenAI-style usage into the tracker.
 * @param {object} tracker
 * @param {object|null|undefined} usage
 */
export function addLlmUsage(tracker, usage) {
  if (!tracker || !usage) return;
  const prompt = Number(usage.prompt_tokens ?? usage.promptTokens) || 0;
  const completion = Number(usage.completion_tokens ?? usage.completionTokens) || 0;
  const total = Number(usage.total_tokens ?? usage.totalTokens) || prompt + completion;
  tracker.promptTokens += prompt;
  tracker.completionTokens += completion;
  tracker.totalTokens += total;
  tracker.calls += 1;
  // Why: generic placeholder rates until per-model pricing is configured.
  tracker.estimatedUsd += prompt * 0.5e-6 + completion * 1.5e-6;
}

/**
 * @param {object} tracker
 * @returns {object}
 */
export function snapshotLlmUsage(tracker) {
  return {
    promptTokens: tracker.promptTokens || 0,
    completionTokens: tracker.completionTokens || 0,
    totalTokens: tracker.totalTokens || 0,
    calls: tracker.calls || 0,
    estimatedUsd: Number((tracker.estimatedUsd || 0).toFixed(6)),
  };
}
