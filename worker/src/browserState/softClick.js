/**
 * @fileoverview Soft-miss helpers for ephemeral UI (cookie banners, toasts, “Got it”).
 * Purpose: Avoid hard-failing clicks when the control is already gone or only the eN ref went stale.
 * Downstream: recovery.js, preconditions.js, agent.js.
 */

/** Consent / dismiss labels that often vanish before the click runs. */
export const EPHEMERAL_DISMISS_RE =
  /^(got it!?|ok|okay|accept(\s+all)?|i\s+agree|agree|allow(\s+all)?|i\s+understand|close|dismiss|continue|understood|thanks?|not now|no thanks|reject(\s+all)?|×|✕|x)$/i;

/**
 * @param {object} action
 * @returns {string}
 */
export function actionDisplayName(action) {
  return String(action?.name || action?.label || action?.open_name || "").trim();
}

/**
 * Cookie/consent/dismiss buttons that are safe to treat as already handled when missing.
 * @param {object} action
 * @returns {boolean}
 */
export function isEphemeralDismissClick(action) {
  if (action?.type && action.type !== "click") return false;
  const name = actionDisplayName(action);
  if (name && EPHEMERAL_DISMISS_RE.test(name)) return true;
  const blob = `${action?.css || ""} ${action?.xpath || ""} ${name}`.toLowerCase();
  return /cookie|consent|gdpr|onetrust|banner/.test(blob) && /button|accept|agree|got/.test(blob);
}

/**
 * Whether an error looks like a missing/stale locator (safe to soft-skip for ephemeral targets).
 * @param {unknown} error
 * @returns {boolean}
 */
export function isElementMissingError(error) {
  const text = String(error?.message || error || "");
  return /Element not found|TARGET_NOT_FOUND|REF .+ not found|STALE|could not re-resolve/i.test(
    text
  );
}

/**
 * Rebinds a stale action to a fresh interactive by name/role (drops dead ref/xpath).
 * @param {object} action
 * @param {object[]} interactives
 * @returns {object|null} rebound action or null
 */
export function rebindActionByName(action, interactives) {
  const wanted = actionDisplayName(action).toLowerCase();
  if (!wanted || !Array.isArray(interactives) || !interactives.length) return null;

  const role = String(action.role || "").toLowerCase();
  let best = null;
  let bestScore = 0;

  for (const item of interactives) {
    if (item?.disabled) continue;
    const name = String(item.name || "").toLowerCase().trim();
    if (!name) continue;
    let score = 0;
    if (name === wanted) score = 100;
    else if (name.startsWith(wanted) || wanted.startsWith(name)) score = 70;
    else if (name.includes(wanted) || wanted.includes(name)) score = 40;
    if (score <= 0) continue;
    if (role && String(item.role || "").toLowerCase() === role) score += 15;
    if (item.overlay) score += 8;
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }

  if (!best) return null;
  return {
    ...action,
    ref: best.ref,
    role: action.role || best.role,
    name: action.name || best.name,
    label: action.label || best.name,
    css: best.cssHint || action.css,
    // Why: absolute xpath from a previous render is the usual poison after React reorders.
    xpath: best.xpath || undefined,
    fingerprint: best.fingerprint || action.fingerprint,
    frameId: best.frameId || action.frameId,
    _reboundFrom: action.ref,
  };
}
