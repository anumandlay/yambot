/**
 * @fileoverview LLM OAuth — PKCE connect flow and token refresh for Settings.
 * Purpose: Let users choose OAuth instead of pasting an API key (Azure OpenAI, Google Gemini).
 * Inputs: Provider client IDs/secrets from env; User.settings encrypted tokens.
 * Downstream: settings routes, llmCredentials.js, worker runtime-config.
 */

import crypto from "node:crypto";
import { encryptSecret, decryptSecret } from "./crypto.js";
import { env } from "./env.js";
import {
  OPENAI_CODEX_BASE_URL,
  OPENAI_CODEX_DEFAULT_MODEL,
  OPENAI_CODEX_LOOPBACK_REDIRECT,
  OPENAI_CODEX_PUBLIC_CLIENT_ID,
  decodeChatGptIdentity,
} from "./openaiCodex.js";

/** @typedef {{ id: string, label: string, hint?: string }} LlmOAuthProviderMeta */

/**
 * @returns {Record<string, { clientId: string, clientSecret: string, tenant?: string }>}
 */
function readProviderSecrets() {
  return {
    azure_openai: {
      clientId: process.env.AZURE_OPENAI_OAUTH_CLIENT_ID || "",
      clientSecret: process.env.AZURE_OPENAI_OAUTH_CLIENT_SECRET || "",
      tenant: process.env.AZURE_OPENAI_OAUTH_TENANT_ID || "common",
    },
    google_gemini: {
      clientId: process.env.GOOGLE_GEMINI_OAUTH_CLIENT_ID || "",
      clientSecret: process.env.GOOGLE_GEMINI_OAUTH_CLIENT_SECRET || "",
    },
    openai: {
      clientId: process.env.OPENAI_OAUTH_CLIENT_ID || "",
      clientSecret: process.env.OPENAI_OAUTH_CLIENT_SECRET || "",
    },
  };
}

/**
 * OAuth redirect URI for a provider (OpenAI ChatGPT sign-in uses loopback).
 * @param {string} providerId
 * @param {{ source?: string, publicClient?: boolean }} cfg
 * @returns {string}
 */
function oauthRedirectUriForProvider(providerId, cfg) {
  if (providerId === "openai" && (cfg?.source === "builtin" || cfg?.publicClient)) {
    return OPENAI_CODEX_LOOPBACK_REDIRECT;
  }
  return llmOAuthRedirectUri();
}

/** @type {LlmOAuthProviderMeta[]} */
export const LLM_OAUTH_PROVIDER_CATALOG = [
  {
    id: "azure_openai",
    label: "Microsoft Azure OpenAI",
    hint: "Set base URL to your Azure OpenAI resource (/openai/deployments/…/chat/completions?api-version=…). Model = deployment name.",
  },
  {
    id: "google_gemini",
    label: "Google Gemini (OAuth)",
    hint: "Uses Google Generative Language API. Base URL: https://generativelanguage.googleapis.com/v1beta/openai",
  },
  {
    id: "openai",
    label: "OpenAI (ChatGPT sign-in)",
    hint: "Sign in with your ChatGPT account — no API key or OAuth app setup. Uses your ChatGPT plan via Codex backend.",
  },
];

/**
 * Reads one user's saved OAuth app for a provider.
 * @param {object} settings
 * @param {string} providerId
 * @returns {{ clientId: string, clientSecret: string, tenant?: string }|null}
 */
function readUserOAuthApp(settings, providerId) {
  const apps = settings?.llmOAuthApps || {};
  const row = apps[providerId];
  if (!row) return null;
  const clientId = decryptSecret(row.clientIdEnc || "");
  const clientSecret = decryptSecret(row.clientSecretEnc || "");
  if (!clientId || !clientSecret) return null;
  return {
    clientId,
    clientSecret,
    tenant: row.tenantId || "common",
  };
}

/**
 * Server env first, then per-user OAuth app credentials.
 * @param {string} providerId
 * @param {object} [userSettings]
 * @returns {{ clientId: string, clientSecret: string, tenant?: string, source: string }|null}
 */
