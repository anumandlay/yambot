/**
 * @fileoverview Per-step timing breakdown for speed experiments.
 * Purpose: Log observe / LLM / act / settle averages so FAST_MODE can be validated.
 * Downstream: worker agent runTask loop (console only — no Mongo spam).
 */

/**
 * @returns {{
 *   beginStep: () => object,
 *   mark: (timings: object, phase: string) => void,
 *   endStep: (step: number, timings: object) => void,
 *   summary: () => object|null,
 * }}
 */
export function createStepMetrics() {
  /** @type {object[]} */
  const rows = [];

  return {
    beginStep() {
      const now = Date.now();
      return {
        t0: now,
        observe: now,
        llm: null,
        action: null,
        settle: null,
      };
    },
    /**
     * @param {object} timings
     * @param {"llm"|"action"|"settle"} phase
     */
    mark(timings, phase) {
      timings[phase] = Date.now();
    },
    /**
     * @param {number} step
     * @param {object} timings
     */
    endStep(step, timings) {
      const end = Date.now();
      const observeMs = (timings.llm || timings.action || end) - timings.observe;
      const llmMs = timings.llm && timings.action ? timings.action - timings.llm : 0;
      const actionMs =
        timings.action && timings.settle
          ? timings.settle - timings.action
          : timings.action
            ? end - timings.action
            : 0;
      const settleMs = timings.settle ? end - timings.settle : 0;
      const totalMs = end - timings.t0;
      rows.push({ step, observeMs, llmMs, actionMs, settleMs, totalMs });
      if (rows.length % 5 === 0 || step === 1) {
        const avg = average(rows);
        console.log(
          `[metrics] step=${step} this={obs:${observeMs} llm:${llmMs} act:${actionMs} settle:${settleMs} total:${totalMs}} avg=${JSON.stringify(avg)}`
        );
      }
    },
    summary() {
      if (!rows.length) return null;
      return average(rows);
    },
  };
}

/**
 * @param {object[]} rows
 */
function average(rows) {
  const n = rows.length || 1;
  const sum = { observeMs: 0, llmMs: 0, actionMs: 0, settleMs: 0, totalMs: 0, steps: n };
  for (const r of rows) {
    sum.observeMs += r.observeMs;
    sum.llmMs += r.llmMs;
    sum.actionMs += r.actionMs;
    sum.settleMs += r.settleMs;
    sum.totalMs += r.totalMs;
  }
  return {
    observeMs: Math.round(sum.observeMs / n),
    llmMs: Math.round(sum.llmMs / n),
    actionMs: Math.round(sum.actionMs / n),
    settleMs: Math.round(sum.settleMs / n),
    totalMs: Math.round(sum.totalMs / n),
    steps: n,
  };
}
