/**
 * @fileoverview Action loop detection — prevent blind repeat of failed actions.
 * Purpose: Detect when the agent clicks the same ref 3+ times or repeats failing actions.
 * Downstream: agent.js injects LOOP DETECTED notes before LLM calls.
 */

/**
 * Stable key for an action in history.
 * @param {object} action
 * @returns {string}
 */
export function actionKey(action) {
  if (!action?.type) return "";
  const target =
    action.ref ||
    action.url ||
    action.name ||
    action.value ||
    action.question?.slice(0, 40) ||
    "";
  return `${action.type}:${target}`;
}

/**
 * Detects repeated identical actions (e.g. click e17 three times).
 * @param {object[]} history
 * @param {number} [threshold=3]
 * @returns {{ detected: boolean, key?: string, count?: number, kind?: string }}
 */
export function detectIdenticalActionLoop(history, threshold = 3) {
  if (!Array.isArray(history) || history.length < threshold) {
    return { detected: false };
  }
  const recent = history.slice(-threshold);
  const keys = recent.map((h) => actionKey(h.action));
  const first = keys[0];
  if (!first || first.startsWith("wait:") || first.startsWith("wait_for:")) {
    return { detected: false };
  }
  if (keys.every((k) => k === first)) {
    return { detected: true, key: first, count: threshold, kind: "identical_action" };
  }
  return { detected: false };
}

/**
 * Detects repeated failures on the same action target.
 * @param {object[]} history
 * @param {number} [threshold=3]
 * @returns {{ detected: boolean, key?: string, count?: number, kind?: string }}
 */
export function detectFailedActionLoop(history, threshold = 3) {
  if (!Array.isArray(history) || history.length < threshold) {
    return { detected: false };
  }
  const recent = history.slice(-threshold);
  const keys = recent.map((h) => actionKey(h.action));
  const first = keys[0];
  if (!first) return { detected: false };
  const allSame = keys.every((k) => k === first);
  const allFailed = recent.every(
    (h) => h.result?.ok === false || h.result?.success === false || h.result?.verification?.passed === false
  );
  if (allSame && allFailed) {
    return { detected: true, key: first, count: threshold, kind: "failed_repeat" };
  }
  return { detected: false };
}

/**
 * Combined loop check — identical or failed-repeat.
 * @param {object[]} history
 * @param {number} [threshold=3]
 * @returns {{ detected: boolean, message?: string, key?: string, kind?: string }}
 */
export function detectActionLoop(history, threshold = 3) {
  const identical = detectIdenticalActionLoop(history, threshold);
  if (identical.detected) {
    return {
      ...identical,
      message: `LOOP DETECTED: same action "${identical.key}" repeated ${identical.count} times. Change strategy — try a different ref, scroll, wait_for, ask_user, or finish.`,
    };
  }
  const failed = detectFailedActionLoop(history, threshold);
  if (failed.detected) {
    return {
      ...failed,
      message: `LOOP DETECTED: "${failed.key}" failed ${failed.count} times in a row. Do NOT repeat — re-observe, try recovery path, ask_user, or finish with what you have.`,
    };
  }
  return { detected: false };
}
