/**
 * @fileoverview Failure taxonomy for browser agent actions.
 * Purpose: Classify failures so recovery and the LLM get structured signals, not generic errors.
 * Downstream: recovery.js, agent.js step results, verify.js enrichment.
 */

/** @type {readonly string[]} */
export const FAILURE_CLASSES = [
  "TARGET_NOT_FOUND",
  "TARGET_STALE",
  "TARGET_HIDDEN",
  "TARGET_DISABLED",
  "CLICK_BLOCKED",
  "ELEMENT_COVERED",
  "NAVIGATION_TIMEOUT",
  "NETWORK_TIMEOUT",
  "FORM_VALIDATION",
  "AUTH_REQUIRED",
  "CAPTCHA_DETECTED",
  "PERMISSION_REQUIRED",
  "PRECONDITION_FAILED",
  "VERIFICATION_FAILED",
  "WAIT_TIMEOUT",
  "ACTION_LOOP",
  "STOP_CONDITION",
  "UNKNOWN",
];

/**
 * @param {{ result?: object, precondition?: object, verification?: object, error?: string, loop?: object, stop?: object }} ctx
 * @returns {string}
 */
export function classifyFailure(ctx = {}) {
  const { result, precondition, verification, error, loop, stop } = ctx;

  if (stop?.type) return "STOP_CONDITION";
  if (loop?.detected) return "ACTION_LOOP";

  const preErr = precondition?.precheck?.error || precondition?.issues?.[0] || "";
  if (/STALE|stale/i.test(String(precondition?.recovery || ""))) return "TARGET_STALE";
  if (preErr === "TARGET_NOT_FOUND" || /not found/i.test(preErr)) return "TARGET_NOT_FOUND";
  if (preErr === "TARGET_HIDDEN") return "TARGET_HIDDEN";
  if (preErr === "TARGET_DISABLED") return "TARGET_DISABLED";
  if (preErr === "PRECHECK_FAILED" || precondition?.ok === false) return "PRECONDITION_FAILED";

  if (result?.failure_class && FAILURE_CLASSES.includes(result.failure_class)) {
    return result.failure_class;
  }

  const blob = `${result?.error || ""} ${error || ""}`.toLowerCase();
  if (/captcha|recaptcha|hcaptcha|robot check/.test(blob)) return "CAPTCHA_DETECTED";
  if (/timeout|timed out/.test(blob)) {
    if (/navigat|goto|url/.test(blob)) return "NAVIGATION_TIMEOUT";
    if (/network|fetch|idle/.test(blob)) return "NETWORK_TIMEOUT";
    return "WAIT_TIMEOUT";
  }
  if (/validation|invalid|required field/.test(blob)) return "FORM_VALIDATION";
  if (/sign in|login|auth|unauthorized|session/.test(blob)) return "AUTH_REQUIRED";
  if (/permission|denied|blocked/.test(blob)) return "PERMISSION_REQUIRED";
  if (/covered|obscured|intercept/.test(blob)) return "ELEMENT_COVERED";
  if (/click.*fail|could not click/.test(blob)) return "CLICK_BLOCKED";

  if (verification?.passed === false || result?.verification?.passed === false) {
    return "VERIFICATION_FAILED";
  }

  if (result?.ok === false) return "UNKNOWN";
  return undefined;
}

/**
 * Attaches failure_class and human detail to a result object.
 * @param {object} result
 * @param {object} ctx
 * @returns {object}
 */
export function attachFailureClass(result, ctx = {}) {
  const failure_class = classifyFailure({ ...ctx, result });
  if (!failure_class) return result;
  return {
    ...result,
    failure_class,
    failure_detail: result?.error || ctx.error || failure_class,
  };
}