export function resolveOAuthClientConfig(providerId, userSettings) {
  const server = readProviderSecrets();
  const fromServer = server[providerId];
  if (fromServer?.clientId && fromServer?.clientSecret) {
    return { ...fromServer, source: "server", publicClient: false };
  }
  if (providerId === "openai") {
    const clientId = fromServer?.clientId || OPENAI_CODEX_PUBLIC_CLIENT_ID;
    return {
      clientId,
      clientSecret: fromServer?.clientSecret || "",
      publicClient: true,
      source: fromServer?.clientId ? "server_public" : "builtin",
    };
  }
  const fromUser = readUserOAuthApp(userSettings, providerId);
  if (fromUser) {
    return { ...fromUser, source: "user", publicClient: false };
  }
  return null;
}

/**
 * All LLM OAuth providers for Settings UI (always listed).
 * @param {object} [userSettings]
 * @returns {(LlmOAuthProviderMeta & { ready: boolean, needsAppCredentials: boolean, redirectUri: string })[]}
 */
export function listLlmOAuthProvidersForUser(userSettings) {
  const redirectUri = llmOAuthRedirectUri();
  return LLM_OAUTH_PROVIDER_CATALOG.map((p) => {
    const cfg = resolveOAuthClientConfig(p.id, userSettings);
    const isOpenAiBuiltin = p.id === "openai" && cfg?.source === "builtin";
    return {
      ...p,
      ready: Boolean(cfg?.clientId && (cfg.publicClient || cfg.clientSecret)),
      needsAppCredentials: p.id !== "openai" && !Boolean(readProviderSecrets()[p.id]?.clientId),
      needsPasteCallback: isOpenAiBuiltin,
      redirectUri: isOpenAiBuiltin ? OPENAI_CODEX_LOOPBACK_REDIRECT : redirectUri,
    };
  });
}

/**
 * Providers with client id configured on this server.
 * @returns {LlmOAuthProviderMeta[]}
 */
export function listConfiguredLlmOAuthProviders() {
  const secrets = readProviderSecrets();
  return LLM_OAUTH_PROVIDER_CATALOG.filter((p) => Boolean(secrets[p.id]?.clientId));
}

/**
 * Saves encrypted OAuth app credentials for one provider on the user.
 * @param {import('mongoose').Document} user
 * @param {string} providerId
 * @param {{ clientId?: string, clientSecret?: string, tenantId?: string }} creds
 */
export async function saveUserOAuthAppCredentials(user, providerId, creds) {
  if (!user.settings) user.settings = {};
  if (!user.settings.llmOAuthApps || typeof user.settings.llmOAuthApps !== "object") {
    user.settings.llmOAuthApps = {};
  }
  const prev = user.settings.llmOAuthApps[providerId] || {};
  const next = { ...prev };
  if (creds.clientId?.trim()) {
    next.clientIdEnc = encryptSecret(creds.clientId.trim());
  }
  if (creds.clientSecret?.trim()) {
    next.clientSecretEnc = encryptSecret(creds.clientSecret.trim());
  }
  if (typeof creds.tenantId === "string" && creds.tenantId.trim()) {
    next.tenantId = creds.tenantId.trim();
  }
  user.settings.llmOAuthApps[providerId] = next;
  user.markModified("settings");
  await user.save();
}

/**
 * @param {string} providerId
 * @returns {boolean}
 */
export function isLlmOAuthProviderConfigured(providerId) {
  return listConfiguredLlmOAuthProviders().some((p) => p.id === providerId);
}

/**
 * @param {object} settings
 * @returns {boolean}
 */
export function isLlmOAuthConnected(settings) {
  return (
    settings?.llmAuthMode === "oauth" &&
    Boolean(settings?.llmOAuthProvider) &&
    Boolean(decryptSecret(settings?.llmOAuthRefreshTokenEnc || "") ||
      decryptSecret(settings?.llmOAuthAccessTokenEnc || ""))
  );
}

/**
 * @returns {string}
 */
export function llmOAuthRedirectUri() {
  return `${env.PUBLIC_API_URL.replace(/\/$/, "")}/api/settings/llm/oauth/callback`;
}

/**
 * @returns {string}
 */
function generatePkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/**
 * @param {object} payload
 * @returns {string}
 */
