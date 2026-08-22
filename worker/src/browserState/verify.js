/**
 * @fileoverview Post-action verification — code-first checks before next LLM turn.
 * Purpose: Return facts (DOM changed, value set) so the LLM reasons from evidence.
 * Downstream: agent.js executeAction wrapper.
 */

import { diffObservations } from "./diff.js";
import { attachFailureClass } from "./failureClass.js";
import { buildPageState, computeStateChange } from "./pageState.js";

/**
 * @param {object} action
 * @param {object} beforeObs
 * @param {object} afterObs
 * @param {object} domResult - Raw executeAction result.
 * @returns {object}
 */
export function verifyAction(action, beforeObs, afterObs, domResult = {}) {
  const diff = diffObservations(beforeObs, afterObs);
  const beforeState = buildPageState(beforeObs);
  const afterState = buildPageState(afterObs);
  const stateChange = computeStateChange(beforeState, afterState);

  const effects = {
    url_changed: diff.url_changed,
    title_changed: diff.title_changed,
    dom_changed: diff.dom_changed,
    new_elements: diff.added_refs,
    removed_elements: diff.removed_refs,
    modified_elements: diff.modified_refs.map((m) => m.ref),
    menu_opened: !beforeState.ui?.menu_open && Boolean(afterState.ui?.menu_open),
    menu_closed: Boolean(beforeState.ui?.menu_open) && !afterState.ui?.menu_open,
    modal_opened: !beforeState.ui?.modal_open && Boolean(afterState.ui?.modal_open),
    modal_closed: Boolean(beforeState.ui?.modal_open) && !afterState.ui?.modal_open,
  };

  const base = {
    action: action?.type,
    target: action?.ref || action?.url || action?.name || undefined,
    effects,
    state_change: stateChange,
    passed: true,
    expected_condition: undefined,
    detail: undefined,
  };

  if (domResult?.ok === false) {
    return {
      ...base,
      passed: false,
      expected_condition: "action_succeeds",
      detail: domResult.error || "Action returned ok:false",
    };
  }

  switch (action?.type) {
    case "click": {
      const changed =
        effects.url_changed ||
        effects.dom_changed ||
        effects.menu_opened ||
        effects.menu_closed ||
        effects.modal_opened ||
        effects.modal_closed;
      return {
        ...base,
        passed: changed || domResult?.ok === true,
        expected_condition: "url_or_dom_or_overlay_change",
        detail: changed ? "Page state changed after click" : "No observable change after click",
      };
    }
    case "type": {
      const ref = action.ref;
      const intended = String(action.text ?? "");
      let actual = "";
      if (ref && afterObs?.interactives) {
        const el = afterObs.interactives.find((i) => i.ref === ref);
        actual = String(el?.value || el?.textContent || "");
      }
      const valueOk =
        !intended ||
        actual.includes(intended.slice(0, Math.min(intended.length, 40))) ||
        domResult?.contentEditable ||
        domResult?.typed;
      return {
        ...base,
        passed: valueOk,
        expected_condition: "input_value_matches",
        detail: valueOk
          ? "Typed value present"
          : `Expected text not reflected in field (got "${actual.slice(0, 60)}")`,
      };
    }
    case "select": {
      const wanted = String(action.value ?? "");
      const selected = String(domResult?.selected || "");
      const passed =
        !wanted ||
        selected.toLowerCase().includes(wanted.toLowerCase()) ||
        diff.dom_changed;
      return {
        ...base,
        passed,
        expected_condition: "option_selected_or_dom_change",
        detail: passed ? `Selected: ${selected || wanted}` : `Option not confirmed: ${wanted}`,
      };
    }
    case "navigate": {
      const target = String(action.url || "").replace(/\/$/, "");
      const current = String(afterObs?.url || "").replace(/\/$/, "");
      const passed = !target || current.startsWith(target) || diff.url_changed;
      return {
        ...base,
        passed,
        expected_condition: "url_matches_target",
        detail: passed ? `Navigated to ${afterObs?.url}` : `URL still ${afterObs?.url}`,
      };
    }
    case "scroll":
    case "wait":
    case "wait_for":
    case "press_key":
      return {
        ...base,
        passed: domResult?.ok !== false,
        expected_condition: "action_completes",
        detail: "No strict verification",
      };
    case "finish":
    case "ask_user":
    case "extract":
    case "send_email":
    case "check_email":
    case "solve_captcha":
      return {
        ...base,
        passed: domResult?.ok !== false,
        expected_condition: "action_completes",
      };
    default:
      return {
        ...base,
        passed: domResult?.ok !== false,
        expected_condition: "action_completes",
      };
  }
}

/**
 * Wraps a raw action result with effects, state_change, and verification.
 * @param {object} action
 * @param {object} domResult
 * @param {object} beforeObs
 * @param {object} afterObs
 * @param {object} [precondition]
 * @returns {object}
 */
export function enrichActionResult(action, domResult, beforeObs, afterObs, precondition = {}) {
  const verification = verifyAction(action, beforeObs, afterObs, domResult);
  const diff = diffObservations(beforeObs, afterObs);

  return attachFailureClass(
    {
      ...domResult,
      success: domResult?.ok !== false && verification.passed,
      action: action?.type,
      target: action?.ref || action?.url || undefined,
      effects: verification.effects,
      state_change: verification.state_change,
      diff: {
        added_refs: diff.added_refs.slice(0, 20),
        removed_refs: diff.removed_refs.slice(0, 20),
        url_changed: diff.url_changed,
        dom_changed: diff.dom_changed,
      },
      verification: {
        expected_condition: verification.expected_condition,
        passed: verification.passed,
        detail: verification.detail,
      },
      precondition: precondition.ok !== false ? undefined : precondition,
      resolved_ref: precondition.resolvedRef || undefined,
    },
    { result: domResult, precondition, verification }
  );
}
