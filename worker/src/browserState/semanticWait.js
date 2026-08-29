/**
 * @fileoverview Semantic waits — replace blind sleep with condition-based waiting.
 * Purpose: wait_for action + post-action loading/DOM/network settle for Playwright worker.
 * Downstream: agent.js executeAction, recovery ladder.
 */

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Polls observe until interactive count stabilizes or timeout.
 * @param {import('playwright').Page} page
 * @param {Function} observeFn
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
    await sleep(120);
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

/**
 * Waits until an in-page condition matches (polls evaluate).
 * @param {import('playwright').Page} page
 * @param {Function} conditionFn - Serialized waitForConditionInPage.
 * @param {object} condition
 * @param {number} [timeoutMs=10000]
 * @returns {Promise<object>}
 */
export async function pollUntilCondition(page, conditionFn, condition, timeoutMs = 10000) {
  const start = Date.now();
  let last = { matched: false };
  while (Date.now() - start < timeoutMs) {
    last = await page.evaluate(conditionFn, condition);
    if (last?.matched) return { ...last, timedOut: false };
    await sleep(150);
  }
  return { ...last, matched: false, timedOut: true };
}

/**
 * Semantic wait combining network idle, loading gone, DOM stable, and optional conditions.
 * @param {import('playwright').Page} page
 * @param {Function} observeFn
 * @param {Function} conditionFn
 * @param {object} [opts]
 * @returns {Promise<object>}
 */
export async function waitForSemantic(page, observeFn, conditionFn, opts = {}) {
  const timeoutMs = Math.min(Number(opts.timeoutMs) || 10000, 30000);
  const result = { steps: [] };

  if (opts.networkIdle !== false) {
    try {
      await page.waitForLoadState("domcontentloaded", { timeout: Math.min(timeoutMs, 5000) });
      result.steps.push("domcontentloaded");
    } catch {
      result.steps.push("domcontentloaded_timeout");
    }
    try {
      await page.waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 6000) });
      result.steps.push("networkidle");
    } catch {
      // Why: SPAs often never reach networkidle — not a hard failure.
      result.steps.push("networkidle_skipped");
    }
  }

  if (opts.loadingGone !== false) {
    const loadingStart = Date.now();
    while (Date.now() - loadingStart < Math.min(timeoutMs, 8000)) {
      const obs = await page.evaluate(observeFn);
      const loading = Boolean(obs?.pageHints?.loading);
      if (!loading) {
        result.steps.push("loading_gone");
        break;
      }
      await sleep(200);
    }
  }

  if (opts.domStable !== false) {
    await waitForDomSettle(page, observeFn, {
      timeoutMs: Math.min(timeoutMs, 2000),
      stableMs: opts.stableMs ?? 250,
    });
    result.steps.push("dom_stable");
  }

  if (opts.condition && conditionFn) {
    const hit = await pollUntilCondition(page, conditionFn, opts.condition, timeoutMs);
    result.condition = hit;
    result.steps.push(hit.matched ? "condition_met" : "condition_timeout");
  }

  return result;
}

/**
 * Executes a wait_for action from the LLM.
 * @param {import('playwright').Page} page
 * @param {Function} observeFn
 * @param {Function} conditionFn
 * @param {object} action
 * @returns {Promise<object>}
 */
export async function executeWaitFor(page, observeFn, conditionFn, action) {
  const timeoutMs = Math.min(Number(action.timeout_ms ?? action.timeoutMs ?? 3000), 8000);
  const condition = {
    url: action.url || action.url_contains || undefined,
    url_matches: action.url_matches || undefined,
    text: action.text || action.text_contains || undefined,
    role: action.role || undefined,
    name: action.name || action.name_contains || undefined,
    ref: action.ref || undefined,
    loading_gone: action.loading_gone !== false,
  };

  const hasExplicitCondition = Boolean(
    condition.url || condition.url_matches || condition.text || condition.role || condition.name || condition.ref
  );

  // Why: LLM often emits wait_for with no real target (or invented site phrases). Page readiness
  // is already handled by domcontentloaded + immediate snapshot — do not burn time failing UNKNOWN.
  if (!hasExplicitCondition) {
    return {
      ok: true,
      wait_for: true,
      skipped: true,
      reason: "no_explicit_condition",
      note: "Skipped wait_for — use CURRENT PAGE SNAPSHOT (already post-domcontentloaded).",
    };
  }

  const semantic = await waitForSemantic(page, observeFn, conditionFn, {
    timeoutMs,
    networkIdle: Boolean(action.network_idle),
    loadingGone: false,
    domStable: false,
    condition,
  });

  const matched = semantic.condition?.matched === true;
  const timedOut = semantic.condition?.timedOut === true;

  // Why: treat timeout as soft success so the next turn observes reality instead of FORM-style fail spam.
  return {
    ok: true,
    wait_for: true,
    condition,
    semantic,
    timedOut,
    matched,
    failure_class: timedOut && !matched ? "WAIT_TIMEOUT" : undefined,
    note: matched
      ? "Condition met"
      : "Condition not met in time — continue from CURRENT PAGE SNAPSHOT (do not invent wait text).",
  };
}
