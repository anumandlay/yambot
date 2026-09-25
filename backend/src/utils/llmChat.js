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
import { withTimeoutSignal, isAbortError } from "./llmAbort.js";
import { withCurrentDateTimeInMessages } from "./promptClock.js";

export { isAbortError } from "./llmAbort.js";

/** @type {import('undici').Agent|false|null} */
let llmDispatcher = null;

/**
 * Lazy keep-alive dispatcher for OpenAI-compatible fetch calls.
 * Why: reuse TCP/TLS to the LLM host across Auto turns (Hermes-style connection reuse).
 * @returns {Promise<import('undici').Agent|null>}
 */
async function resolveLlmDispatcher() {
  if (llmDispatcher === false) return null;
  if (llmDispatcher) return llmDispatcher;
  try {
    const { Agent } = await import("undici");
    llmDispatcher = new Agent({
      keepAliveTimeout: 30_000,
      keepAliveMaxTimeout: 60_000,
      connections: 32,
      pipelining: 1,
    });
    return llmDispatcher;
  } catch {
    llmDispatcher = false;
    return null;
  }
}

/**
 * @param {string} url
 * @param {RequestInit & { signal?: AbortSignal }} init
 * @returns {Promise<Response>}
 */
async function llmFetch(url, init) {
  const dispatcher = await resolveLlmDispatcher();
  if (dispatcher) {
    return fetch(url, { ...init, dispatcher });
  }
  return fetch(url, init);
}

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
 * @param {{ apiKey: string, baseUrl: string, model: string, messages: object[], temperature?: number, maxTokens?: number, timeoutMs?: number, openAiAccountId?: string, tools?: object[], toolChoice?: string|object }} opts
 * @returns {Promise<string>}
 */
export async function llmChatCompletion(opts) {
  const result = await llmChatCompletionMessage(opts);
  return result.content || "";
}

/**
 * Chat completion returning content + optional native tool_calls (OpenAI-compatible).
 * Why: Hermes-style Auto exposes reply/queue_goal as tools; providers that reject tools
 * should be handled by the caller (retry without tools).
 * @param {{
 *   apiKey: string,
 *   baseUrl: string,
 *   model: string,
 *   messages: object[],
 *   temperature?: number,
 *   maxTokens?: number,
 *   timeoutMs?: number,
 *   openAiAccountId?: string,
 *   tools?: object[],
 *   toolChoice?: string|object,
 *   signal?: AbortSignal|null,
 * }} opts
 * @returns {Promise<{ content: string, toolCalls: { id: string, name: string, arguments: string }[], rawMessage: object }>}
 */
