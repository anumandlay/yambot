/**
 * @fileoverview High-level browser macros — fill_form, dismiss_dialog, choose_menu_item.
 * Purpose: Phase 4 composite actions that chain locator steps without LLM micro-management.
 * Downstream: worker/src/agent.js executeAction.
 */

import { buildStructuresFromObs } from "./structures.js";
import { clickMenuSegmentInPage } from "../pageDom.js";

const DISMISS_RE =
  /^(cancel|close|dismiss|not now|no thanks|skip|maybe later|×|✕|x)$/i;

/**
 * Finds a form in observation structures by id, name, or index.
 * @param {object} obs
 * @param {string|number} formKey
 * @returns {object|null}
 */
function resolveForm(obs, formKey) {
  const structures = obs?.structures || buildStructuresFromObs(obs);
  const forms = structures.forms || [];
  if (!forms.length) return null;
  if (formKey == null || formKey === "") return forms[0];
  if (typeof formKey === "number" || /^\d+$/.test(String(formKey))) {
    const idx = Number(formKey);
    return forms[idx] || null;
  }
  const key = String(formKey).toLowerCase();
  return (
    forms.find(
      (f) =>
        String(f.id || "").toLowerCase() === key ||
        String(f.name || "").toLowerCase() === key ||
        String(f.name || "")
          .toLowerCase()
          .includes(key)
    ) || null
  );
}

/**
 * Matches a form field entry by label/name key.
 * @param {object[]} fields
 * @param {string} key
 * @returns {object|null}
 */
function matchField(fields, key) {
  const wanted = String(key).toLowerCase().trim();
  return (
    fields.find((f) => {
      const name = String(f.name || f.ref || "").toLowerCase();
      return name === wanted || name.includes(wanted) || wanted.includes(name);
    }) || null
  );
}

/**
 * Fills a form using structure refs and executeInPage type actions.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame
 * @param {Function} executeInPage
 * @param {Function} enrichLocatorAction
 * @param {object} action
 * @param {object} obs
 * @returns {Promise<object>}
 */
export async function runFillForm(page, frame, executeInPage, enrichLocatorAction, action, obs) {
  const form = resolveForm(obs, action.form ?? action.form_id ?? action.form_name ?? 0);
  if (!form) {
    return { ok: false, error: "FORM_NOT_FOUND", form: action.form };
  }

  const fields = action.fields && typeof action.fields === "object" ? action.fields : {};
  const filled = [];
  const errors = [];

  for (const [fieldKey, value] of Object.entries(fields)) {
    const field = matchField(form.fields || [], fieldKey);
    if (!field?.ref) {
      errors.push({ field: fieldKey, error: "FIELD_NOT_FOUND" });
      continue;
    }
    const typeAction = enrichLocatorAction(
      { type: "type", ref: field.ref, text: String(value ?? ""), submit: false },
      obs
    );
    try {
      const result = await frame.evaluate(executeInPage, typeAction);
      filled.push({ field: fieldKey, ref: field.ref, ok: result?.ok !== false });
      if (result?.ok === false) errors.push({ field: fieldKey, error: result.error || "TYPE_FAILED" });
    } catch (err) {
      errors.push({ field: fieldKey, error: String(err?.message || err) });
    }
  }

  let submitted = false;
  if (action.submit) {
    const submitBtn =
      (action.submit_ref &&
        (form.actions || []).find((a) => a.ref === action.submit_ref)) ||
      (form.actions || []).find((a) => /submit|send|continue|apply|sign in/i.test(a.name || "")) ||
      (form.actions || [])[0];
    if (submitBtn?.ref) {
      const clickAction = enrichLocatorAction(
        { type: "click", ref: submitBtn.ref, name: submitBtn.name },
        obs
      );
      const point = await frame.evaluate(executeInPage, { ...clickAction, type: "resolve_point" });
      await page.mouse.click(point.x, point.y, { delay: 40 });
      submitted = true;
    }
  }

  return {
    ok: errors.length === 0,
    filled,
    submitted,
    form: form.name || form.id,
    errors: errors.length ? errors : undefined,
  };
}

/**
 * Dismisses the topmost open dialog via cancel/close button or Escape.
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame
 * @param {Function} executeInPage
 * @param {object} action
 * @param {object} obs
 * @returns {Promise<object>}
 */
export async function runDismissDialog(page, frame, executeInPage, action, obs) {
  const structures = obs?.structures || buildStructuresFromObs(obs);
  const dialog = (structures.dialogs || [])[0];
  const wantedButton = String(action.button || action.name || "").trim();

  let target = null;
  if (dialog?.actions?.length) {
    if (wantedButton) {
      const w = wantedButton.toLowerCase();
      target = dialog.actions.find((a) => String(a.name || "").toLowerCase().includes(w));
    }
    if (!target) {
      target = dialog.actions.find((a) => DISMISS_RE.test(String(a.name || "").trim()));
    }
    if (!target) {
      target = dialog.actions.find((a) =>
        /cancel|close|dismiss|not now|no|skip/i.test(a.name || "")
      );
    }
  }

  if (target?.ref) {
    const point = await frame.evaluate(executeInPage, {
      type: "resolve_point",
      ref: target.ref,
      name: target.name,
    });
    await page.mouse.click(point.x, point.y, { delay: 40 });
    return { ok: true, method: "click", clicked: target.name, ref: target.ref };
  }

  await page.keyboard.press("Escape");
  return { ok: true, method: "escape", note: "No dismiss button found — sent Escape" };
}

/**
 * Walks an open menu path (e.g. ["File", "Export", "PDF"]).
 * @param {import('playwright').Page} page
 * @param {import('playwright').Frame} frame
 * @param {object} action
 * @returns {Promise<object>}
 */
export async function runChooseMenuItem(page, frame, action) {
  const path = Array.isArray(action.path)
    ? action.path.map(String).filter(Boolean)
    : action.name
      ? [String(action.name)]
      : [];
  if (!path.length) {
    return { ok: false, error: "MENU_PATH_REQUIRED" };
  }

  const clicked = [];
  for (let i = 0; i < path.length; i += 1) {
    const segment = path[i];
    const hit = await frame.evaluate(clickMenuSegmentInPage, segment);
    if (!hit?.ok) {
      return {
        ok: false,
        error: hit?.error || "MENU_ITEM_NOT_FOUND",
        segment,
        path: clicked,
      };
    }
    await page.mouse.click(hit.x, hit.y, { delay: 40 });
    clicked.push(hit.name || segment);
    const isLast = i === path.length - 1;
    if (hit.hasSubmenu && !isLast) {
      await sleep(350);
    }
  }

  return { ok: true, path: clicked };
}

/**
 * @param {number} ms
 */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
