/**
 * @fileoverview Hard guards for ask_user that waste runs (CUA permission / signup password).
 * Purpose: Skip ask_user loops that previously ballooned register tasks to 60+ LLM turns.
 * Downstream: agent.js ask_user action handler.
 */

/** Dummy credentials for signup when the human did not supply any. */
export const SIGNUP_DUMMY_PASSWORD = "DummyPass123!";
export const SIGNUP_DUMMY_EMAIL = "travel.agency.demo@example.com";

/**
 * ask_user about CUA / browser permission policy — never wait on the human for this.
 * @param {string} question
 * @returns {boolean}
 */
export function isCuaPermissionAsk(question) {
  const q = String(question || "");
  return (
    /permission\s*policy/i.test(q) ||
    /text[- ]?entry.*(block|enable|authoriz|denied|unavailable)/i.test(q) ||
    /enable\s+cua/i.test(q) ||
    /cua.*(type|text|permission|typ(ing|e)\s+block)/i.test(q) ||
    /blocked by.*(browser|permission|cua)/i.test(q) ||
    /take control.*(permission|text[- ]?entry|cua)/i.test(q)
  );
}

/**
 * Whether this run looks like account registration / signup.
 * @param {string} goal
 * @param {string} [summary]
 * @returns {boolean}
 */
export function looksLikeSignupGoal(goal, summary = "") {
  const blob = `${goal || ""}\n${summary || ""}`;
  return /sign\s*up|register|create\s+(an?\s+)?account|onboard|join\s+(as|now)|new\s+account|travel\s+agency/i.test(
    blob
  );
}

/**
 * Goal already includes credentials the agent should use.
 * @param {string} text
 * @returns {boolean}
 */
export function goalIncludesCredentials(text) {
  const g = String(text || "");
  return (
    /password\s*[:=]/i.test(g) ||
    /(?:email|username|user)\s*[:=]/i.test(g) ||
    (/@[\w.-]+\.\w{2,}/.test(g) && /pass(word|wd)?/i.test(g)) ||
    /credentials?\s+(provided|included|in\s+goal|are|is)/i.test(g) ||
    /login with/i.test(g) ||
    /provided credentials/i.test(g)
  );
}

/**
 * ask_user requesting a password/email for a signup goal with no credentials provided.
 * @param {string} question
 * @param {string} goal
 * @returns {boolean}
 */
export function isSignupCredentialAsk(question, goal) {
  if (!looksLikeSignupGoal(goal)) return false;
  if (goalIncludesCredentials(goal)) return false;
  const q = String(question || "");
  return /pass(word)?|pwd|email|e-mail|username|credential|dummy/i.test(q);
}

/**
 * Resolve ask_user that should be auto-answered / skipped.
 * @param {{ question: string, goal?: string }} opts
 * @returns {{ skip: boolean, reason?: string, userAnswer?: string, detail?: string }|null}
 */
export function resolveAskUserGuard(opts) {
  const question = String(opts?.question || "");
  const goal = String(opts?.goal || "");

  if (isCuaPermissionAsk(question)) {
    return {
      skip: true,
      reason: "cua_permission",
      userAnswer:
        "CUA typing is allowed — do NOT ask again about permission policy. Click the field, then computer_use type (type_text). If type fails once, retry after click; continue the form with dummy values.",
      detail:
        "Skipped ask_user about CUA permission — continue typing with computer_use type.",
    };
  }

  if (isSignupCredentialAsk(question, goal)) {
    return {
      skip: true,
      reason: "signup_dummy",
      userAnswer: `Use dummy signup details without asking again. Password: ${SIGNUP_DUMMY_PASSWORD}. Email: ${SIGNUP_DUMMY_EMAIL}. Fill other agency fields with plausible dummy data and submit.`,
      detail: `Skipped ask_user for signup credentials — use dummy password ${SIGNUP_DUMMY_PASSWORD}.`,
    };
  }

  return null;
}
