/**
 * @fileoverview TypeSafe choose — operation + speculative target heads (Jev Ultrafast).
 * Purpose: One System One request picks CLICK/TYPE_TEXT/… and the element index.
 * Keys: agent.jev API key from runtime-config (TYPESAFE / AI Gateway).
 * Downstream: run.js tick loop.
 */

import { NEXT_ACTION, TARGET } from "./questions.js";

const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
const GATEWAY_URL = "https://ai-gateway.vercel.sh/v1/evaluate";

/**
 * @param {object[]} actions
 * @returns {[object[], Record<string, Record<string, object>>, Record<string, object>]}
 */
export function actionSpace(actions) {
  const elements = [];
  /** @type {Record<number, string>} */
  const indices = {};
  /** @type {Record<string, Record<string, object>>} */
  const targets = {};
  /** @type {Record<string, object>} */
  const controls = {};
  const operations = { click: "CLICK", fill: "TYPE_TEXT", select: "SELECT" };

  for (const action of actions || []) {
    const kind = action.kind;
    if (!operations[kind]) {
      controls[String(action.id).toUpperCase()] = action;
      continue;
    }
    const node = action.node;
    if (!(node in indices)) {
      const index = String(elements.length + 1);
      indices[node] = index;
      const element = {
        index,
        label: String(action.label || "").split(" → ")[0],
        operations: [],
      };
      for (const k of ["role", "value", "checked", "selected", "expanded"]) {
        if (action[k] != null) element[k] = action[k];
      }
      if (kind === "select") {
        element.value = action.current_value || "";
        element.options = [];
      }
      elements.push(element);
    }
    const index = indices[node];
    const operation = operations[kind];
    const group = (targets[operation] ||= {});
    const element = elements[Number(index) - 1];
    if (!element.operations.includes(operation)) element.operations.push(operation);
    let target = index;
    if (kind === "select") {
      target = `${index}:${(element.options?.length || 0) + 1}`;
      element.options = element.options || [];
      element.options.push({ index: target, label: action.label, value: action.value });
    }
    group[target] = action;
  }
  return [elements, targets, controls];
}

/**
 * @param {object} answer
 * @param {Record<string, unknown>} ids
 */
function validateChoice(answer, ids) {
  const probabilities = answer?.probabilities || {};
  const numbers = [...Object.values(probabilities), answer?.confidence];
  const idSet = new Set(Object.keys(ids));
  const valid =
    answer &&
    answer.choice in ids &&
    Object.keys(probabilities).length === idSet.size &&
    [...Object.keys(probabilities)].every((k) => idSet.has(k)) &&
    numbers.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1) &&
    Math.abs(Object.values(probabilities).reduce((a, b) => a + Number(b), 0) - 1) < 0.02 &&
    Number(probabilities[answer.choice]) >=
      Math.max(...Object.values(probabilities).map(Number)) - 1e-6;
  if (!valid) {
    throw new Error("Invalid TypeSafe response; no action executed.");
  }
  return answer;
}

/**
 * @param {string} url
 * @param {string} apiKey
 * @param {object} body
 * @returns {Promise<object>}
 */
async function postJson(url, apiKey, body) {
  let lastErr = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25000),
      });
      if ([429, 529, 503].includes(res.status) && attempt < 2) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          data?.error?.message || data?.message || `Model provider HTTP ${res.status}`
        );
      }
      return data;
    } catch (err) {
      lastErr = err;
      if (attempt < 2) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
    }
  }
  throw lastErr || new Error("Model unavailable");
}

/**
 * @param {object} state — observe() page payload
 * @param {string} goal
 * @param {object[]} history
 * @param {{ apiKey: string, model?: string }} creds
 */
export async function choose(state, goal, history, creds) {
  const apiKey = String(creds?.apiKey || "").trim();
  if (!apiKey) throw new Error("Jev API key missing (set Agent → Jev key)");

  const [elements, targets, controls] = actionSpace(state.actions || []);
  const labels = {
    CLICK: "Click an element, button, menu option, autocomplete suggestion, or calendar day.",
    TYPE_TEXT:
      "Enter or replace text in an editable field. A small LLM will supply the value from the goal.",
    SELECT: "Select an observed dropdown value.",
  };
  /** @type {Record<string, string>} */
  const operations = {};
  for (const key of Object.keys(targets)) operations[key] = labels[key];
  for (const [key, value] of Object.entries(controls)) operations[key] = value.label;
  operations.DONE = "Every requirement is visibly satisfied.";
  operations.BLOCKED = "No supported operation can progress.";

  /** @type {Record<string, object>} */
  const questions = {
    operation: {
      type: "choice",
      criteria: operations,
      instructions: { goal, rules: NEXT_ACTION },
    },
  };
  for (const [operation, candidates] of Object.entries(targets)) {
    questions[`${operation.toLowerCase()}_target`] = {
      type: "choice",
      criteria: Object.fromEntries(
        Object.entries(candidates).map(([index, a]) => [
          index,
          {
            element: `[${index}] ${a.label}`,
            current_value: a.current_value ?? a.value ?? "",
            ...(a.role != null ? { role: a.role } : {}),
            ...(a.checked != null ? { checked: a.checked } : {}),
            ...(a.selected != null ? { selected: a.selected } : {}),
            ...(a.expanded != null ? { expanded: a.expanded } : {}),
          },
        ])
      ),
      instructions: { goal, operation, rules: [NEXT_ACTION, TARGET] },
    };
  }

  const body = {
    model: String(creds.model || process.env.TYPESAFE_MODEL || "jev-latest").trim() || "jev-latest",
    state: {
      page: { url: state.url, title: state.title, text: state.text },
      elements,
      recent_actions: (history || []).slice(-10).map((h) => ({
        action: h.action,
        kind: h.kind,
        text: h.text,
        page_changed: h.page_changed,
      })),
    },
    questions,
  };

  const started = Date.now();
  let result;
  try {
    result = await postJson(TYPESAFE_URL, apiKey, body);
  } catch (err) {
    // Why: agent settings often store a Vercel AI Gateway key — same evaluate shape.
    result = await postJson(GATEWAY_URL, apiKey, {
      ...body,
      model: "typesafe-ai/jev",
    }).catch(() => {
      throw err;
    });
  }

  const operationAnswer = validateChoice(result.answers?.operation || {}, operations);
  const operation = operationAnswer.choice;
  let target = null;
  let targetAnswer = null;
  /** @type {Record<string, number>} */
  let probabilities = {};
  let choice;

  if (operation in targets) {
    targetAnswer = validateChoice(
      result.answers?.[`${operation.toLowerCase()}_target`] || {},
      targets[operation]
    );
    target = targetAnswer.choice;
    choice = targets[operation][target].id;
    probabilities = Object.fromEntries(
      Object.entries(targets[operation]).map(([index, a]) => [
        a.id,
        Number(targetAnswer.probabilities[index]) || 0,
      ])
    );
  } else {
    choice = operation in controls ? controls[operation].id : operation;
    probabilities[choice] = Number(operationAnswer.probabilities[operation]) || 0;
  }

  return {
    choice,
    operation,
    target,
    confidence: operationAnswer.confidence,
    probabilities,
    operation_probabilities: operationAnswer.probabilities,
    target_probabilities: targetAnswer?.probabilities || {},
    target_confidence: targetAnswer?.confidence ?? null,
    model: result.model || body.model,
    usage: result.usage || {},
    latency_ms: Date.now() - started,
  };
}
