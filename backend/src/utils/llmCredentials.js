/**
 * @fileoverview Resolves effective LLM bearer credentials (API key or OAuth access token).
 * Purpose: Single path for Settings test-llm and worker runtime-config.
 * Downstream: settings routes, worker runtime-config (incl. optional per-agent profile/override).
 */

import { decryptSecret } from "./crypto.js";
import { env } from "./env.js";
import { normalizeLlmBaseUrl, normalizeLlmModel } from "./llmDefaults.js";
import { getValidLlmOAuthAccessToken, isLlmOAuthConnected } from "./llmOAuth.js";
import {
  OPENAI_CODEX_BASE_URL,
  isOpenAiCodexBaseUrl,
  resolveOpenAiOAuthModel,
} from "./openaiCodex.js";
import { LlmProfile } from "../models/LlmProfile.js";

/**
 * @param {object} user — Mongoose user document or plain object with settings
 * @param {{ bodyApiKey?: string }} [opts]
 * @returns {Promise<{ apiKey: string, authMode: string, oauthProvider?: string, oauthAccount?: string, llmBaseUrl?: string, llmModel?: string, openAiAccountId?: string }>}
 */
export async function resolveLlmCredentials(user, opts = {}) {
  const s = user?.settings || {};
  const authMode = s.llmAuthMode === "oauth" ? "oauth" : "api_key";

  if (authMode === "oauth" && isLlmOAuthConnected(s)) {
    const oauth = await getValidLlmOAuthAccessToken(user);
    if (oauth.accessToken) {
      const baseUrl = isOpenAiCodexBaseUrl(s.llmBaseUrl)
        ? String(s.llmBaseUrl || OPENAI_CODEX_BASE_URL).replace(/\/$/, "")
        : normalizeLlmBaseUrl(s.llmBaseUrl, env.DEFAULT_LLM_BASE_URL);
      const model =
        s.llmOAuthProvider === "openai"
          ? resolveOpenAiOAuthModel(s.llmModel)
          : normalizeLlmModel(s.llmModel, env.DEFAULT_LLM_MODEL);
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
    llmBaseUrl: normalizeLlmBaseUrl(s.llmBaseUrl, env.DEFAULT_LLM_BASE_URL),
    llmModel: normalizeLlmModel(s.llmModel, env.DEFAULT_LLM_MODEL),
  };
}

/**
 * Resolves LLM for a cloud agent: saved profile, legacy inline override, else Settings.
 * Why: agents pick a named profile from a dropdown without re-entering keys.
 * @param {object} user
 * @param {object|null|undefined} agent
 * @returns {Promise<{ apiKey: string, authMode: string, oauthProvider?: string, oauthAccount?: string, llmBaseUrl?: string, llmModel?: string, openAiAccountId?: string, source: "profile"|"agent"|"settings", profileId?: string, profileName?: string }>}
 */
export async function resolveLlmCredentialsForAgent(user, agent) {
  const main = await resolveLlmCredentials(user);
  const llm = agent?.llm || {};
  const userId = user?._id || user?.id;

  const profileId = llm.profile ? String(llm.profile) : "";
  if (profileId) {
    const profile = await LlmProfile.findOne({ _id: profileId, user: userId }).lean();
    if (profile) {
      const profileKey = decryptSecret(profile.apiKeyEnc || "");
      const apiKey = profileKey || main.apiKey || "";
      const baseUrl = String(profile.baseUrl || "").trim()
        ? normalizeLlmBaseUrl(profile.baseUrl, main.llmBaseUrl || env.DEFAULT_LLM_BASE_URL)
        : main.llmBaseUrl || env.DEFAULT_LLM_BASE_URL;
      const model = String(profile.model || "").trim()
        ? normalizeLlmModel(profile.model, main.llmModel || env.DEFAULT_LLM_MODEL)
        : main.llmModel || env.DEFAULT_LLM_MODEL;
      return {
        apiKey,
        authMode: "api_key",
        llmBaseUrl: baseUrl,
        llmModel: model,
        source: "profile",
        profileId: String(profile._id),
        profileName: profile.name || "",
      };
    }
  }

  if (!llm.useCustom) {
    return { ...main, source: "settings" };
  }

  // Why: legacy agents that stored key/base/model inline before named profiles.
  const agentKey = decryptSecret(llm.apiKeyEnc || "");
  const apiKey = agentKey || main.apiKey || "";
  const baseUrl = String(llm.baseUrl || "").trim()
    ? normalizeLlmBaseUrl(llm.baseUrl, main.llmBaseUrl || env.DEFAULT_LLM_BASE_URL)
    : main.llmBaseUrl || env.DEFAULT_LLM_BASE_URL;
  const model = String(llm.model || "").trim()
    ? normalizeLlmModel(llm.model, main.llmModel || env.DEFAULT_LLM_MODEL)
    : main.llmModel || env.DEFAULT_LLM_MODEL;

  return {
    apiKey,
    authMode: "api_key",
    llmBaseUrl: baseUrl,
    llmModel: model,
    source: "agent",
  };
}

/**
 * Loads a named LlmProfile as vision credentials (falls back to main key if profile key empty).
 * @param {object} user
 * @param {object} main
 * @param {string} profileId
 * @returns {Promise<{ apiKey: string, baseUrl: string, model: string, source: string, profileId: string, profileName: string }|null>}
 */
async function resolveVisionFromProfile(user, main, profileId) {
  const id = String(profileId || "").trim();
  if (!id) return null;
  const userId = user?._id || user?.id;
  const profile = await LlmProfile.findOne({ _id: id, user: userId }).lean();
  if (!profile) return null;
  const profileKey = decryptSecret(profile.apiKeyEnc || "");
  const apiKey = profileKey || main.apiKey || "";
  const baseUrl = String(profile.baseUrl || "").trim()
    ? normalizeLlmBaseUrl(profile.baseUrl, main.llmBaseUrl || env.DEFAULT_LLM_BASE_URL)
    : main.llmBaseUrl || env.DEFAULT_LLM_BASE_URL;
  const model = String(profile.model || "").trim()
    ? normalizeLlmModel(profile.model, main.llmModel || env.DEFAULT_LLM_MODEL)
    : main.llmModel || env.DEFAULT_LLM_MODEL;
  return {
    apiKey,
    baseUrl,
    model,
    source: "vision_profile",
    profileId: String(profile._id),
    profileName: profile.name || "",
  };
}

/**
 * Resolves vision LLM credentials for screenshot recovery steps.
 * Order: agent llm.visionProfile → settings.visionProfile → legacy vision fields → main LLM.
 * @param {object} user
 * @param {object} main
 * @param {object|null|undefined} [agent]
 * @returns {Promise<{ apiKey: string, baseUrl: string, model: string, openAiAccountId?: string, source?: string, profileId?: string, profileName?: string }>}
 */
export async function resolveVisionLlmCredentials(user, main, agent = null) {
  const s = user?.settings || {};

  const fromAgent = await resolveVisionFromProfile(user, main, agent?.llm?.visionProfile);
  if (fromAgent) return fromAgent;

  const fromSettings = await resolveVisionFromProfile(user, main, s.visionProfile);
  if (fromSettings) return fromSettings;

  const visionKey = decryptSecret(s.visionApiKeyEnc || "");
  const visionBase = s.visionBaseUrl
    ? normalizeLlmBaseUrl(s.visionBaseUrl, main.llmBaseUrl || env.DEFAULT_LLM_BASE_URL)
    : main.llmBaseUrl || env.DEFAULT_LLM_BASE_URL;
  const visionModel = s.visionModel
    ? normalizeLlmModel(s.visionModel, main.llmModel || env.DEFAULT_LLM_MODEL)
    : main.llmModel || env.DEFAULT_LLM_MODEL;
  if (visionKey) {
    return {
      apiKey: visionKey,
      baseUrl: visionBase,
      model: visionModel,
      source: "legacy_vision",
    };
  }
  return {
    apiKey: main.apiKey,
    baseUrl: visionBase,
    model: visionModel,
    openAiAccountId: main.openAiAccountId || "",
    source: "main",
  };
}
