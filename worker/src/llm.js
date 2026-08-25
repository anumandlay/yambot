/**
 * @fileoverview OpenAI-compatible chat client for the cloud worker.
 * Purpose: OpenAI-compatible chat client for the cloud worker.
 */

import { codexChatCompletion, isOpenAiCodexBaseUrl } from "./openaiCodex.js";

/**
 * @param {{ title: string, detail: string, hint?: string, status?: number, url?: string }} opts
 */
export class LlmError extends Error {
  constructor({ title, detail, hint, status, url }) {
    super(detail || title);
    this.name = "LlmError";
    this.title = title;
    this.detail = detail;
    this.hint = hint || "";
    this.status = status;
    this.url = url;
  }
}

function hintForStatus(status, bodyText) {
  const lower = String(bodyText || "").toLowerCase();
  if (looksLikeHtml(bodyText)) {
    return "Base URL is wrong (got a web page, not the LLM API). Open Settings → set Base URL to https://api.minimax.io/v1 and re-enter your MiniMax API key.";
  }
  if (status === 401 || status === 403) return "Check your API key (and model access).";
  if (status === 404) return "Check the base URL ends with /v1 and the model name.";
  if (status === 429) return "Rate limited or out of quota.";
  if (status >= 500) return "Provider server error. Retry shortly.";
  if (lower.includes("incorrect api key") || lower.includes("invalid_api_key")) {
    return "API key looks invalid.";
  }
  return "Verify API key, base URL, and model in website Settings.";
}

function extractApiMessage(bodyText) {
  if (looksLikeHtml(bodyText)) {
    return "Received HTML instead of JSON — check Base URL in Settings (should end with /v1, e.g. https://api.minimax.io/v1).";
  }
  try {
    const json = JSON.parse(bodyText);
    return json?.error?.message || json?.error?.code || json?.message || json?.error || null;
  } catch {
    return null;
  }
}

/** @param {string} text */
function looksLikeHtml(text) {
  const t = String(text || "").trimStart().toLowerCase();
  return t.startsWith("<!doctype") || t.startsWith("<html");
}

/**
 * Rejects YamBot/LiteLLM leftovers and ensures `/v1` suffix (worker-side safety net).
 * @param {string} [baseUrl]
 */
function normalizeBaseUrl(baseUrl) {
  const fallback = "https://api.minimax.io/v1";
  const raw = String(baseUrl || "").trim();
  if (!raw) return fallback;
  if (isOpenAiCodexBaseUrl(raw)) return raw.replace(/\/$/, "");
  const lower = raw.toLowerCase();
  if (
    lower.includes("litellm") ||
    lower.includes("bot.vughy.com") ||
    lower.includes("localhost") ||
    lower.includes("127.0.0.1")
  ) {
    return fallback;
  }
  try {
    const url = new URL(raw);
    let path = url.pathname.replace(/\/+$/, "");
    if (!path.endsWith("/v1")) {
      if (!path || path === "/") path = "/v1";
      else if (!path.includes("/v1")) path = `${path}/v1`;
    }
    return `${url.origin}${path}`;
  } catch {
    return fallback;
  }
}

/**
 * @param {{ apiKey: string, baseUrl?: string, model?: string, messages: object[], temperature?: number, timeoutMs?: number, openAiAccountId?: string }} opts
 */
export async function chatCompletion({
  apiKey,
  baseUrl,
  model,
  messages,
  temperature = 0.2,
  timeoutMs = 120_000,
  openAiAccountId,
}) {
  if (!apiKey?.trim()) {
    throw new LlmError({
      title: "Missing API key",
      detail: "No LLM API key was provided.",
      hint: "Open YamBot → Settings → paste LLM API key or connect OpenAI OAuth.",
    });
  }

  const root = normalizeBaseUrl(baseUrl);

  if (isOpenAiCodexBaseUrl(root)) {
    try {
      const codex = await codexChatCompletion({
        accessToken: apiKey,
        accountId: openAiAccountId || "",
        model,
        messages,
        baseUrl: root,
        timeoutMs,
      });
      return {
        content: codex.content,
        raw: codex.raw,
        model: codex.model,
        url: codex.url,
        usage: codex.raw?.usage || null,
      };
    } catch (err) {
      throw new LlmError({
        title: "ChatGPT request failed",
        detail: String(err?.message || err),
        hint: "Reconnect OpenAI on Settings → OpenAI OAuth.",
        url: `${root}/responses`,
      });
    }
  }

  const url = `${root}/chat/completions`;
  const usedModel = model || "MiniMax-M2.7";

  let res;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model: usedModel, temperature, messages }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new LlmError({
        title: "LLM request timed out",
        detail: `No response within ${Math.round(timeoutMs / 1000)}s`,
        hint: "Try again or use a faster model.",
        url,
      });
    }
    throw new LlmError({
      title: "Network error",
      detail: String(err?.message || err),
      hint: "Cannot reach the LLM server.",
      url,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text();
    const apiMsg = extractApiMessage(body);
    throw new LlmError({
      title: `LLM request failed (${res.status})`,
      detail: apiMsg ? String(apiMsg) : body.slice(0, 500) || `HTTP ${res.status}`,
      hint: hintForStatus(res.status, body),
      status: res.status,
      url,
    });
  }

  const bodyText = await res.text();
  let data;
  try {
    data = JSON.parse(bodyText);
  } catch (err) {
    const msg = String(err?.message || err);
    const m = /position\s+(\d+)/i.exec(msg);
    if (m) {
      try {
        data = JSON.parse(bodyText.slice(0, Number(m[1])).trim());
      } catch {
        data = null;
      }
    }
    if (!data) {
      const detail = looksLikeHtml(bodyText)
        ? "Received HTML instead of JSON — check Base URL in Settings."
        : msg;
      throw new LlmError({
        title: "Invalid LLM response",
        detail,
        hint: "Provider returned non-JSON. Check base URL / model / API key in Settings.",
        url,
      });
    }
  }
  const rawContent = data.choices?.[0]?.message?.content ?? data.choices?.[0]?.message?.reasoning_content;
  const content = normalizeLlmContent(rawContent);
  if (!content) {
    throw new LlmError({
      title: "Empty LLM reply",
      detail: "The API returned no message content.",
      url,
    });
  }
  return { content, raw: data, model: usedModel, url, usage: data.usage || null };
}

/**
 * Normalizes provider content (string | multimodal parts) to plain text.
 * @param {unknown} content
 * @returns {string}
 */
function normalizeLlmContent(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          return String(part.text || part.content || part.thinking || "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  if (typeof content === "object") {
    return String(content.text || content.content || "");
  }
  return String(content);
}
