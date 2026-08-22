/**
 * @fileoverview Browser State Engine — Phase 1 exports for the cloud worker agent loop.
 * Purpose: Observe → state → diff → act → verify pipeline outside the LLM.
 * Downstream: worker/src/agent.js
 */

export { buildFingerprint, fingerprintScore, findByFingerprint } from "./fingerprints.js";
export { buildPageState, computeStateChange } from "./pageState.js";
export { diffObservations } from "./diff.js";
export { verifyAction, enrichActionResult } from "./verify.js";
export { checkPreconditions, attachFingerprints } from "./preconditions.js";
export { formatStateProjection } from "./format.js";

/**
 * Polls observe until interactive count stabilizes or timeout.
 * @param {import('playwright').Page} page
 * @param {Function} observeFn - Serialized observeInPage.
 * @param {{ timeoutMs?: number, stableMs?: number }} [opts]
 * @returns {Promise<object>}
 */
export async function waitForDomSettle(page, observeFn, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? 1500;
  const stableMs = opts.stableMs ?? 250;
  const start = Date.now();
  let last = await page.evaluate(observeFn);
  let lastCount = (last.interactives || []).length;
  let stableSince = Date.now();

  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 120));
    const next = await page.evaluate(observeFn);
    const count = (next.interactives || []).length;
    if (count === lastCount) {
      if (Date.now() - stableSince >= stableMs) return next;
    } else {
      lastCount = count;
      last = next;
      stableSince = Date.now();
    }
  }
  return last;
}
