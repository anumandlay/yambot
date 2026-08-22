/**
 * @fileoverview Loop detection for extension agent (parity with cloud worker).
 * Downstream: extension/background/agent.js LLM prompt injection.
 */

/**
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
 * @param {object[]} history
 * @param {number} [threshold=3]
 */
export function detectActionLoop(history, threshold = 3) {
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
    return {
      detected: true,
      key: first,
      kind: "identical_action",
      message: `LOOP DETECTED: same action "${first}" repeated ${threshold} times. Change strategy — wait_for, ask_user, or finish.`,
    };
  }
  const allFailed = recent.every((h) => h.result?.ok === false);
  if (keys.every((k) => k === first) && allFailed) {
    return {
      detected: true,
      key: first,
      kind: "failed_repeat",
      message: `LOOP DETECTED: "${first}" failed ${threshold} times. Re-observe, ask_user, or finish.`,
    };
  }
  return { detected: false };
}