function signOAuthState(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", env.JWT_SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}

/**
 * @param {string} state
 * @returns {object|null}
 */
export function verifyOAuthState(state) {
  const parts = String(state || "").split(".");
  if (parts.length !== 2) return null;
  const [data, sig] = parts;
  const expected = crypto.createHmac("sha256", env.JWT_SECRET).update(data).digest("base64url");
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (!payload?.userId || !payload?.provider || !payload?.verifier) return null;
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

/**
 * In-memory pending OpenAI OAuth sessions (short state → PKCE verifier).
 * Why: OpenAI rejects long signed state values; Codex CLI uses a short random state.
 * @type {Map<string, { userId: string, provider: string, verifier: string, redirectUri: string, popup: boolean, exp: number }>}
 */
const pendingOpenAiOAuth = new Map();

/**
 * @param {object} payload
 * @returns {string} short state id for authorize URL
 */
function stashOpenAiOAuthSession(payload) {
  purgeExpiredOpenAiOAuthSessions();
  const stateId = crypto.randomBytes(18).toString("base64url");
  pendingOpenAiOAuth.set(stateId, {
    userId: String(payload.userId),
    provider: String(payload.provider),
    verifier: String(payload.verifier),
    redirectUri: String(payload.redirectUri),
    popup: payload.popup === true,
    exp: Date.now() + 15 * 60 * 1000,
  });
  return stateId;
}

/**
 * Drops expired pending OAuth rows.
 */
function purgeExpiredOpenAiOAuthSessions() {
  const now = Date.now();
  for (const [key, row] of pendingOpenAiOAuth) {
    if (!row?.exp || row.exp < now) pendingOpenAiOAuth.delete(key);
  }
}

/**
 * Resolves OAuth state from signed blob or short OpenAI pending session.
 * @param {string} state
 * @returns {object|null}
 */
export function resolveOAuthStatePayload(state) {
  const signed = verifyOAuthState(state);
  if (signed) return signed;
  purgeExpiredOpenAiOAuthSessions();
  const row = pendingOpenAiOAuth.get(String(state || ""));
  if (!row || row.exp < Date.now()) {
    if (row) pendingOpenAiOAuth.delete(String(state));
    return null;
  }
  pendingOpenAiOAuth.delete(String(state));
  return {
    userId: row.userId,
    provider: row.provider,
    verifier: row.verifier,
    redirectUri: row.redirectUri,
    popup: row.popup,
  };
}

/**
 * Builds the provider authorization URL (PKCE).
 * @param {string} providerId
 * @param {string} userId
 * @param {object} [userSettings]
 * @param {{ popup?: boolean }} [opts]
 * @returns {{ authorizeUrl: string, state: string }}
 */
export function buildLlmOAuthAuthorizeUrl(providerId, userId, userSettings, opts = {}) {
  const cfg = resolveOAuthClientConfig(providerId, userSettings);
  if (!cfg?.clientId) {
    throw Object.assign(
      new Error(
        "OAuth app not configured. Enter your OAuth Client ID and Secret in the connect dialog (from Google Cloud / Azure)."
      ),
      { status: 400, title: "OAuth app required" }
    );
  }
  if (!cfg.publicClient && !cfg.clientSecret) {
    throw Object.assign(
      new Error("OAuth app not configured. Enter Client ID and Client Secret."),
      { status: 400, title: "OAuth app required" }
    );
  }
  const { verifier, challenge } = generatePkcePair();
  const redirectUri = oauthRedirectUriForProvider(providerId, cfg);
  const popup = opts.popup === true;
  const statePayload = {
    userId,
    provider: providerId,
    verifier,
    popup,
    redirectUri,
    exp: Date.now() + 15 * 60 * 1000,
  };
  const state =
    providerId === "openai" && (cfg.publicClient || cfg.source === "builtin")
      ? stashOpenAiOAuthSession(statePayload)
      : signOAuthState(statePayload);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  if (providerId === "azure_openai") {
    const tenant = cfg.tenant || "common";
    params.set(
      "scope",
      "https://cognitiveservices.azure.com/.default offline_access openid profile email"
    );
    return {
      authorizeUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/authorize?${params}`,
      state,
    };
  }

  if (providerId === "google_gemini") {
    params.set("scope", "openid email profile https://www.googleapis.com/auth/generative-language");
    params.set("access_type", "offline");
    params.set("prompt", "consent");
    return {
      authorizeUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      state,
    };
  }

  if (providerId === "openai") {
    const authorizeBase =
      process.env.OPENAI_OAUTH_AUTHORIZE_URL || "https://auth.openai.com/oauth/authorize";
    params.set("scope", process.env.OPENAI_OAUTH_SCOPE || "openid profile email offline_access");
    params.set("id_token_add_organizations", "true");
    params.set("codex_cli_simplified_flow", "true");
    params.set("originator", process.env.OPENAI_CODEX_ORIGINATOR || "codex");
    return { authorizeUrl: `${authorizeBase}?${params}`, state, needsPasteCallback: cfg.publicClient === true };
  }

  throw Object.assign(new Error("Unknown OAuth provider"), { status: 400 });
}

/**
 * @param {string} providerId
 * @param {string} code
 * @param {string} codeVerifier
 * @param {object} [userSettings]
 * @returns {Promise<{ accessToken: string, refreshToken?: string, expiresIn?: number, accountLabel?: string }>}
 */
async function exchangeOAuthCode(providerId, code, codeVerifier, userSettings, redirectUriOverride) {
  const cfg = resolveOAuthClientConfig(providerId, userSettings);
  if (!cfg?.clientId) {
    throw Object.assign(new Error("OAuth app not configured"), { status: 400 });
  }
  const redirectUri =
    redirectUriOverride || oauthRedirectUriForProvider(providerId, cfg);
  /** @type {URLSearchParams} */
  let body;
  /** @type {string} */
  let tokenUrl;

  if (providerId === "azure_openai") {
    const tenant = cfg.tenant || "common";
    tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
    body = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
      scope: "https://cognitiveservices.azure.com/.default offline_access openid profile email",
    });
  } else if (providerId === "google_gemini") {
    tokenUrl = "https://oauth2.googleapis.com/token";
    body = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
  } else if (providerId === "openai") {
    tokenUrl = process.env.OPENAI_OAUTH_TOKEN_URL || "https://auth.openai.com/oauth/token";
    body = new URLSearchParams({
      client_id: cfg.clientId,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: codeVerifier,
    });
    if (cfg.clientSecret) {
      body.set("client_secret", cfg.clientSecret);
    }
  } else {
    throw Object.assign(new Error("Unknown provider"), { status: 400 });
  }

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw Object.assign(new Error(text.slice(0, 300) || "Token exchange failed"), {
      status: 502,
      title: "OAuth token exchange failed",
    });
  }
  if (!res.ok) {
    throw Object.assign(
      new Error(data.error_description || data.error || text.slice(0, 300) || "Token exchange failed"),
      { status: 502, title: "OAuth token exchange failed" }
    );
  }

  let accountLabel = "";
  if (data.id_token) {
    try {
      const payload = JSON.parse(Buffer.from(data.id_token.split(".")[1], "base64url").toString("utf8"));
      accountLabel = payload.email || payload.preferred_username || payload.name || "";
    } catch {
      /* ignore */
    }
  }
  if (!accountLabel && providerId === "google_gemini" && data.access_token) {
    try {
      const me = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${data.access_token}` },
      });
      const info = await me.json();
      accountLabel = info.email || info.name || "";
    } catch {
      /* ignore */
    }
  }

  if (!accountLabel && providerId === "openai" && data.access_token) {
    const identity = decodeChatGptIdentity(data.access_token);
    const plan = identity.planType
      ? identity.planType.charAt(0).toUpperCase() + identity.planType.slice(1)
      : "";
    accountLabel =
      identity.email && plan
        ? `${identity.email} (${plan})`
        : identity.email || identity.planType || "";
  }

  const openAiAccountId =
    providerId === "openai" && data.access_token
      ? decodeChatGptIdentity(data.access_token).accountId || ""
      : "";

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresIn: Number(data.expires_in) || 3600,
    accountLabel,
    openAiAccountId,
  };
}

