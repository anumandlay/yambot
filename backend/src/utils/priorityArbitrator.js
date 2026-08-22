/**
 * @fileoverview Priority arbitrator — SLA-aware task ordering for claim.
 * Purpose: Sort pending tasks by urgency, SLA risk, value, and dependencies.
 * Downstream: worker claimNextTask.
 */

/**
 * Computes dynamic priority boost for a pending task.
 * @param {object} task
 * @returns {number}
 */
export function computeArbitrationBoost(task) {
  let boost = Number(task.priorityRank) || 2;
  const now = Date.now();

  if (task.slaDeadline) {
    const deadline = new Date(task.slaDeadline).getTime();
    const minsLeft = (deadline - now) / 60_000;
    if (minsLeft < 0) boost += 50;
    else if (minsLeft < 30) boost += 30;
    else if (minsLeft < 120) boost += 15;
  }

  boost += (Number(task.escalationLevel) || 0) * 10;
  boost += Math.min(20, Number(task.estimatedValueUsd) || 0);

  return boost;
}

/**
 * @param {object[]} tasks
 * @returns {object|null}
 */
export function pickHighestPriorityTask(tasks) {
  if (!tasks?.length) return null;
  const scored = tasks.map((t) => ({
    task: t,
    score: computeArbitrationBoost(t),
    created: new Date(t.createdAt).getTime(),
  }));
  scored.sort((a, b) => b.score - a.score || a.created - b.created);
  return scored[0].task;
}
