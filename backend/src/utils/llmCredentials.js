/**
 * @fileoverview Resolves effective LLM bearer credentials (API key or OAuth access token).
 * Purpose: Single path for Settings test-llm and worker runtime-config.
 * Downstream: settings routes, worker runtime-config.
 */

import { decryptSecret } from "./crypto.js";
import { env } from "./env.js";
import { getValidLlmOAuthAccessToken, isLlmOAuthConnected } from "./llmOAuth.js";
import {
  ensureUserVirtualKey,
  isLitellmEnabled,
  litellmOpenAiBaseUrl,
  resolveLitellmModelForUser,
} from "./litellmClient.js";

/**
 * @param {object} user — Mongoose user document or plain object with settings
 * @param {{ bodyApiKey?: string }} [opts]
 * @returns {Promise<{ apiKey: string, authMode: string, oauthProvider?: string, oauthAccount?: string, llmBaseUrl?: string, llmModel?: string, openAiAccountId?: string }>}
 */
export async function resolveLlmCredentials(user, opts = {}) {
  const s = user?.settings || {};
  const gatewayLitellm = isLitellmEnabled() && s.llmGatewayMode === "litellm";

  if (gatewayLitellm && user?._id) {
    await ensureUserVirtualKey(user);
    const virtualKey = decryptSecret(user.settings?.litellmVirtualKeyEnc || s.litellmVirtualKeyEnc || "");
    if (virtualKey) {
      const model = resolveLitellmModelForUser(user.settings || s, String(user._id));
      return {
        apiKey: virtualKey,
        authMode: "litellm",
        llmBaseUrl: litellmOpenAiBaseUrl(),
        llmModel: model,
      };
    }
  }

  const authMode = s.llmAuthMode === "oauth" ? "oauth" : "api_key";
  const baseUrl = String(s.llmBaseUrl || env.DEFAULT_LLM_BASE_URL).trim();
  const model = String(s.llmModel || env.DEFAULT_LLM_MODEL).trim();

  if (authMode === "oauth" && isLlmOAuthConnected(s)) {
    const oauth = await getValidLlmOAuthAccessToken(user);
    if (oauth.accessToken) {
      return {
        apiKey: oauth.accessToken,
        authMode: "oauth",
        oauthProvider: s.llmOAuthProvider || "",
        oauthAccount: s.llmOAuthAccountLabel || "",
        openAiAccountId: s.llmOAuthOpenAiAccountId || "",
        llmBaseUrl: baseUrl,
        llmModel: model,
      };
    }
  }

  const bodyKey = String(opts.bodyApiKey ?? "").trim();
  const apiKey =
    bodyKey || decryptSecret(s.llmApiKeyEnc || "") || env.DEFAULT_LLM_API_KEY || "";

  return {
    apiKey,
    authMode: "api_key",
    llmBaseUrl: baseUrl,
    llmModel: model,
  };
}

/**
 * Resolves vision LLM credentials — separate key or falls back to main LLM.
 * @param {object} user
 * @param {object} main
 * @returns {Promise<{ apiKey: string, baseUrl: string, model: string }>}
 */
export async function resolveVisionLlmCredentials(user, main) {
  const s = user?.settings || {};
  const visionKey = decryptSecret(s.visionApiKeyEnc || "");
  if (visionKey) {
    return {
      apiKey: visionKey,
      baseUrl: String(s.visionBaseUrl || main.llmBaseUrl || "").trim(),
      model: String(s.visionModel || main.llmModel || "").trim(),
    };
  }
  return {
    apiKey: main.apiKey,
    baseUrl: String(s.visionBaseUrl || main.llmBaseUrl || "").trim(),
    model: String(s.visionModel || main.llmModel || "").trim(),
  };
}