/**
 * @param {string} providerId
 * @param {string} refreshToken
 * @param {object} [userSettings]
 * @returns {Promise<{ accessToken: string, refreshToken?: string, expiresIn?: number }>}
 */
async function refreshOAuthToken(providerId, refreshToken, userSettings) {
  const cfg = resolveOAuthClientConfig(providerId, userSettings);
  if (!cfg?.clientId) {
    throw new Error("OAuth app not configured");
  }
  /** @type {URLSearchParams} */
  let body;
  /** @type {string} */
  let tokenUrl;

  if (providerId === "azure_openai") {
    const tenant = cfg.tenant || "common";
    tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
    body = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: "https://cognitiveservices.azure.com/.default offline_access openid profile email",
    });
  } else if (providerId === "google_gemini") {
    tokenUrl = "https://oauth2.googleapis.com/token";
    body = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
  } else if (providerId === "openai") {
    tokenUrl = process.env.OPENAI_OAUTH_TOKEN_URL || "https://auth.openai.com/oauth/token";
    body = new URLSearchParams({
      client_id: cfg.clientId,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    if (cfg.clientSecret) {
      body.set("client_secret", cfg.clientSecret);
    }
  } else {
    throw Object.assign(new Error("Unknown provider"), { status: 400 });
  }

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(text.slice(0, 300) || "Refresh failed");
  }
  if (!res.ok) {
    throw new Error(data.error_description || data.error || "Refresh failed");
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: Number(data.expires_in) || 3600,
  };
}

