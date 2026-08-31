/**
 * @fileoverview Minimal OpenAI-compatible chat completion for backend routing.
 * Purpose: Phase D common-chat agent router without pulling in the full worker LLM stack.
 * Downstream: `chatRouter.js`.
 */

import { codexChatCompletion, isOpenAiCodexBaseUrl } from "./openaiCodex.js";
import { extractLlmApiMessage, hintForLlmStatus, looksLikeHtml } from "./llmTest.js";
import {
  buildLlmAuthHeaders,
  normalizeApiKey,
  validateAnthropicApiKey,
} from "./llmDefaults.js";

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
    const raw =
      data.choices?.[0]?.message?.content ??
      data.choices?.[0]?.message?.reasoning_content ??
      "";
    return String(raw || "").trim();
  } finally {
    clearTimeout(timer);
  }
}
