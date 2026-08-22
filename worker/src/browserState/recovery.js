/**
 * @fileoverview Automatic recovery ladder for failed locator actions.
 * Purpose: Scroll, wait, re-resolve, keyboard retry before asking the LLM to fix trivial issues.
 * Downstream: agent.js after failed click/type/select.
 */

import { checkPreconditions } from "./preconditions.js";
import { attachFailureClass } from "./failureClass.js";
import { waitForSemantic } from "./semanticWait.js";

const RECOVERABLE = new Set(["click", "type", "select"]);

/**
 * @param {object} action
 * @returns {boolean}
 */
export function isRecoverableAction(action) {
  return RECOVERABLE.has(action?.type);
}

/**
 * Runs recovery strategies then retries the action once per strategy.
 * @param {object} params
 * @param {object} params.action
 * @param {object} params.obs
 * @param {object|null} params.prevObs
 * @param {import('playwright').Page} params.page
 * @param {Function} params.observeFn
 * @param {Function} params.conditionFn
 * @param {Function} params.precheckFn
 * @param {Function} params.enrichLocatorAction
 * @param {Function} params.runAction - async (action, obs) => result
 * @param {Function} params.attachFingerprints
 * @returns {Promise<{ recovered: boolean, result?: object, attempts: object[], obs?: object }>}
 */
export async function runRecoveryLadder(params) {
  const {
    action,
    obs,
    prevObs,
    page,
    observeFn,
    observeFull,
    conditionFn,
    precheckFn,
    enrichLocatorAction,
    runAction,
    attachFingerprints,
  } = params;

  /**
   * @returns {Promise<object>}
   */
  async function pullObs() {
    if (observeFull) return observeFull();
    return attachFingerprints(await page.evaluate(observeFn));
  }

  if (!isRecoverableAction(action)) {
    return { recovered: false, attempts: [] };
  }

  const attempts = [];

  /**
   * @param {string} strategy
   * @param {object} actionToTry
   * @param {object} currentObs
   */
  async function tryStrategy(strategy, actionToTry, currentObs) {
    attempts.push({ strategy, action: actionToTry.type, ref: actionToTry.ref });
    try {
      const result = await runAction(actionToTry, currentObs);
      const ok = result?.ok !== false && result?.verification?.passed !== false;
      attempts[attempts.length - 1].ok = ok;
      if (ok) return { recovered: true, result, attempts };
    } catch (err) {
      attempts[attempts.length - 1].ok = false;
      attempts[attempts.length - 1].error = String(err?.message || err);
    }
    return null;
  }

  // 1. Fresh observe + fingerprint re-resolve
  let freshObs = await pullObs();
  const pre = checkPreconditions(action, freshObs, prevObs || obs);
  if (pre.resolvedAction && pre.recovery) {
    attempts.push({ strategy: "fingerprint_resolve", detail: pre.recovery });
    const hit = await tryStrategy("retry_after_resolve", pre.resolvedAction, freshObs);
    if (hit) return { ...hit, obs: freshObs };
  }

  // 2. Wait for loading / DOM settle
  await waitForSemantic(page, observeFn, conditionFn, {
    timeoutMs: 4000,
    networkIdle: false,
    loadingGone: true,
    domStable: true,
  });
  freshObs = await pullObs();
  const hitWait = await tryStrategy("retry_after_wait", pre.resolvedAction || action, freshObs);
  if (hitWait) return { ...hitWait, obs: freshObs };

  // 3. Scroll into view + precheck + retry
  const enriched = enrichLocatorAction(pre.resolvedAction || action, freshObs);
  try {
    const precheck = await page.evaluate(precheckFn, enriched);
    attempts.push({ strategy: "scroll_into_view", precheck });
    if (precheck.ok) {
      const hitScroll = await tryStrategy("retry_after_scroll", enriched, freshObs);
      if (hitScroll) return { ...hitScroll, obs: freshObs };
    }
  } catch (err) {
    attempts.push({ strategy: "scroll_into_view", error: String(err?.message || err) });
  }

  // 4. Keyboard activation (click failures on buttons/links)
  if (action.type === "click") {
    try {
      const enrichedClick = enrichLocatorAction(pre.resolvedAction || action, freshObs);
      const point = await page.evaluate(
        (act) => {
          const el = document.querySelector(`[data-ba-ref="${act.ref}"]`);
          if (!el) return null;
          el.focus();
          return { name: el.getAttribute("aria-label") || el.innerText?.slice(0, 60) };
        },
        enrichedClick
      );
      if (point) {
        await page.keyboard.press("Enter");
        attempts.push({ strategy: "keyboard_enter", ok: true });
        return {
          recovered: true,
          result: attachFailureClass(
            { ok: true, clicked: point.name, keyboard: true, recovery: true },
            {}
          ),
          attempts,
          obs: freshObs,
        };
      }
    } catch (err) {
      attempts.push({ strategy: "keyboard_enter", error: String(err?.message || err) });
    }
  }

  // 5. Dismiss blocking cookie overlay if present
  const overlay = freshObs?.pageHints?.blockingOverlay;
  if (overlay) {
    const acceptBtn = (freshObs.interactives || []).find((i) => {
      const n = String(i.name || "").toLowerCase();
      return /accept|agree|got it|ok/.test(n);
    });
    if (acceptBtn) {
      attempts.push({ strategy: "dismiss_overlay", ref: acceptBtn.ref });
      const dismissHit = await tryStrategy(
        "dismiss_overlay_click",
        { type: "click", ref: acceptBtn.ref },
        freshObs
      );
      if (dismissHit) {
        freshObs = await pullObs();
        const retry = await tryStrategy("retry_after_overlay", pre.resolvedAction || action, freshObs);
        if (retry) return { ...retry, obs: freshObs };
      }
    }
  }

  return { recovered: false, attempts, obs: freshObs };
}
