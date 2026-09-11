/**
 * @fileoverview Automatic recovery ladder for failed locator actions.
 * Purpose: Scroll, wait, re-resolve, keyboard retry, soft-skip ephemeral dismiss clicks.
 * Downstream: agent.js after failed click/type/select.
 */

import { checkPreconditions } from "./preconditions.js";
import { attachFailureClass } from "./failureClass.js";
import { waitForSemantic } from "./semanticWait.js";
import {
  isElementMissingError,
  isEphemeralDismissClick,
  rebindActionByName,
  actionDisplayName,
} from "./softClick.js";

const RECOVERABLE = new Set(["click", "type", "select", "choose_searchable"]);

/**
 * @param {object} action
 * @returns {boolean}
 */
export function isRecoverableAction(action) {
  return RECOVERABLE.has(action?.type);
}

/**
 * Soft-success when a cookie/dismiss control is already gone — do not fail the turn.
 * @param {object} action
 * @param {object[]} attempts
 * @param {object} [freshObs]
 * @returns {{ recovered: true, result: object, attempts: object[], obs?: object }|null}
 */
function softSkipIfEphemeral(action, attempts, freshObs) {
  if (!isEphemeralDismissClick(action)) return null;
  attempts.push({ strategy: "soft_skip_ephemeral", name: actionDisplayName(action), ok: true });
  return {
    recovered: true,
    result: {
      ok: true,
      skipped: true,
      soft_skip: true,
      reason: "target_already_gone",
      clicked: actionDisplayName(action),
      detail: `"${actionDisplayName(action)}" not found — treating dismiss/consent as already handled`,
    },
    attempts,
    obs: freshObs,
  };
}

/**
 * Runs recovery strategies then retries the action once per strategy.
 * @param {object} params
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

  // 1b. Name/role rebind when eN + xpath are dead but the label still exists
  const nameRebound = rebindActionByName(action, freshObs.interactives || []);
  if (nameRebound && nameRebound.ref !== action.ref) {
    attempts.push({
      strategy: "name_rebind",
      from: action.ref,
      to: nameRebound.ref,
      name: nameRebound.name,
    });
    const hitName = await tryStrategy("retry_after_name_rebind", nameRebound, freshObs);
    if (hitName) return { ...hitName, obs: freshObs };
  }

  // 2. Wait for loading / DOM settle
  await waitForSemantic(page, observeFn, conditionFn, {
    timeoutMs: 4000,
    networkIdle: false,
    loadingGone: true,
    domStable: true,
  });
  freshObs = await pullObs();
  const afterWait =
    rebindActionByName(action, freshObs.interactives || []) || pre.resolvedAction || action;
  const hitWait = await tryStrategy("retry_after_wait", afterWait, freshObs);
  if (hitWait) return { ...hitWait, obs: freshObs };

  // 3. Scroll into view + precheck + retry
  const enriched = enrichLocatorAction(afterWait, freshObs);
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
      const enrichedClick = enrichLocatorAction(afterWait, freshObs);
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

  // 4b. Playwright role/name — finds nodes our stamped-ref path missed
  if (action.type === "click") {
    const wanted = actionDisplayName(afterWait);
    if (wanted) {
      try {
        const role = afterWait.role || "button";
        const loc = page.getByRole(role, { name: wanted, exact: false }).first();
        const visible = await loc.isVisible().catch(() => false);
        if (visible) {
          await loc.click({ timeout: 2500 });
          attempts.push({ strategy: "playwright_role_click", name: wanted, role, ok: true });
          return {
            recovered: true,
            result: {
              ok: true,
              clicked: wanted,
              recovery: true,
              method: "playwright_role",
            },
            attempts,
            obs: freshObs,
          };
        }
        attempts.push({ strategy: "playwright_role_click", name: wanted, ok: false });
      } catch (err) {
        attempts.push({
          strategy: "playwright_role_click",
          error: String(err?.message || err),
        });
      }
    }
  }

  // 5. Dismiss blocking cookie overlay if present (different button than the failed target)
  const overlay = freshObs?.pageHints?.blockingOverlay;
  if (overlay && action.type === "click") {
    const acceptBtn = (freshObs.interactives || []).find((i) => {
      const n = String(i.name || "").toLowerCase();
      return /accept|agree|got it|ok/.test(n);
    });
    if (acceptBtn && acceptBtn.ref !== action.ref) {
      attempts.push({ strategy: "dismiss_overlay", ref: acceptBtn.ref });
      const dismissHit = await tryStrategy(
        "dismiss_overlay_click",
        { type: "click", ref: acceptBtn.ref, name: acceptBtn.name },
        freshObs
      );
      if (dismissHit) {
        freshObs = await pullObs();
        const retryAction =
          rebindActionByName(action, freshObs.interactives || []) ||
          pre.resolvedAction ||
          action;
        const retry = await tryStrategy("retry_after_overlay", retryAction, freshObs);
        if (retry) return { ...retry, obs: freshObs };
      }
    }
  }

  // 6. Ephemeral dismiss already gone — succeed quietly (no failure for the LLM)
  const soft = softSkipIfEphemeral(action, attempts, freshObs);
  if (soft) return soft;

  // Also soft-skip when the only problem is a missing error and name looks dismiss-like
  if (
    action.type === "click" &&
    isEphemeralDismissClick(action) &&
    attempts.some((a) => a.error && isElementMissingError(a.error))
  ) {
    return softSkipIfEphemeral(action, attempts, freshObs);
  }

  return { recovered: false, attempts, obs: freshObs };
}
