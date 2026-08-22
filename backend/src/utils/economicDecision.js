/**
 * @fileoverview Economic decision helper — is continued work worth the cost?
 * Purpose: Stop runaway loops when estimated value < estimated cost (vision #26).
 * Downstream: worker agent loop.
 */

/**
 * @param {{ estimatedValueUsd?: number, spentUsd?: number, step?: number, maxSteps?: number }} opts
 * @returns {{ continue: boolean, reason: string }}
 */
export function shouldContinueEconomically(opts) {
  const value = Number(opts.estimatedValueUsd) || 0;
  const spent = Number(opts.spentUsd) || 0;
  const step = Number(opts.step) || 0;
  const maxSteps = Number(opts.maxSteps) || 0;

  if (value > 0 && spent > value * 1.5) {
    return { continue: false, reason: "cost_exceeds_estimated_value" };
  }
  if (maxSteps > 0 && step >= maxSteps) {
    return { continue: false, reason: "max_steps" };
  }
  return { continue: true, reason: "ok" };
}
