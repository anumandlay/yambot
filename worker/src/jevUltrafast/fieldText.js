/**
 * @fileoverview Small OpenAI-compatible helper for TYPE_TEXT values.
 * Purpose: Jev picks the field; agent LLM (runtime-config) writes the string.
 * Downstream: run.js when operation is TYPE_TEXT.
 */

import { TEXT_VALUE } from "./questions.js";

/**
 * @param {object} context
 * @param {{ apiKey: string, baseUrl?: string, model?: string }} creds
 * @returns {Promise<{ text: string, model: string, latency_ms: number, usage?: object }>}
 */
export async function fieldText(context, creds) {
  const apiKey = String(creds?.apiKey || "").trim();
  if (!apiKey) {
    throw new Error("TYPE_TEXT needs the agent LLM API key (Settings / Agent LLM).");
  }
  const base = String(creds.baseUrl || "https://openrouter.ai/api/v1")
    .trim()
    .replace(/\/+$/, "");
  const model = String(creds.model || "inception/mercury-2.5").trim() || "inception/mercury-2.5";
  const started = Date.now();

  /** @type {Record<string, unknown>} */
  const body = {
    model,
    max_tokens: 1024,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: TEXT_VALUE },
      { role: "user", content: JSON.stringify(context) },
    ],
  };
  // Why: disable reasoning when the provider supports it (OpenRouter / DeepSeek variants).
  if (/api\.deepseek\.com/i.test(base)) {
    body.thinking = { type: "disabled" };
  } else {
    body.reasoning = { enabled: false };
  }

  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      data?.error?.message || data?.message || `Text helper HTTP ${res.status}`
    );
  }
  let output;
  try {
    output = JSON.parse(String(data?.choices?.[0]?.message?.content || "{}"));
  } catch {
    throw new Error("Text helper returned non-JSON; nothing typed.");
  }
  const value = output?.text;
  if (
    !output ||
    Object.keys(output).join(",") !== "text" ||
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 2000
  ) {
    throw new Error("Text helper returned no valid field value; nothing typed.");
  }
  return {
    text: value,
    model,
    latency_ms: Date.now() - started,
    usage: data.usage || {},
  };
}

/**
 * @param {string} goal
 * @param {object} action
 * @param {object} page
 * @param {object[]} history
 */
export function fieldContext(goal, action, page, history) {
  return {
    goal,
    field: {
      label: action.label,
      role: action.role,
      value: action.value,
    },
    page: { title: page.title, text: String(page.text || "").slice(0, 6000) },
    recent_actions: (history || []).slice(-6).map((h) => ({
      action: h.action,
      text: h.text,
    })),
  };
}
