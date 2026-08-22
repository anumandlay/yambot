/**
 * @fileoverview Structured stop conditions — CAPTCHA, auth, payment boundaries.
 * Purpose: Tell the agent when to pause, ask_user, or finish instead of wandering.
 * Downstream: agent.js before LLM step; complements handleCaptchaIfPresent.
 */

/**
 * Detects payment/checkout screens (for "stop before payment" goals).
 * @param {object} obs
 * @param {object} pageState
 * @returns {boolean}
 */
function isPaymentScreen(obs, pageState) {
  const blob = `${obs?.url || ""} ${obs?.title || ""} ${(obs?.text || "").slice(0, 3000)}`.toLowerCase();
  return (
    /\/checkout\/payment|\/pay\b|\/billing|payment method|card number|cvv|expiry|place order|complete purchase/.test(
      blob
    ) && /pay|card|billing|checkout/.test(blob)
  );
}

/**
 * Whether the goal explicitly asks to stop before payment.
 * @param {string} goal
 * @returns {boolean}
 */
function goalStopsBeforePayment(goal) {
  return /stop before payment|do not pay|don't pay|no payment|before payment|without paying/i.test(
    String(goal || "")
  );
}

/**
 * Evaluates stop conditions from page state + goal.
 * @param {object} pageState
 * @param {object} obs
 * @param {string} goal
 * @param {object} [agentSnapshot]
 * @returns {{ stops: object[], hints: string[], shouldPause: boolean, shouldFinish?: boolean, finishSummary?: string }}
 */
export function evaluateStopConditions(pageState, obs, goal, agentSnapshot = null) {
  const stops = [];
  const hints = [];

  if (pageState?.captcha?.present) {
    stops.push({
      type: "CAPTCHA_DETECTED",
      severity: "high",
      message: "CAPTCHA / bot check visible — call solve_captcha or ask_user; do not retry login fields.",
    });
  }

  if (pageState?.auth?.state === "mfa_required") {
    stops.push({
      type: "MFA_REQUIRED",
      severity: "high",
      message: "MFA / verification code required — ask_user for the code or use check_email if configured.",
    });
  }

  if (pageState?.auth?.state === "session_expired") {
    stops.push({
      type: "AUTH_REQUIRED",
      severity: "medium",
      message: "Session may have expired — re-authenticate or ask_user.",
    });
  }

  if (pageState?.ui?.blocking_overlay) {
    stops.push({
      type: "BLOCKING_OVERLAY",
      severity: "medium",
      message: `Blocking overlay detected: "${pageState.ui.blocking_overlay}" — dismiss it first (e.g. Accept cookies).`,
    });
    hints.push(`Dismiss overlay: "${pageState.ui.blocking_overlay}"`);
  }

  if (goalStopsBeforePayment(goal) && isPaymentScreen(obs, pageState)) {
    stops.push({
      type: "PAYMENT_BOUNDARY",
      severity: "high",
      message: "Payment screen reached — goal says stop before payment. Call finish with summary.",
    });
    return {
      stops,
      hints,
      shouldPause: false,
      shouldFinish: true,
      finishSummary:
        "Reached payment/checkout screen. Stopping before payment as requested in the goal.",
    };
  }

  if (agentSnapshot?.autonomy?.askBeforeLogin && pageState?.auth?.state === "login_required") {
    stops.push({
      type: "LOGIN_CONFIRMATION",
      severity: "medium",
      message: "Login screen — confirm with ask_user before entering credentials unless user pre-approved.",
    });
  }

  const shouldPause = stops.some((s) => s.severity === "high" && s.type !== "PAYMENT_BOUNDARY");

  if (stops.length) {
    hints.push(
      ...stops.map((s) => `STOP [${s.type}]: ${s.message}`)
    );
  }

  return { stops, hints, shouldPause, shouldFinish: false };
}

/**
 * Formats stop hints for the LLM user message.
 * @param {object} evaluation
 * @returns {string}
 */
export function formatStopHints(evaluation) {
  if (!evaluation?.hints?.length) return "";
  return `STOP CONDITIONS / HINTS:\n${evaluation.hints.join("\n")}`;
}
