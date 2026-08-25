/**
 * @fileoverview Server-side LLM connectivity probe for Settings "Test LLM".
 * Purpose: Send one tiny OpenAI-compatible chat completion using the same URL shape workers use.
 * Inputs: API key, normalized base URL, model id.
 * Downstream: `POST /api/settings/test-llm` in settings routes.
 */

import {
  codexChatCompletion,
  isOpenAiCodexBaseUrl,
} from "./openaiCodex.js";

/**
 * @param {string} text
 * @returns {boolean}
 */
export function looksLikeHtml(text) {
  const t = String(text || "").trimStart().toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html");
}

/**
 * @param {string} bodyText
 * @returns {string|null}
 */
export function extractLlmApiMessage(bodyText) {
  if (looksLikeHtml(bodyText)) {
    return "Received HTML instead of JSON — check Base URL (should end with /v1, e.g. https://api.minimax.io/v1).";
  }
  try {
    const json = JSON.parse(bodyText);
    return json?.error?.message || json?.error?.code || json?.message || json?.error || null;
  } catch {
    return null;
  }
}

/**
 * @param {number} status
 * @param {string} bodyText
 * @returns {string}
 */
export function hintForLlmStatus(status, bodyText) {
  if (looksLikeHtml(bodyText)) {
    return "Base URL is wrong (got a web page, not the LLM API). Use https://api.minimax.io/v1 for MiniMax.";
  }
  if (status === 401 || status === 403) return "Check your API key (and model access).";
  if (status === 404) return "Check the base URL ends with /v1 and the model name.";
  if (status === 429) return "Rate limited or out of quota.";
  if (status >= 500) return "Provider server error. Retry shortly.";
  return "Verify API key, base URL, and model.";
}

/**
 * Probes provider connectivity with a minimal user message.
 * @param {{ apiKey: string, baseUrl: string, model: string, timeoutMs?: number, openAiAccountId?: string }} opts
 * @returns {Promise<{ model: string, preview: string }>}
 */
export async function probeLlmConnection({ apiKey, baseUrl, model, timeoutMs = 60_000, openAiAccountId }) {
  const root = String(baseUrl || "").replace(/\/$/, "");
  const messages = [{ role: "user", content: "Reply with exactly: ok" }];

  if (isOpenAiCodexBaseUrl(root)) {
    const codex = await codexChatCompletion({
      accessToken: apiKey,
      accountId: openAiAccountId || "",
      model,
      messages,
      baseUrl: root,
      timeoutMs,
    });
    return {
      model: codex.model || model,
      preview: codex.content.slice(0, 120) || "(empty reply)",
    };
  }

  const url = `${root}/chat/completions`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 16,
        messages,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw Object.assign(new Error(`No response within ${Math.round(timeoutMs / 1000)}s`), {
        title: "LLM request timed out",
        hint: "Try again or use a faster model.",
      });
    }
    throw Object.assign(new Error(String(err?.message || err || "Could not reach the LLM server")), {
      title: "Connection failed",
      hint: "Check the base URL and your network.",
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  if (!response.ok) {
    const apiMsg = extractLlmApiMessage(text);
    const detail = apiMsg ? String(apiMsg) : text.slice(0, 500) || `HTTP ${response.status}`;
    throw Object.assign(new Error(detail), {
      title: `LLM request failed (${response.status})`,
      hint: hintForLlmStatus(response.status, text),
    });
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Provider returned non-JSON."), {
      title: "Invalid LLM response",
      hint: looksLikeHtml(text)
        ? "Base URL is pointing at a website, not the LLM API."
        : "Check base URL and model.",
    });
  }

  const rawContent =
    data.choices?.[0]?.message?.content ?? data.choices?.[0]?.message?.reasoning_content ?? "";
  const preview =
    typeof rawContent === "string"
      ? rawContent.trim().slice(0, 120)
      : String(rawContent || "").slice(0, 120);

  return {
    model: data.model || model,
    preview: preview || "(empty reply)",
  };
}