export async function llmChatCompletionMessage(opts) {
  const {
    apiKey,
    baseUrl,
    model,
    messages: rawMessages,
    temperature = 0,
    maxTokens = 256,
    timeoutMs = 20_000,
    openAiAccountId,
    tools,
    toolChoice,
    signal: externalSignal = null,
  } = opts;
  // Why: every completion must know “now” for relative dates (today / this week / …).
  const messages = withCurrentDateTimeInMessages(rawMessages);
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
    // Why: Codex path has no tool_calls adapter here — content-only; Auto falls back to text protocol.
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
    const content = String(codex.content || "").trim();
    return { content, toolCalls: [], rawMessage: { role: "assistant", content } };
  }

  const body = {
    model,
    temperature,
    max_tokens: maxTokens,
    messages,
  };
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools;
    body.tool_choice = toolChoice || "auto";
  }

  const linked = withTimeoutSignal(timeoutMs, externalSignal);
  try {
    const response = await llmFetch(`${root}/chat/completions`, {
      method: "POST",
      headers: buildLlmAuthHeaders({ apiKey: key, baseUrl: root }),
      body: JSON.stringify(body),
      signal: linked.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      const detail = extractLlmApiMessage(text) || text.slice(0, 300) || `HTTP ${response.status}`;
      console.warn(
        `[llm] chat.completions failed status=${response.status} model=${model} detail=${String(detail).slice(0, 200)}`
      );
      const err = Object.assign(new Error(detail), {
        title: `LLM request failed (${response.status})`,
        hint: hintForLlmStatus(response.status, text, root),
        status: response.status,
        bodyText: text.slice(0, 500),
        model,
        baseUrl: root,
      });
      throw err;
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
    let resolved = content.trim();
    if (!(resolved.includes("{") && resolved.includes("}")) && reasoning.includes("{") && reasoning.includes("}")) {
      resolved = reasoning.trim();
    } else if (!resolved) {
      resolved = reasoning.trim();
    }

    /** @type {{ id: string, name: string, arguments: string }[]} */
    const toolCalls = [];
    const rawCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
    for (const tc of rawCalls) {
      const fn = tc?.function || tc;
      const name = String(fn?.name || tc?.name || "").trim();
      if (!name) continue;
      let args = fn?.arguments ?? tc?.arguments ?? "{}";
      if (typeof args !== "string") {
        try {
          args = JSON.stringify(args);
        } catch {
          args = "{}";
        }
      }
      toolCalls.push({
        id: String(tc?.id || ""),
        name,
        arguments: String(args || "{}"),
      });
    }

    return { content: resolved, toolCalls, rawMessage: message };
  } catch (err) {
    if (isAbortError(err)) {
      throw Object.assign(new Error("LLM request aborted"), {
        title: "Request cancelled",
        hint: "The client disconnected or the request timed out.",
        aborted: true,
        name: "AbortError",
      });
    }
    throw err;
  } finally {
    linked.dispose();
  }
}

/**
 * Streaming OpenAI-compatible chat completion (SSE). Falls back to one-shot when needed.
 * Why: Hermes-like fast chat — tokens appear before the full answer finishes.
 * @param {{ apiKey: string, baseUrl: string, model: string, messages: object[], temperature?: number, maxTokens?: number, timeoutMs?: number, openAiAccountId?: string, signal?: AbortSignal|null }} opts
 * @param {(chunk: string) => void} [onDelta]
 * @returns {Promise<string>} Full assistant text
 */
export async function llmChatCompletionStream(opts, onDelta) {
  const {
    apiKey,
    baseUrl,
    model,
    messages: rawMessages,
    temperature = 0,
    maxTokens = 256,
    timeoutMs = 60_000,
    openAiAccountId,
    signal: externalSignal = null,
  } = opts;
  const messages = withCurrentDateTimeInMessages(rawMessages);
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
      signal: externalSignal,
    });
    if (typeof onDelta === "function" && text) onDelta(text);
    return text;
  }

  const linked = withTimeoutSignal(timeoutMs, externalSignal);
  try {
    const response = await llmFetch(`${root}/chat/completions`, {
      method: "POST",
      headers: buildLlmAuthHeaders({ apiKey: key, baseUrl: root }),
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages,
        stream: true,
      }),
      signal: linked.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      const detail =
        extractLlmApiMessage(errText) || errText.slice(0, 300) || `HTTP ${response.status}`;
      throw Object.assign(new Error(detail), {
        title: `LLM request failed (${response.status})`,
        hint: hintForLlmStatus(response.status, errText, root),
        status: response.status,
        bodyText: errText.slice(0, 500),
        model,
        baseUrl: root,
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
      if (linked.signal.aborted) {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        throw Object.assign(new Error("LLM request aborted"), {
          title: "Request cancelled",
          aborted: true,
          name: "AbortError",
        });
      }
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
    const streamed = full.trim();
    if (streamed) return streamed;
    // Why: some providers accept stream:true but emit empty SSE — one-shot retry.
    const fallback = await llmChatCompletion({
      apiKey,
      baseUrl,
      model,
      messages,
      temperature,
      maxTokens,
      timeoutMs,
      openAiAccountId,
      signal: externalSignal,
    });
    if (typeof onDelta === "function" && fallback) onDelta(fallback);
    return String(fallback || "").trim();
  } catch (err) {
    if (isAbortError(err)) {
      throw Object.assign(new Error("LLM request aborted"), {
        title: "Request cancelled",
        hint: "The client disconnected or the request timed out.",
        aborted: true,
        name: "AbortError",
      });
    }
    throw err;
  } finally {
    linked.dispose();
  }
}
