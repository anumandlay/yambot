/**
 * @fileoverview Action preconditions and stale-ref recovery via fingerprints.
 * Purpose: Block impossible actions early; re-resolve eN refs after React rerenders.
 * Downstream: agent.js before executeAction.
 */

import { buildFingerprint, findByFingerprint } from "./fingerprints.js";
import { rebindActionByName } from "./softClick.js";

const LOCATOR_ACTIONS = new Set(["click", "type", "select", "choose_searchable"]);

/**
 * @param {object} action
 * @returns {boolean}
 */
function needsLocator(action) {
  return LOCATOR_ACTIONS.has(action?.type) && Boolean(action?.ref || action?.name || action?.css);
}

/**
 * Checks whether an action can run against the current observation.
 * Why: A dead eN must not hard-block when name/css can still resolve in-page.
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
          xpath: match.item.xpath || action.xpath,
        };
        recovery = `STALE_REF ${action.ref} → ${match.item.ref} (fingerprint score ${match.score})`;
      } else {
        const byName = rebindActionByName(
          {
            ...action,
            name: action.name || stale.name,
            role: action.role || stale.role,
            label: action.label || stale.name,
          },
          interactives
        );
        if (byName) {
          item = interactives.find((i) => i.ref === byName.ref) || null;
          resolvedRef = byName.ref;
          resolvedAction = byName;
          recovery = `STALE_REF ${action.ref} → ${byName.ref} (name rebind "${byName.name}")`;
        } else if (action.name || action.label || action.css || action.xpath || stale.name) {
          // Why: still allow executeAction — in-page resolveElement can match by name/css.
          resolvedAction = {
            ...action,
            name: action.name || stale.name,
            role: action.role || stale.role,
            label: action.label || stale.name,
            // Drop poisoned absolute xpath; keep name path alive.
            xpath: action.xpath && !String(action.xpath).startsWith("/body")
              ? action.xpath
              : undefined,
          };
          recovery = `STALE_REF ${action.ref} — trying name/css without blocking`;
        } else {
          issues.push(`REF ${action.ref} STALE — could not re-resolve by fingerprint`);
        }
      }
    } else if (action.name || action.label || action.css || action.xpath) {
      const byName = rebindActionByName(action, interactives);
      if (byName) {
        item = interactives.find((i) => i.ref === byName.ref) || null;
        resolvedRef = byName.ref;
        resolvedAction = byName;
        recovery = `REF ${action.ref} missing — name rebind → ${byName.ref}`;
      } else {
        recovery = `REF ${action.ref} missing — allowing name/css resolve`;
      }
    } else {
      issues.push(`REF ${action.ref} not found in current observation`);
    }
  } else if (action.ref && !item) {
    if (action.name || action.label || action.css || action.xpath) {
      const byName = rebindActionByName(action, interactives);
      if (byName) {
        item = interactives.find((i) => i.ref === byName.ref) || null;
        resolvedRef = byName.ref;
        resolvedAction = byName;
        recovery = `REF ${action.ref} missing — name rebind → ${byName.ref}`;
      } else {
        recovery = `REF ${action.ref} missing — allowing name/css resolve`;
      }
    } else {
      issues.push(`REF ${action.ref} not found`);
    }
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
