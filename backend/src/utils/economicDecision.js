/**
 * @fileoverview Economic decision helper — optional max-step stops only.
 * Purpose: LLM cost vs estimated value gating disabled (unlimited LLM).
 * Downstream: worker agent loop (mirrored in worker/src/economicDecision.js).
 */

/**
 * @param {{ estimatedValueUsd?: number, spentUsd?: number, step?: number, maxSteps?: number }} opts
 * @returns {{ continue: boolean, reason: string }}
 */
export function shouldContinueEconomically(opts) {
  const step = Number(opts.step) || 0;
  const maxSteps = Number(opts.maxSteps) || 0;

  if (maxSteps > 0 && step >= maxSteps) {
    return { continue: false, reason: "max_steps" };
  }
  return { continue: true, reason: "ok" };
}
