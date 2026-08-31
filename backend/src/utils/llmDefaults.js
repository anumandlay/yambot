/**
 * @fileoverview Default LLM provider constants and endpoint normalization for YamBot.
 * Purpose: Site-wide fallbacks (Minimax) plus guards against stale LiteLLM/YamBot URLs in Mongo.
 * Secrets still come from env `DEFAULT_LLM_API_KEY` / per-user encrypted settings — never commit keys.
 * Downstream: `llmCredentials.js`, Settings routes, worker runtime-config.
 */

export const DEFAULT_LLM_BASE_URL = "https://api.minimax.io/v1";
export const DEFAULT_LLM_MODEL = "MiniMax-M2.7";

/** Host/path fragments that must never be used as an LLM OpenAI-compatible base URL. */
const STALE_LLM_BASE_PATTERNS = [
  /litellm/i,
  /bot\.vughy\.com/i,
  /localhost/i,
  /127\.0\.0\.1/i,
  /\/api\/worker/i,
  /\/api\/settings/i,
];

/**
 * Returns true when a stored base URL is from the removed LiteLLM gateway or YamBot web UI.
 * @param {string} baseUrl
 * @returns {boolean}
 */
export function isStaleLlmBaseUrl(baseUrl) {
  const raw = String(baseUrl || "").trim();
  if (!raw) return false;
  return STALE_LLM_BASE_PATTERNS.some((re) => re.test(raw));
}

/**
 * Normalizes user/env LLM base URL — fixes missing `/v1` and rejects YamBot/LiteLLM leftovers.
 * @param {string} [baseUrl]
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizeLlmBaseUrl(baseUrl, fallback = DEFAULT_LLM_BASE_URL) {
  const raw = String(baseUrl || "").trim();
  if (!raw || isStaleLlmBaseUrl(raw)) return fallback;
  // Why: ChatGPT OAuth uses Codex backend — never append /v1 like OpenAI-compatible APIs.
  if (/chatgpt\.com\/backend-api/i.test(raw)) {
    return raw.replace(/\/$/, "");
  }

  try {
    const url = new URL(raw);
    let path = url.pathname.replace(/\/+$/, "");
    if (!path.endsWith("/v1")) {
      if (!path || path === "/") {
        path = "/v1";
      } else if (!path.includes("/v1")) {
        path = `${path}/v1`;
      }
    }
    return `${url.origin}${path}`;
  } catch {
    return fallback;
  }
}

/**
 * Maps LiteLLM gateway catalog ids to real provider model names.
 * @param {string} [model]
 * @param {string} [fallback]
 * @returns {string}
 */
export function normalizeLlmModel(model, fallback = DEFAULT_LLM_MODEL) {
  const raw = String(model || "").trim();
  if (!raw) return fallback;
  const lower = raw.toLowerCase();
  if (lower === "minimax") return fallback;
  if (lower === "chatgpt" || lower.startsWith("chatgpt/")) return fallback;
  return raw;
}

/** Anthropic Messages + OpenAI-compat both expect this version header. */
export const ANTHROPIC_API_VERSION = "2023-06-01";

/**
 * @param {string} [baseUrl]
 * @returns {boolean}
 */
export function isAnthropicBaseUrl(baseUrl) {
  try {
    return /anthropic\.com/i.test(new URL(String(baseUrl || "").trim()).hostname);
  } catch {
    return /anthropic\.com/i.test(String(baseUrl || ""));
  }
}

/**
 * Trim whitespace/newlines from pasted API keys.
 * @param {string} apiKey
 * @returns {string}
 */
export function normalizeApiKey(apiKey) {
  return String(apiKey || "").replace(/\s+/g, "").trim();
}

/**
 * Pre-flight validation before calling Anthropic.
 * @param {string} apiKey
 * @param {string} baseUrl
 * @returns {{ title: string, detail: string, hint: string }|null}
 */
export function validateAnthropicApiKey(apiKey, baseUrl) {
  if (!isAnthropicBaseUrl(baseUrl)) return null;
  const key = normalizeApiKey(apiKey);
  if (!key) return null;
  if (key.startsWith("sk-ant-")) return null;
  if (key.startsWith("sk-proj-") || (key.startsWith("sk-") && !key.startsWith("sk-ant-"))) {
    return {
      title: "Wrong key type for Anthropic",
      detail:
        "This looks like an OpenAI API key (sk-…). Anthropic keys start with sk-ant- and come from console.anthropic.com.",
      hint: "Create a key at https://console.anthropic.com/settings/keys — not OpenAI, not your Claude login password.",
    };
  }
  return {
    title: "Unexpected Anthropic key format",
    detail: "Anthropic API keys usually start with sk-ant-api03-…",
    hint: "Copy the full key from console.anthropic.com/settings/keys with no spaces.",
  };
}

/**
 * OpenAI-compatible fetch headers; Anthropic needs x-api-key + anthropic-version too.
 * @param {{ apiKey: string, baseUrl: string }} opts
 * @returns {Record<string, string>}
 */
export function buildLlmAuthHeaders({ apiKey, baseUrl }) {
  const key = normalizeApiKey(apiKey);
  /** @type {Record<string, string>} */
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${key}`,
  };
  if (isAnthropicBaseUrl(baseUrl)) {
    headers["x-api-key"] = key;
    headers["anthropic-version"] = ANTHROPIC_API_VERSION;
  }
  return headers;
}
