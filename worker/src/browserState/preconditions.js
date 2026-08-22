/**
 * @fileoverview Action preconditions and stale-ref recovery via fingerprints.
 * Purpose: Block impossible actions early; re-resolve eN refs after React rerenders.
 * Downstream: agent.js before executeAction.
 */

import { buildFingerprint, findByFingerprint } from "./fingerprints.js";

const LOCATOR_ACTIONS = new Set(["click", "type", "select"]);

/**
 * @param {object} action
 * @returns {boolean}
 */
function needsLocator(action) {
  return LOCATOR_ACTIONS.has(action?.type) && Boolean(action?.ref || action?.name || action?.css);
}

/**
 * Checks whether an action can run against the current observation.
 * @param {object} action
 * @param {object} obs - Current observation.
 * @param {object|null} prevObs - Previous observation (for stale ref recovery).
 * @returns {{ ok: boolean, issues: string[], resolvedAction?: object, resolvedRef?: string, recovery?: string }}
 */
export function checkPreconditions(action, obs, prevObs = null) {
  if (!needsLocator(action)) {
    return { ok: true, issues: [] };
  }

  const issues = [];
  let resolvedAction = { ...action };
  let resolvedRef;
  let recovery;

  const interactives = obs?.interactives || [];
  let item = action.ref ? interactives.find((i) => i.ref === action.ref) : null;

  if (action.ref && !item && prevObs) {
    const stale = (prevObs.interactives || []).find((i) => i.ref === action.ref);
    if (stale) {
      const match = findByFingerprint(stale, interactives);
      if (match) {
        item = match.item;
        resolvedRef = match.item.ref;
        resolvedAction = {
          ...action,
          ref: match.item.ref,
          role: action.role || match.item.role,
          name: action.name || match.item.name,
          css: action.css || match.item.cssHint,
          xpath: action.xpath || match.item.xpath,
        };
        recovery = `STALE_REF ${action.ref} → ${match.item.ref} (fingerprint score ${match.score})`;
      } else {
        issues.push(`REF ${action.ref} STALE — could not re-resolve by fingerprint`);
      }
    } else {
      issues.push(`REF ${action.ref} not found in current observation`);
    }
  } else if (action.ref && !item) {
    issues.push(`REF ${action.ref} not found`);
  }

  if (item?.disabled) issues.push(`TARGET ${item.ref} is disabled`);
  if (item && item.visible === false) issues.push(`TARGET ${item.ref} is not visible`);

  return {
    ok: issues.length === 0,
    issues,
    resolvedAction: issues.length === 0 ? resolvedAction : action,
    resolvedRef,
    recovery,
  };
}

/**
 * Merges fingerprint onto interactives when missing (Node-side enrichment).
 * @param {object} obs
 * @returns {object}
 */
export function attachFingerprints(obs) {
  if (!obs?.interactives) return obs;
  return {
    ...obs,
    interactives: obs.interactives.map((item) => ({
      ...item,
      fingerprint: item.fingerprint || buildFingerprint(item),
    })),
  };
}
