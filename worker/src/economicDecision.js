/**
 * @fileoverview Economic decision helper for worker loop.
 * Purpose: Optional max-step stops only — LLM cost vs estimated value is disabled (unlimited).
 */

/**
 * @param {{ estimatedValueUsd?: number, spentUsd?: number, step?: number, maxSteps?: number }} opts
 * @returns {{ continue: boolean, reason: string }}
 */
export function shouldContinueEconomically(opts) {
  const step = Number(opts.step) || 0;
  const maxSteps = Number(opts.maxSteps) || 0;

  // Why: spend vs estimatedValueUsd gating removed — tenant has unlimited LLM.
  if (maxSteps > 0 && step >= maxSteps) {
    return { continue: false, reason: "max_steps" };
  }
  return { continue: true, reason: "ok" };
}
