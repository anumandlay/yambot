/**
 * @fileoverview Fast-mode presets for the cloud worker agent loop.
 * Purpose: Opt-in speed profile (YAMBOT_FAST_MODE) without rewriting the control plane.
 * Downstream: stepTiming, observe, format projection, screenLoop, agent batch settle.
 *
 * Why this exists: external speed advice suggested many changes; only architecture-safe
 * knobs live here. Speculative no-LLM actions, LLM response caching, and incomplete
 * stream early-exit are intentionally NOT implemented (wrong action schema / unsafe).
 */

/**
 * @returns {boolean}
 */
export function isFastMode() {
  const v = String(process.env.YAMBOT_FAST_MODE || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

/**
 * Observation / prompt projection limits for the current mode.
 * @returns {{
 *   fast: boolean,
 *   maxInteractives: number,
 *   maxText: number,
 *   skipFrames: boolean,
 *   skipA11y: boolean,
 *   maxActionsPerTurn: number,
 *   screenMsIdle: number,
 *   screenMsRunning: number,
 *   screenEveryNthWhileRunning: number,
 *   skipMidBatchReobserve: boolean,
 *   llmTimeoutMs: number,
 * }}
 */
export function getFastModeProfile() {
  const fast = isFastMode();
  return {
    fast,
    maxInteractives: Math.max(
      15,
      Number(process.env.YAMBOT_OBSERVE_LIMIT) || (fast ? 30 : 65)
    ),
    maxText: Math.max(400, Number(process.env.YAMBOT_OBSERVE_TEXT) || (fast ? 1000 : 1800)),
    skipFrames:
      process.env.YAMBOT_SKIP_FRAMES === "1" ||
      process.env.YAMBOT_SKIP_FRAMES === "true" ||
      (fast && process.env.YAMBOT_SKIP_FRAMES !== "0"),
    skipA11y:
      process.env.YAMBOT_INCLUDE_A11Y === "false" ||
      process.env.YAMBOT_INCLUDE_A11Y === "0" ||
      (fast && process.env.YAMBOT_INCLUDE_A11Y !== "true"),
    maxActionsPerTurn: Math.max(
      1,
      Math.min(12, Number(process.env.YAMBOT_MAX_ACTIONS_PER_TURN) || (fast ? 12 : 8))
    ),
    screenMsIdle: Math.max(2000, Number(process.env.YAMBOT_SCREEN_MS) || (fast ? 3000 : 4000)),
    // Why: during LLM think, JPEG every 1.2s fights Chromium for CPU — slow the live feed.
    screenMsRunning: Math.max(
      1500,
      Number(process.env.YAMBOT_SCREEN_MS_RUNNING) || (fast ? 3500 : 2500)
    ),
    screenEveryNthWhileRunning: Math.max(
      1,
      Number(process.env.YAMBOT_SCREEN_EVERY_N) || (fast ? 3 : 2)
    ),
    skipMidBatchReobserve:
      process.env.YAMBOT_SKIP_MID_BATCH_REOBSERVE === "1" ||
      process.env.YAMBOT_SKIP_MID_BATCH_REOBSERVE === "true" ||
      (fast && process.env.YAMBOT_SKIP_MID_BATCH_REOBSERVE !== "0"),
    llmTimeoutMs: Math.max(
      15_000,
      Number(process.env.YAMBOT_LLM_TIMEOUT_MS) || (fast ? 45_000 : 120_000)
    ),
    /** Cap completion size in fast mode so the model stops sooner on action JSON. */
    llmMaxTokens: Math.max(
      0,
      Number(process.env.YAMBOT_LLM_MAX_TOKENS) || (fast ? 600 : 0)
    ),
  };
}
