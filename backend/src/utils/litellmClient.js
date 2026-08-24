/**
 * @fileoverview LiteLLM proxy admin client for YamBot.
 * Purpose: Mint virtual keys, list models, and drive ChatGPT device-code OAuth on behalf of Settings users.
 * Inputs: env.LITELLM_PROXY_URL, env.LITELLM_MASTER_KEY.
 * Downstream: llmCredentials resolver, litellmGateway routes, seedLlm boot hook.
 */

import { encryptSecret, decryptSecret } from "./crypto.js";
import { env } from "./env.js";
import { DEFAULT_LLM_MODEL } from "./llmDefaults.js";

/** Catalog entries shown in Settings when LiteLLM is the gateway. */
export const LITELLM_CATALOG = [
  { id: "minimax", label: "MiniMax M2.7", requiresOAuth: false },
  { id: "chatgpt/gpt-5.3-codex", label: "ChatGPT Codex (GPT-5.3)", requiresOAuth: true, oauthProvider: "chatgpt" },
  { id: "chatgpt/gpt-5.4", label: "ChatGPT GPT-5.4", requiresOAuth: true, oauthProvider: "chatgpt" },
];

/** OpenAI Codex device-code page — always use this if LiteLLM omits verification_url. */
export const CHATGPT_DEVICE_AUTH_URL = "https://auth.openai.com/codex/device";

/**
 * @returns {boolean}
 */
export function isLitellmEnabled() {
  return Boolean(env.LITELLM_PROXY_URL?.trim() && env.LITELLM_MASTER_KEY?.trim());
}

/**
 * @returns {string}
 */
export function litellmProxyRoot() {
  return String(env.LITELLM_PROXY_URL || "").replace(/\/$/, "");
}

/**
 * OpenAI-compatible base URL workers and test-llm should call.
 * @returns {string}
 */
export function litellmOpenAiBaseUrl() {
  return `${litellmProxyRoot()}/v1`;
}

/**
 * Stable LiteLLM credential name for one YamBot user’s ChatGPT OAuth tokens.
 * @param {string} userId
 * @returns {string}
 */
export function userCredentialName(userId) {
  const safe = String(userId).replace(/[^a-zA-Z0-9]/g, "");
  return `yambot_u_${safe}`;
}

/**
 * Per-user LiteLLM model alias wired to that user’s ChatGPT OAuth credential.
 * @param {string} userId
 * @returns {string}
 */
export function userChatGptModelName(userId) {
  return `chatgpt-u-${String(userId).slice(-12)}`;
}

/**
 * Resolves the LiteLLM model name stored on the user for gateway routing.
 * @param {object} settings
 * @param {string} userId
 * @returns {string}
 */
export function resolveLitellmModelForUser(settings, userId) {
  let picked = String(settings?.llmModel || env.LITELLM_DEFAULT_MODEL || DEFAULT_LLM_MODEL).trim();
  if (picked === DEFAULT_LLM_MODEL || picked === "MiniMax-M2.7") {
    picked = "minimax";
  }
  const entry = LITELLM_CATALOG.find((m) => m.id === picked);
  if (entry?.requiresOAuth && settings?.litellmChatGptConnected) {
    return userChatGptModelName(userId);
  }
  if (entry?.requiresOAuth && !settings?.litellmChatGptConnected) {
    return "minimax";
  }
  return picked || "minimax";
}

/**
 * @param {string} path
 * @param {{ method?: string, body?: object, query?: Record<string, string> }} [opts]
 * @returns {Promise<any>}
 */
