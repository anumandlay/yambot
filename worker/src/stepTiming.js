/**
 * @fileoverview Tunable delays between agent steps and after browser actions.
 * Purpose: Tunable delays — short settle for fill bursts, longer after navigate/submit.
 * Inputs: env YAMBOT_* overrides; Downstream: worker agent loop, semanticWait.
 */

/** @type {{ postActionSettleMs: number, postFillSettleMs: number, recoverySettleMs: number, domStableMs: number, llmRetryMs: number, parseRetryMs: number, waitingUserPollMs: number, defaultWaitActionMs: number, maxActionsPerTurn: number }} */
export const stepTiming = {
  /** Max time to wait for DOM/loading after navigate/submit/heavy clicks. */
  postActionSettleMs: Math.max(400, Number(process.env.YAMBOT_STEP_SETTLE_MS) || 1000),
  /** Short settle after type/fill_form/select in a multi-action burst. */
  postFillSettleMs: Math.max(50, Number(process.env.YAMBOT_FILL_SETTLE_MS) || 280),
  /** Longer settle during error-recovery retries. */
  recoverySettleMs: Math.max(800, Number(process.env.YAMBOT_RECOVERY_SETTLE_MS) || 2200),
  /** How long interactive count must stay unchanged to count as stable. */
  domStableMs: Math.max(100, Number(process.env.YAMBOT_DOM_STABLE_MS) || 180),
  /** Pause before retrying after an LLM HTTP failure. */
  llmRetryMs: Math.max(200, Number(process.env.YAMBOT_LLM_RETRY_MS) || 800),
  /** Pause before retrying after invalid model JSON. */
  parseRetryMs: Math.max(200, Number(process.env.YAMBOT_PARSE_RETRY_MS) || 500),
  /** Poll interval while task status is waiting_user. */
  waitingUserPollMs: Math.max(400, Number(process.env.YAMBOT_WAITING_USER_POLL_MS) || 1000),
  /** Default for model-emitted wait actions when ms is omitted. */
  defaultWaitActionMs: Math.max(200, Number(process.env.YAMBOT_DEFAULT_WAIT_MS) || 750),
  /** Cap LLM multi-action batches so one turn cannot run forever. */
  maxActionsPerTurn: Math.max(1, Math.min(12, Number(process.env.YAMBOT_MAX_ACTIONS_PER_TURN) || 8)),
};
