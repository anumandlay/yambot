/**
 * @fileoverview DOM observation diff between agent steps.
 * Purpose: Compact "what changed" instead of resending the full page every step.
 * Downstream: agent loop, format.js, verify.js effects.
 */

import { buildFingerprint } from "./fingerprints.js";

/**
 * Maps interactives by ref for quick lookup.
 * @param {object[]} interactives
 * @returns {Map<string, object>}
 */
function refMap(interactives) {
  const map = new Map();
  for (const item of interactives || []) {
    if (item?.ref) map.set(item.ref, item);
  }
  return map;
}

/**
 * Fingerprints interactives that lack a ref key (fallback matching).
 * @param {object[]} interactives
 * @returns {Map<string, object>}
 */
function fingerprintKeyMap(interactives) {
  const map = new Map();
  for (const item of interactives || []) {
    const fp = item.fingerprint || buildFingerprint(item);
    const key = JSON.stringify([
      fp.role,
      fp.name,
      fp.testid,
      fp.href,
      fp.nearby_text,
    ]);
    map.set(key, item);
  }
  return map;
}

/**
 * Diffs two page observations.
 * @param {object|null} before
 * @param {object|null} after
 * @returns {object}
 */
export function diffObservations(before, after) {
  if (!before || !after) {
    return {
      url_changed: false,
      title_changed: false,
      dom_changed: false,
      menu_count_changed: false,
      added_refs: [],
      removed_refs: [],
      modified_refs: [],
      new_elements: [],
      removed_elements: [],
    };
  }

  const beforeRefs = refMap(before.interactives);
  const afterRefs = refMap(after.interactives);
  const urlChanged = String(before.url || "") !== String(after.url || "");
  const titleChanged = String(before.title || "") !== String(after.title || "");
  const beforeMenuCount = (before.openMenus || []).length;
  const afterMenuCount = (after.openMenus || []).length;

  const addedRefs = [];
  const removedRefs = [];
  const modifiedRefs = [];

  for (const ref of afterRefs.keys()) {
    if (!beforeRefs.has(ref)) addedRefs.push(ref);
  }
  for (const ref of beforeRefs.keys()) {
    if (!afterRefs.has(ref)) removedRefs.push(ref);
  }

  for (const ref of afterRefs.keys()) {
    if (!beforeRefs.has(ref)) continue;
    const a = beforeRefs.get(ref);
    const b = afterRefs.get(ref);
    if (String(a.value || "") !== String(b.value || "")) {
      modifiedRefs.push({ ref, field: "value", from: a.value, to: b.value });
    }
    if (Boolean(a.overlay) !== Boolean(b.overlay)) {
      modifiedRefs.push({ ref, field: "overlay", from: a.overlay, to: b.overlay });
    }
  }

  // Why: React rerenders often rotate refs — match removed→added by fingerprint.
  const afterFpMap = fingerprintKeyMap(
    (after.interactives || []).filter((i) => addedRefs.includes(i.ref))
  );
  const newElements = [];
  const removedElements = [];

  for (const ref of removedRefs) {
    const item = beforeRefs.get(ref);
    if (!item) continue;
    const fp = item.fingerprint || buildFingerprint(item);
    const key = JSON.stringify([fp.role, fp.name, fp.testid, fp.href, fp.nearby_text]);
    const replacement = afterFpMap.get(key);
    removedElements.push({
      ref,
      name: item.name,
      role: item.role,
      replaced_by: replacement?.ref,
    });
  }

  for (const ref of addedRefs) {
    const item = afterRefs.get(ref);
    if (!item) continue;
    newElements.push({ ref, name: item.name, role: item.role });
  }

  const domChanged =
    addedRefs.length > 0 ||
    removedRefs.length > 0 ||
    modifiedRefs.length > 0 ||
    beforeMenuCount !== afterMenuCount;

  return {
    url_changed: urlChanged,
    title_changed: titleChanged,
    dom_changed: domChanged,
    menu_count_changed: beforeMenuCount !== afterMenuCount,
    open_menus_before: beforeMenuCount,
    open_menus_after: afterMenuCount,
    added_refs: addedRefs.slice(0, 40),
    removed_refs: removedRefs.slice(0, 40),
    modified_refs: modifiedRefs.slice(0, 20),
    new_elements: newElements.slice(0, 30),
    removed_elements: removedElements.slice(0, 30),
  };
}