export async function litellmAdminFetch(path, opts = {}) {
  if (!isLitellmEnabled()) {
    throw new Error("LiteLLM gateway is not configured on this server");
  }
  const root = litellmProxyRoot();
  const url = new URL(`${root}${path.startsWith("/") ? path : `/${path}`}`);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v != null && v !== "") url.searchParams.set(k, v);
    }
  }
  let response;
  try {
    response = await fetch(url.toString(), {
      method: opts.method || "GET",
      headers: {
        Authorization: `Bearer ${env.LITELLM_MASTER_KEY}`,
        "Content-Type": "application/json",
      },
      body: opts.body != null ? JSON.stringify(opts.body) : undefined,
    });
  } catch (err) {
    throw new Error(`Could not reach LiteLLM proxy: ${err?.message || err}`);
  }
  const text = await response.text();
  /** @type {any} */
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  if (!response.ok) {
    const detail =
      data?.error?.message ||
      data?.error?.detail ||
      data?.detail ||
      data?.message ||
      text.slice(0, 400) ||
      `HTTP ${response.status}`;
    throw new Error(String(detail));
  }
  return data;
}

/**
 * @returns {Promise<string[]>}
 */
export async function listLitellmPublicModelIds() {
  const ids = LITELLM_CATALOG.filter((m) => !m.requiresOAuth).map((m) => m.id);
  try {
    const data = await litellmAdminFetch("/v1/models");
    const remote = (data?.data || []).map((row) => String(row.id || row.model || "").trim()).filter(Boolean);
    for (const id of remote) {
      if (!ids.includes(id)) ids.push(id);
    }
  } catch {
    // Why: catalog fallback keeps key generation working if /v1/models is temporarily unavailable.
  }
  return ids.length ? ids : ["minimax"];
}

/**
 * Ensures the user has a LiteLLM virtual key and gateway base URL persisted.
 * @param {import("../models/User.js").User} user — Mongoose document (mutated + saved when new key minted)
 * @returns {Promise<string>} decrypted virtual key
 */
export async function ensureUserVirtualKey(user) {
  if (!isLitellmEnabled()) {
    throw new Error("LiteLLM gateway is not configured");
  }
  if (!user.settings) user.settings = {};

  const existing = decryptSecret(user.settings.litellmVirtualKeyEnc || "");
  if (existing) {
    return existing;
  }

  const models = await listLitellmPublicModelIds();
  const data = await litellmAdminFetch("/key/generate", {
    method: "POST",
    body: {
      user_id: String(user._id),
      models,
      metadata: {
        yambot_user_id: String(user._id),
        email: user.email || "",
      },
    },
  });
  const key = String(data?.key || data?.token || "").trim();
  if (!key) {
    throw new Error("LiteLLM did not return a virtual key");
  }

  user.settings.litellmVirtualKeyEnc = encryptSecret(key);
  user.settings.llmGatewayMode = "litellm";
  user.settings.llmBaseUrl = litellmOpenAiBaseUrl();
  if (!user.settings.llmModel?.trim()) {
    user.settings.llmModel = env.LITELLM_DEFAULT_MODEL || DEFAULT_LLM_MODEL;
  }
  user.markModified("settings");
  await user.save();
  return key;
}

/**
 * Registers (or refreshes) a per-user ChatGPT model bound to the user’s OAuth credential.
 * @param {import("../models/User.js").User} user
 * @param {string} litellmModelId — catalog id e.g. chatgpt/gpt-5.3-codex
 * @returns {Promise<string>} resolved model_name for virtual key / worker
 */
