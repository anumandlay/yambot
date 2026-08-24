/**
 * @fileoverview Resolves effective LLM bearer credentials (API key).
 * Purpose: Single path for worker runtime-config.
 * Downstream: worker runtime-config.
 */

import { decryptSecret } from "./crypto.js";
import { env } from "./env.js";

/**
 * @param {object} user — Mongoose user document or plain object with settings
 * @param {{ bodyApiKey?: string }} [opts]
 * @returns {Promise<{ apiKey: string, authMode: string, llmBaseUrl?: string, llmModel?: string }>}
 */
export async function resolveLlmCredentials(user, opts = {}) {
  const s = user?.settings || {};
  const bodyKey = String(opts.bodyApiKey ?? "").trim();
  const apiKey =
    bodyKey || decryptSecret(s.llmApiKeyEnc || "") || env.DEFAULT_LLM_API_KEY || "";

  return {
    apiKey,
    authMode: "api_key",
    llmBaseUrl: String(s.llmBaseUrl || env.DEFAULT_LLM_BASE_URL).trim(),
    llmModel: String(s.llmModel || env.DEFAULT_LLM_MODEL).trim(),
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