/**
 * Persists OAuth tokens on the user after successful connect.
 * @param {import('mongoose').Document} user
 * @param {string} providerId
 * @param {{ accessToken: string, refreshToken?: string, expiresIn?: number, accountLabel?: string }} tokens
 */
export async function saveLlmOAuthTokens(user, providerId, tokens) {
  if (!user.settings) user.settings = {};
  user.settings.llmAuthMode = "oauth";
  user.settings.llmOAuthProvider = providerId;
  user.settings.llmOAuthAccessTokenEnc = encryptSecret(tokens.accessToken || "");
  if (tokens.refreshToken) {
    user.settings.llmOAuthRefreshTokenEnc = encryptSecret(tokens.refreshToken);
  }
  user.settings.llmOAuthExpiresAt = new Date(
    Date.now() + Math.max(60, Number(tokens.expiresIn) || 3600) * 1000
  );
  user.settings.llmOAuthAccountLabel = String(tokens.accountLabel || "").slice(0, 200);

  if (providerId === "google_gemini" && !user.settings.llmBaseUrl) {
    user.settings.llmBaseUrl = "https://generativelanguage.googleapis.com/v1beta/openai";
  }
  if (providerId === "openai") {
    user.settings.llmBaseUrl = OPENAI_CODEX_BASE_URL;
    if (!user.settings.llmModel) {
      user.settings.llmModel = OPENAI_CODEX_DEFAULT_MODEL;
    }
    user.settings.llmOAuthOpenAiAccountId = String(tokens.openAiAccountId || "").slice(0, 120);
  }

  user.markModified("settings");
  await user.save();
}

/**
 * Clears OAuth tokens; keeps API key if any.
 * @param {import('mongoose').Document} user
 */
export async function clearLlmOAuth(user) {
  if (!user.settings) user.settings = {};
  user.settings.llmAuthMode = "api_key";
  user.settings.llmOAuthProvider = "";
  user.settings.llmOAuthAccessTokenEnc = "";
  user.settings.llmOAuthRefreshTokenEnc = "";
  user.settings.llmOAuthExpiresAt = null;
  user.settings.llmOAuthAccountLabel = "";
  user.settings.llmOAuthOpenAiAccountId = "";
  user.markModified("settings");
  await user.save();
}

/**
 * Returns a valid access token, refreshing when near expiry.
 * @param {import('mongoose').Document} user
 * @returns {Promise<{ accessToken: string|null, error?: string }>}
 */