export async function ensureUserChatGptModel(user, litellmModelId = "chatgpt/gpt-5.3-codex") {
  const userId = String(user._id);
  const credName = userCredentialName(userId);
  const modelName = userChatGptModelName(userId);
  const upstream = String(litellmModelId || "chatgpt/gpt-5.3-codex").trim();

  try {
    await litellmAdminFetch("/model/new", {
      method: "POST",
      body: {
        model_name: modelName,
        litellm_params: {
          model: upstream,
          api_key: `oauth:${credName}`,
        },
        model_info: { mode: "responses" },
      },
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (!/already|exist|duplicate/i.test(msg)) {
      throw err;
    }
  }

  const virtualKey = await ensureUserVirtualKey(user);
  let keyModels = await listLitellmPublicModelIds();
  if (!keyModels.includes(modelName)) {
    keyModels = [...keyModels, modelName];
  }
  try {
    await litellmAdminFetch("/key/update", {
      method: "POST",
      body: {
        key: virtualKey,
        models: keyModels,
      },
    });
  } catch {
    // Why: older LiteLLM builds may lack /key/update — model access might still work via team defaults.
  }

  if (!user.settings) user.settings = {};
  user.settings.litellmChatGptConnected = true;
  user.settings.litellmChatGptModel = modelName;
  user.settings.litellmCredentialName = credName;
  user.markModified("settings");
  await user.save();
  return modelName;
}

/**
 * Starts ChatGPT device-code OAuth via LiteLLM admin API.
 * @param {string} userId
 * @returns {Promise<{ sessionId: string, userCode: string, verificationUrl: string, credentialName: string }>}
 */
export async function startChatGptOAuth(userId) {
  const credentialName = userCredentialName(userId);
  const data = await litellmAdminFetch("/chatgpt/oauth/start", {
    method: "POST",
    body: { credential_name: credentialName },
  });
  return {
    sessionId: String(data?.session_id || ""),
    userCode: String(data?.user_code || ""),
    verificationUrl: String(
      data?.verification_url || data?.verification_uri || CHATGPT_DEVICE_AUTH_URL
    ),
    credentialName,
  };
}

/**
 * @param {string} sessionId
 * @returns {Promise<{ status: string, detail?: string, credentialName?: string }>}
 */
export async function getChatGptOAuthStatus(sessionId) {
  const data = await litellmAdminFetch("/chatgpt/oauth/status", {
    query: { session_id: sessionId },
  });
  return {
    status: String(data?.status || "pending"),
    detail: data?.error || data?.message ? String(data.error || data.message) : undefined,
    credentialName: data?.credential_name ? String(data.credential_name) : undefined,
  };
}

/**
 * @param {string} sessionId
 */
export async function cancelChatGptOAuth(sessionId) {
  if (!sessionId) return;
  try {
    await litellmAdminFetch("/chatgpt/oauth/cancel", {
      method: "POST",
      body: { session_id: sessionId },
    });
  } catch {
    // Best-effort cancel when user closes the modal.
  }
}

/**
 * @param {import("../models/User.js").User} user
 */
export async function disconnectUserChatGpt(user) {
  if (!user.settings) user.settings = {};
  user.settings.litellmChatGptConnected = false;
  user.settings.litellmChatGptAccountLabel = "";
  user.settings.litellmChatGptModel = "";
  if (user.settings.llmModel?.startsWith("chatgpt")) {
    user.settings.llmModel = env.LITELLM_DEFAULT_MODEL || DEFAULT_LLM_MODEL;
  }
  user.markModified("settings");
  await user.save();
}

/**
 * Imports YamBot Codex OAuth tokens (browser PKCE flow) into LiteLLM credentials DB.
 * @param {import("../models/User.js").User} user
 * @param {string} [litellmModelId]
 * @returns {Promise<{ credentialName: string, modelName: string }>}
 */
export async function importCodexOAuthToLitellm(user, litellmModelId = "chatgpt/gpt-5.3-codex") {
  const s = user.settings || {};
  const access = decryptSecret(s.llmOAuthAccessTokenEnc || "");
  const refresh = decryptSecret(s.llmOAuthRefreshTokenEnc || "");
  if (!access || !refresh) {
    throw new Error("Complete ChatGPT browser sign-in first, then try again.");
  }
  const credName = userCredentialName(user._id);
  try {
    await litellmAdminFetch("/credentials", {
      method: "POST",
      body: {
        credential_name: credName,
        credential_values: {
          access_token: access,
          refresh_token: refresh,
        },
        credential_info: { provider: "chatgpt" },
      },
    });
  } catch (err) {
    const msg = String(err?.message || err);
    if (!/already|exist|duplicate/i.test(msg)) {
      throw err;
    }
  }
  const modelName = await ensureUserChatGptModel(user, litellmModelId);
  user.settings.litellmChatGptAccountLabel = s.llmOAuthAccountLabel || credName;
  user.markModified("settings");
  await user.save();
  return { credentialName: credName, modelName };
}
