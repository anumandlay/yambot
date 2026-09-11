/**
 * @fileoverview Compact action-surface serializer (Browser-Use–style page map).
 * Purpose: Give the LLM a short indexed list of clickable/typeable controls instead of a noisy dump.
 * Downstream: format.js projection; agent still acts with existing refs (e12 / frame_1_e3).
 *
 * Why: Browser-Use wins clarity by filtering hard and numbering interactives — not by forking Chromium.
 * YamBot already has refs; this formats them as a stable action surface and marks what is new.
 */

import { scoreInteractives } from "./relevance.js";

/**
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
function clip(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Human role/tag token for one interactive (button, textbox, link, …).
 * @param {object} el
 * @returns {string}
 */
function surfaceKind(el) {
  const role = String(el.role || "").toLowerCase();
  const tag = String(el.tag || "").toLowerCase();
  const type = String(el.type || "").toLowerCase();
  if (role) return role;
  if (tag === "a") return "link";
  if (tag === "button") return "button";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (tag === "input") {
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "submit" || type === "button") return "button";
    if (type === "file") return "file";
    return "textbox";
  }
  return tag || "control";
}

/**
 * Drop noise that wastes prompt tokens and confuses the model.
 * @param {object} el
 * @returns {boolean}
 */
export function isUsefulActionTarget(el) {
  if (!el?.ref) return false;
  const name = String(el.name || "").trim();
  const role = String(el.role || "").toLowerCase();
  const tag = String(el.tag || "").toLowerCase();
  const type = String(el.type || "").toLowerCase();
  if (el.disabled) return false;
  if (["script", "style", "meta", "link", "noscript"].includes(tag)) return false;
  if (!name && ["div", "span", "p", "section", "article"].includes(tag) && !role) {
    return false;
  }
  if (type === "hidden") return false;
  return true;
}

/**
 * One compact line: [e12*] button "Sign in"
 * @param {object} el
 * @param {Set<string>} newRefs
 * @returns {string}
 */
export function formatActionSurfaceLine(el, newRefs) {
  const ref = String(el.ref);
  const isNew = newRefs.has(ref);
  const kind = surfaceKind(el);
  const name = clip(el.name || el.ariaLabel || el.testid || ref, 60);
  const bits = [`[${ref}${isNew ? "*" : ""}] ${kind} "${name}"`];
  if (el.value) bits.push(`value="${clip(el.value, 40)}"`);
  if (el.overlay) bits.push("[overlay]");
  if (el.searchable) bits.push("[searchable]");
  if (el.hasSubmenu) bits.push("[submenu]");
  if (el.frameId && el.frameId !== "main") bits.push(`frame=${el.frameId}`);
  if (el.shadowHost) bits.push("[shadow]");
  if (!String(el.name || "").trim() && el.cssHint) bits.push(`css=${clip(el.cssHint, 40)}`);
  return bits.join(" ");
}

/**
 * Builds the ranked, filtered action surface for the LLM prompt.
 * @param {object[]} interactives
 * @param {{
 *   goal?: string,
 *   currentSubgoal?: string,
 *   addedRefs?: string[],
 *   max?: number,
 * }} [opts]
 * @returns {{ lines: string[], block: string, count: number, newCount: number, refs: string[] }}
 */
export function buildActionSurface(interactives, opts = {}) {
  const max = Math.max(8, Math.min(80, Number(opts.max) || 50));
  const added = new Set((opts.addedRefs || []).map(String));
  const usable = (interactives || []).filter(isUsefulActionTarget);
  const ranked = scoreInteractives(usable, opts.goal || "", opts.currentSubgoal || "");

  // Why: newly appeared controls (menus, dialogs) should float up even if goal tokens miss them.
  ranked.sort((a, b) => {
    const an = added.has(String(a.ref)) ? 1 : 0;
    const bn = added.has(String(b.ref)) ? 1 : 0;
    if (an !== bn) return bn - an;
    if (Boolean(b.overlay) !== Boolean(a.overlay)) return Number(b.overlay) - Number(a.overlay);
    return (b.relevance || 0) - (a.relevance || 0);
  });

  const picked = ranked.slice(0, max);
  const lines = picked.map((el) => formatActionSurfaceLine(el, added));
  const newCount = picked.filter((el) => added.has(String(el.ref))).length;
  const block = [
    `ACTION SURFACE (${picked.length} controls — use ref in actions[]; * = new since last step):`,
    ...lines,
    "Click/type these refs. Prefer a multi-action batch when several controls above are needed.",
  ].join("\n");

  return {
    lines,
    block,
    count: picked.length,
    newCount,
    refs: picked.map((el) => String(el.ref)),
  };
}
