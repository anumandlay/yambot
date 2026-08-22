/**
 * @fileoverview Task run evaluation — Layer 4 quality scoring.
 * Purpose: Heuristic post-run score so governance can track agent quality without manual review.
 * Downstream: worker task complete handler stores result on Task.evaluation.
 */

/**
 * @param {{ success?: boolean, summary?: string, error?: string, trajectory?: object[], llmUsage?: object }} task
 * @returns {{ score: number, summary: string }}
 */
export function evaluateTaskRun(task) {
  const success = task.success !== false;
  const summary = String(task.summary || "").trim();
  const error = String(task.error || "").trim();
  const steps = Array.isArray(task.trajectory) ? task.trajectory.length : 0;
  const tokens = Number(task.llmUsage?.totalTokens) || 0;

  let score = success ? 70 : 25;
  if (success && summary.length > 80) score += 10;
  if (success && summary.length > 300) score += 5;
  if (steps >= 3 && steps <= 40) score += 5;
  if (steps > 60) score -= 10;
  if (tokens > 200_000) score -= 15;
  if (!success && /captcha|login|timeout/i.test(error || summary)) score -= 5;

  score = Math.max(0, Math.min(100, Math.round(score)));
  const note = success
    ? `Completed in ~${steps} steps; ${tokens.toLocaleString()} tokens.`
    : `Failed: ${(error || summary).slice(0, 120)}`;

  return { score, summary: note };
}