export async function getValidLlmOAuthAccessToken(user) {
  const s = user?.settings || {};
  const providerId = s.llmOAuthProvider;
  if (!providerId) return { accessToken: null, error: "No OAuth provider" };

  const access = decryptSecret(s.llmOAuthAccessTokenEnc || "");
  const refresh = decryptSecret(s.llmOAuthRefreshTokenEnc || "");
  const expiresAt = s.llmOAuthExpiresAt ? new Date(s.llmOAuthExpiresAt).getTime() : 0;
  const stillValid = access && expiresAt > Date.now() + 60_000;

  if (stillValid) return { accessToken: access };

  if (!refresh) {
    return access ? { accessToken: access } : { accessToken: null, error: "OAuth session expired" };
  }

  try {
    const refreshed = await refreshOAuthToken(providerId, refresh, s);
    user.settings.llmOAuthAccessTokenEnc = encryptSecret(refreshed.accessToken || "");
    if (refreshed.refreshToken) {
      user.settings.llmOAuthRefreshTokenEnc = encryptSecret(refreshed.refreshToken);
    }
    user.settings.llmOAuthExpiresAt = new Date(
      Date.now() + Math.max(60, Number(refreshed.expiresIn) || 3600) * 1000
    );
    user.markModified("settings");
    await user.save();
    return { accessToken: refreshed.accessToken };
  } catch (err) {
    return { accessToken: null, error: String(err?.message || err) };
  }
}

/**
 * Completes OAuth callback — exchange code and save.
 * @param {string} code
 * @param {object} statePayload
 * @param {import('mongoose').Model} User
 */
export async function completeLlmOAuthCallback(code, statePayload, User) {
  const user = await User.findById(statePayload.userId);
  if (!user) {
    throw Object.assign(new Error("User not found"), { status: 404 });
  }
  const tokens = await exchangeOAuthCode(
    statePayload.provider,
    code,
    statePayload.verifier,
    user.settings || {},
    statePayload.redirectUri
  );
  await saveLlmOAuthTokens(user, statePayload.provider, tokens);
  return { provider: statePayload.provider, accountLabel: tokens.accountLabel || "" };
}

/**
 * Parses a pasted OAuth callback URL or raw code from OpenAI loopback redirect.
 * @param {string} input
 * @returns {{ code: string|null, state: string|null }}
 */
export function parseManualOAuthCallbackInput(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return { code: null, state: null };
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return { code: url.searchParams.get("code"), state: url.searchParams.get("state") };
    } catch {
      return { code: null, state: null };
    }
  }
  if (trimmed.includes("code=")) {
    const params = new URLSearchParams(trimmed.startsWith("?") ? trimmed.slice(1) : trimmed);
    return { code: params.get("code"), state: params.get("state") };
  }
  return { code: trimmed, state: null };
}

/**
 * Completes OAuth from a pasted loopback callback (OpenAI ChatGPT sign-in on web).
 * @param {string} pastedInput
 * @param {import('mongoose').Model} User
 * @param {string} [expectedUserId]
 */
export async function completeOAuthFromPaste(pastedInput, User, expectedUserId) {
  const { code, state: stateRaw } = parseManualOAuthCallbackInput(pastedInput);
  if (!code || !stateRaw) {
    throw Object.assign(new Error("Paste the full redirect URL from the sign-in popup"), {
      status: 400,
      title: "Missing authorization code",
    });
  }
  const statePayload = resolveOAuthStatePayload(stateRaw);
  if (!statePayload) {
    throw Object.assign(new Error("Invalid or expired OAuth state — start sign-in again"), {
      status: 400,
    });
  }
  if (expectedUserId && String(statePayload.userId) !== String(expectedUserId)) {
    throw Object.assign(new Error("OAuth state does not match your session"), { status: 403 });
  }
  return completeLlmOAuthCallback(code, statePayload, User);
}

/**
 * Minimal HTML for OAuth popup — notifies opener and closes.
 * @param {{ ok: boolean, provider?: string, account?: string, detail?: string }} payload
 * @returns {string}
 */
export function renderOAuthPopupHtml(payload) {
  const webOrigin = env.PUBLIC_WEB_URL.replace(/\/$/, "");
  const msg = JSON.stringify({ type: "yambot_llm_oauth", ...payload });
  const title = payload.ok ? "Connected" : "OAuth failed";
  const body = payload.ok
    ? "LLM account connected. This window will close."
    : String(payload.detail || "OAuth failed");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title></head><body style="font-family:system-ui;padding:2rem;text-align:center"><p>${body}</p><script>
try {
  if (window.opener) window.opener.postMessage(${msg}, ${JSON.stringify(webOrigin)});
} catch (e) {}
setTimeout(function(){ window.close(); }, 800);
</script></body></html>`;
}
