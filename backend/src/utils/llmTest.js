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
 * Maps HTML gateway pages to user-facing hints (503 from MiniMax ≠ wrong Base URL).
 * @param {number} status
 * @param {string} bodyText
 * @param {string} [baseUrl]
 */
export function describeHtmlLlmFailure(status, bodyText, baseUrl = "") {
  const lower = String(bodyText || "").toLowerCase();
  let host = "";
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    /* ignore */
  }

  if (status === 503 || /503 service temporarily unavailable|server is busy|overloaded/i.test(lower)) {
    return {
      detail: `MiniMax API temporarily unavailable (${status || 503}).`,
      hint: "The provider is overloaded or down — wait a few minutes and retry. Your Base URL is fine.",
    };
  }
  if (status >= 500) {
    return {
      detail: `LLM provider error (${status}).`,
      hint: "Server-side error from the LLM API — retry shortly.",
    };
  }
  if (/bot\.vughy\.com|litellm|localhost|127\.0\.0\.1/i.test(lower + host)) {
    return {
      detail: "Received HTML instead of JSON — Base URL points at YamBot, not the LLM API.",
      hint: "Use https://api.minimax.io/v1 for MiniMax.",
    };
  }
  if (/minimax\.io/i.test(host)) {
    return {
      detail: `MiniMax returned HTML instead of JSON (${status || "unknown"}).`,
      hint: "Usually a temporary MiniMax outage — retry in a few minutes.",
    };
  }
  return {
    detail: "Received HTML instead of JSON — check Base URL (should end with /v1, e.g. https://api.minimax.io/v1).",
    hint: "Base URL is wrong (got a web page, not the LLM API). Use https://api.minimax.io/v1 for MiniMax.",
  };
}

/**
 * @param {string} bodyText
 * @param {number} [status]
 * @param {string} [baseUrl]
 * @returns {string|null}
 */
export function extractLlmApiMessage(bodyText, status = 0, baseUrl = "") {
  if (looksLikeHtml(bodyText)) {
    return describeHtmlLlmFailure(status, bodyText, baseUrl).detail;
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
 * @param {string} [baseUrl]
 * @returns {string}
 */
export function hintForLlmStatus(status, bodyText, baseUrl = "") {
  if (looksLikeHtml(bodyText)) {
    return describeHtmlLlmFailure(status, bodyText, baseUrl).hint;
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
    const apiMsg = extractLlmApiMessage(text, response.status, root);
    const detail = apiMsg ? String(apiMsg) : text.slice(0, 500) || `HTTP ${response.status}`;
    throw Object.assign(new Error(detail), {
      title: `LLM request failed (${response.status})`,
      hint: hintForLlmStatus(response.status, text, root),
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
