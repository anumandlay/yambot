/**
 * @fileoverview OpenAI-compatible chat completion helpers for backend routing.
 * Purpose: Non-stream + SSE stream completions for Auto chat (Hermes-style fast replies).
 * Downstream: messageIntent, chatAutoTurn, chatRouter, architect helpers.
 */

import { codexChatCompletion, isOpenAiCodexBaseUrl } from "./openaiCodex.js";
import { extractLlmApiMessage, hintForLlmStatus, looksLikeHtml } from "./llmTest.js";
import {
  buildLlmAuthHeaders,
  normalizeApiKey,
  validateAnthropicApiKey,
} from "./llmDefaults.js";

/**
 * @param {unknown} content
 * @returns {string}
 */
function flattenLlmContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object") {
          return String(part.text || part.content || "");
        }
        return "";
      })
      .join("");
  }
  return "";
}

/**
 * @param {{ apiKey: string, baseUrl: string, model: string, messages: object[], temperature?: number, maxTokens?: number, timeoutMs?: number, openAiAccountId?: string }} opts
 * @returns {Promise<string>}
 */
export async function llmChatCompletion(opts) {
  const {
    apiKey,
    baseUrl,
    model,
    messages,
    temperature = 0,
    maxTokens = 256,
    timeoutMs = 20_000,
    openAiAccountId,
  } = opts;
  const root = String(baseUrl || "").replace(/\/$/, "");
  const key = normalizeApiKey(apiKey);
  const keyErr = validateAnthropicApiKey(key, root);
  if (keyErr) {
    throw Object.assign(new Error(keyErr.detail), {
      title: keyErr.title,
      hint: keyErr.hint,
    });
  }

  if (isOpenAiCodexBaseUrl(root)) {
    const codex = await codexChatCompletion({
      accessToken: apiKey,
      accountId: openAiAccountId || "",
      model,
      messages,
      baseUrl: root,
      timeoutMs,
      temperature,
      maxTokens,
    });
    return String(codex.content || "").trim();
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${root}/chat/completions`, {
      method: "POST",
      headers: buildLlmAuthHeaders({ apiKey: key, baseUrl: root }),
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages,
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const detail = extractLlmApiMessage(text) || text.slice(0, 300) || `HTTP ${response.status}`;
      throw Object.assign(new Error(detail), {
        title: `LLM request failed (${response.status})`,
        hint: hintForLlmStatus(response.status, text),
      });
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw Object.assign(new Error(looksLikeHtml(text) ? "HTML response from LLM URL" : "Invalid JSON"), {
        title: "Invalid LLM response",
      });
    }
    const message = data.choices?.[0]?.message || {};
    const content = flattenLlmContent(message.content);
    const reasoning = flattenLlmContent(message.reasoning_content);
    // Why: some models put the JSON draft in reasoning and a short sentence in content.
    if (content.includes("{") && content.includes("}")) return content.trim();
    if (reasoning.includes("{") && reasoning.includes("}")) return reasoning.trim();
    return (content || reasoning).trim();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Streaming OpenAI-compatible chat completion (SSE). Falls back to one-shot when needed.
 * Why: Hermes-like fast chat — tokens appear before the full answer finishes.
 * @param {{ apiKey: string, baseUrl: string, model: string, messages: object[], temperature?: number, maxTokens?: number, timeoutMs?: number, openAiAccountId?: string }} opts
 * @param {(chunk: string) => void} [onDelta]
 * @returns {Promise<string>} Full assistant text
 */
export async function llmChatCompletionStream(opts, onDelta) {
  const {
    apiKey,
    baseUrl,
    model,
    messages,
    temperature = 0,
    maxTokens = 256,
    timeoutMs = 60_000,
    openAiAccountId,
  } = opts;
  const root = String(baseUrl || "").replace(/\/$/, "");
  const key = normalizeApiKey(apiKey);
  const keyErr = validateAnthropicApiKey(key, root);
  if (keyErr) {
    throw Object.assign(new Error(keyErr.detail), {
      title: keyErr.title,
      hint: keyErr.hint,
    });
  }

  // Why: Codex path has no SSE stream here — fall back to one-shot and emit once.
  if (isOpenAiCodexBaseUrl(root)) {
    const text = await llmChatCompletion({
      apiKey,
      baseUrl,
      model,
      messages,
      temperature,
      maxTokens,
      timeoutMs,
      openAiAccountId,
    });
    if (typeof onDelta === "function" && text) onDelta(text);
    return text;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${root}/chat/completions`, {
      method: "POST",
      headers: buildLlmAuthHeaders({ apiKey: key, baseUrl: root }),
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      const detail =
        extractLlmApiMessage(errText) || errText.slice(0, 300) || `HTTP ${response.status}`;
      throw Object.assign(new Error(detail), {
        title: `LLM request failed (${response.status})`,
        hint: hintForLlmStatus(response.status, errText),
      });
    }

    const contentType = String(response.headers.get("content-type") || "");
    if (!contentType.includes("text/event-stream") && !contentType.includes("ndjson")) {
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw Object.assign(
          new Error(looksLikeHtml(text) ? "HTML response from LLM URL" : "Invalid JSON"),
          { title: "Invalid LLM response" }
        );
      }
      const message = data.choices?.[0]?.message || {};
      const content = flattenLlmContent(message.content);
      const reasoning = flattenLlmContent(message.reasoning_content);
      const full = (
        content.includes("{") && content.includes("}")
          ? content
          : reasoning.includes("{") && reasoning.includes("}")
            ? reasoning
            : content || reasoning
      ).trim();
      if (typeof onDelta === "function" && full) onDelta(full);
      return full;
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw Object.assign(new Error("No stream body from LLM"), {
        title: "Invalid LLM response",
      });
    }
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n");
      buffer = parts.pop() || "";
      for (const line of parts) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === "data: [DONE]") continue;
        const payload = trimmed.startsWith("data:") ? trimmed.slice(5).trim() : trimmed;
        if (!payload || payload === "[DONE]") continue;
        let obj;
        try {
          obj = JSON.parse(payload);
        } catch {
          continue;
        }
        const delta = obj.choices?.[0]?.delta || {};
        const piece =
          flattenLlmContent(delta.content) || flattenLlmContent(delta.reasoning_content) || "";
        if (!piece) continue;
        full += piece;
        if (typeof onDelta === "function") onDelta(piece);
      }
    }
    return full.trim();
  } finally {
    clearTimeout(timer);
  }
}
