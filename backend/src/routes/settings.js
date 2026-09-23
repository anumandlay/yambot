/**
 * @fileoverview Settings routes — LLM + DeathByCaptcha credentials for the agent.
 * Purpose: Let users configure provider API keys on the website for cloud workers.
 * Downstream: User.settings (encrypted); `/api/worker/runtime-config` reads decrypted values.
 */

import { Router } from "express";
import { User } from "../models/User.js";
import { encryptSecret, decryptSecret } from "../utils/crypto.js";
import { env } from "../utils/env.js";
import { normalizeLlmBaseUrl, normalizeLlmModel } from "../utils/llmDefaults.js";
import { normalizeContextTokens } from "../utils/llmContextWindow.js";
import { resolveOpenAiOAuthModel, OPENAI_CODEX_BASE_URL } from "../utils/openaiCodex.js";
import { resolveLlmCredentials } from "../utils/llmCredentials.js";
import { probeLlmConnection } from "../utils/llmTest.js";
import {
  buildLlmOAuthAuthorizeUrl,
  clearLlmOAuth,
  completeLlmOAuthCallback,
  completeOAuthFromPaste,
  isLlmOAuthConnected,
  listLlmOAuthProvidersForUser,
  renderOAuthPopupHtml,
  resolveOAuthClientConfig,
  resolveOAuthStatePayload,
} from "../utils/llmOAuth.js";

export const settingsRouter = Router();

/**
 * Masks a secret for UI display (show last 4 chars only).
 * @param {string} value
 * @returns {string}
 */
function mask(value) {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return `••••••••${value.slice(-4)}`;
}

/**
 * GET /api/settings — config for Settings → LLM.
 * Why: operators asked to see full LLM/vision API keys on /settings/llm (not masked).
 */
settingsRouter.get("/", async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ ok: false, title: "Not found", detail: "User missing" });
      return;
    }
    const s = user.settings || {};
    const savedKey = decryptSecret(s.llmApiKeyEnc || "") || "";
    const savedVisionKey = decryptSecret(s.visionApiKeyEnc || "") || "";
    const savedDbcPass = decryptSecret(s.dbcPasswordEnc || "") || "";
    const oauthOpenAi =
      s.llmAuthMode === "oauth" && s.llmOAuthProvider === "openai" && isLlmOAuthConnected(s);
    res.json({
      ok: true,
      settings: {
        llmAuthMode:
          s.llmAuthMode === "oauth" && isLlmOAuthConnected(s) ? "oauth" : "api_key",
        llmOAuthProvider: s.llmOAuthProvider || "",
        llmOAuthConnected: isLlmOAuthConnected(s),
        llmOAuthAccountLabel: s.llmOAuthAccountLabel || "",
        llmOAuthProviders: listLlmOAuthProvidersForUser(s),
        llmOAuthRedirectUri: `${env.PUBLIC_API_URL.replace(/\/$/, "")}/api/settings/llm/oauth/callback`,
        llmApiKey: savedKey,
        llmApiKeyMasked: mask(savedKey),
        hasLlmApiKey: Boolean(savedKey),
        llmBaseUrl: oauthOpenAi
          ? OPENAI_CODEX_BASE_URL
          : normalizeLlmBaseUrl(s.llmBaseUrl, env.DEFAULT_LLM_BASE_URL),
        llmModel: oauthOpenAi
          ? resolveOpenAiOAuthModel(s.llmModel)
          : normalizeLlmModel(s.llmModel, env.DEFAULT_LLM_MODEL),
        llmContextTokens: normalizeContextTokens(s.llmContextTokens) || 0,
        visionApiKey: savedVisionKey,
        visionApiKeyMasked: mask(savedVisionKey),
        hasVisionApiKey: Boolean(savedVisionKey),
        visionBaseUrl: s.visionBaseUrl
          ? normalizeLlmBaseUrl(s.visionBaseUrl, env.DEFAULT_LLM_BASE_URL)
          : "",
        visionModel: s.visionModel ? normalizeLlmModel(s.visionModel, env.DEFAULT_LLM_MODEL) : "",
        visionProfileId: s.visionProfile ? String(s.visionProfile) : "",
        dbcUsername: s.dbcUsername || "",
        dbcPassword: savedDbcPass,
        dbcPasswordMasked: mask(savedDbcPass),
        hasDbcPassword: Boolean(savedDbcPass),
        confirmBeforeSubmit: s.confirmBeforeSubmit === true,
        helpEnabled: s.helpEnabled !== false,
      },
    });
  } catch (err) {
    next(err);
  }
});
/**
 * PUT /api/settings — update config; empty secret fields keep previous values.
 * Body fields: llmApiKey?, llmBaseUrl, llmModel, dbcUsername, dbcPassword?, confirmBeforeSubmit
 */
settingsRouter.put("/", async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ ok: false, title: "Not found", detail: "User missing" });
      return;
    }
    const body = req.body || {};
    if (!user.settings) user.settings = {};

    if (typeof body.llmBaseUrl === "string") {
      user.settings.llmBaseUrl = normalizeLlmBaseUrl(body.llmBaseUrl.trim(), env.DEFAULT_LLM_BASE_URL);
    }
    if (typeof body.llmModel === "string") {
      user.settings.llmModel = normalizeLlmModel(body.llmModel.trim(), env.DEFAULT_LLM_MODEL);
    }
    if (body.llmContextTokens != null || body.contextTokens != null) {
      user.settings.llmContextTokens = normalizeContextTokens(
        body.llmContextTokens ?? body.contextTokens
      );
    }
    if (typeof body.visionBaseUrl === "string" && body.visionBaseUrl.trim()) {
      user.settings.visionBaseUrl = normalizeLlmBaseUrl(body.visionBaseUrl.trim(), env.DEFAULT_LLM_BASE_URL);
    }
    if (typeof body.visionModel === "string" && body.visionModel.trim()) {
      user.settings.visionModel = normalizeLlmModel(body.visionModel.trim(), env.DEFAULT_LLM_MODEL);
    }
    if (body.visionProfileId !== undefined || body.visionProfile !== undefined) {
      const raw = body.visionProfileId ?? body.visionProfile;
      const visionProfileId =
        raw && String(raw).trim() && String(raw) !== "settings" ? String(raw).trim() : "";
      if (visionProfileId) {
        const { LlmProfile } = await import("../models/LlmProfile.js");
        const ok = await LlmProfile.exists({ _id: visionProfileId, user: req.userId });
        if (!ok) {
          res.status(400).json({
            ok: false,
            title: "Invalid vision LLM",
            detail: "That vision LLM profile was not found. Create one under Settings → LLM profiles.",
          });
          return;
        }
        user.settings.visionProfile = visionProfileId;
      } else {
        user.settings.visionProfile = null;
      }
    }
    if (typeof body.dbcUsername === "string") user.settings.dbcUsername = body.dbcUsername.trim();
    if (typeof body.confirmBeforeSubmit === "boolean") {
      user.settings.confirmBeforeSubmit = body.confirmBeforeSubmit;
    }
    if (typeof body.helpEnabled === "boolean") {
      user.settings.helpEnabled = body.helpEnabled;
    }

    // Why: saving API-key form selects API-key mode; OAuth is set only via connect flow.
    if (body.llmAuthMode === "api_key") {
      user.settings.llmAuthMode = "api_key";
    }
    user.settings.llmGatewayMode = "direct";

    if (typeof body.llmApiKey === "string" && body.llmApiKey.trim()) {
      user.settings.llmApiKeyEnc = encryptSecret(body.llmApiKey.trim());
    }
    if (typeof body.visionApiKey === "string" && body.visionApiKey.trim()) {
      user.settings.visionApiKeyEnc = encryptSecret(body.visionApiKey.trim());
    }
    if (typeof body.dbcPassword === "string" && body.dbcPassword.trim()) {
      user.settings.dbcPasswordEnc = encryptSecret(body.dbcPassword.trim());
    }

    user.markModified("settings");
    await user.save();
    res.json({ ok: true, message: "Settings saved" });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/settings/llm/oauth/providers — OpenAI OAuth provider metadata.
 */
settingsRouter.get("/llm/oauth/providers", async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    const s = user?.settings || {};
    res.json({ ok: true, providers: listLlmOAuthProvidersForUser(s) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/settings/llm/oauth/start — begin OpenAI OAuth connect (returns redirect URL).
 * Body: { provider?: "openai", popup?: boolean }
 */
settingsRouter.post("/llm/oauth/start", async (req, res, next) => {
  try {
    const provider = String(req.body?.provider || "openai").trim();
    if (provider !== "openai") {
      res.status(400).json({ ok: false, title: "Unsupported provider", detail: "Only OpenAI is supported." });
      return;
    }
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ ok: false, title: "Not found", detail: "User missing" });
      return;
    }
    const popup = req.body?.popup === true;
    const { authorizeUrl } = buildLlmOAuthAuthorizeUrl(
      provider,
      String(req.userId),
      user.settings || {},
      { popup }
    );
    const cfg = resolveOAuthClientConfig(provider, user.settings || {});
    res.json({
      ok: true,
      authorizeUrl,
      provider,
      popup,
      needsPasteCallback: cfg?.publicClient === true,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/settings/llm/oauth/complete-paste — finish OpenAI loopback OAuth from pasted callback URL.
 * Body: { pastedInput: string }
 */
settingsRouter.post("/llm/oauth/complete-paste", async (req, res, next) => {
  try {
    const pastedInput = String(req.body?.pastedInput ?? "").trim();
    if (!pastedInput) {
      res.status(400).json({ ok: false, title: "Missing URL", detail: "Paste the redirect URL from the popup." });
      return;
    }
    const result = await completeOAuthFromPaste(pastedInput, User, String(req.userId));
    res.json({
      ok: true,
      message: "OpenAI connected",
      provider: result.provider,
      account: result.accountLabel || "",
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/settings/llm/oauth/disconnect — clear OAuth tokens; revert to API key mode.
 */
settingsRouter.post("/llm/oauth/disconnect", async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ ok: false, title: "Not found", detail: "User missing" });
      return;
    }
    await clearLlmOAuth(user);
    res.json({ ok: true, message: "OpenAI disconnected" });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/settings/llm/oauth/callback — OAuth redirect (no JWT; state is signed).
 * Mounted without authRequired in index.js.
 */
export async function llmOAuthCallbackHandler(req, res) {
  const webBase = env.PUBLIC_WEB_URL.replace(/\/$/, "");
  const stateRaw = String(req.query?.state || "");
  const statePayload = stateRaw ? resolveOAuthStatePayload(stateRaw) : null;
  const popup = statePayload?.popup === true;

  /** @param {string} detail */
  const fail = (detail) => {
    if (popup) {
      res.status(400).type("html").send(renderOAuthPopupHtml({ ok: false, detail: detail.slice(0, 180) }));
      return;
    }
    res.redirect(`${webBase}/settings/openai?llm_oauth=error&detail=${encodeURIComponent(detail.slice(0, 180))}`);
  };

  try {
    const code = String(req.query?.code || "");
    const oauthErr = String(req.query?.error || "");
    if (oauthErr) {
      fail(oauthErr);
      return;
    }
    if (!code || !stateRaw) {
      fail("Missing OAuth code or state");
      return;
    }
    if (!statePayload) {
      fail("Invalid or expired OAuth state");
      return;
    }
    const result = await completeLlmOAuthCallback(code, statePayload, User);
    if (popup) {
      res.type("html").send(
        renderOAuthPopupHtml({
          ok: true,
          provider: result.provider,
          account: result.accountLabel || "",
        })
      );
      return;
    }
    const q = new URLSearchParams({
      llm_oauth: "connected",
      provider: result.provider,
      account: result.accountLabel || "",
    });
    res.redirect(`${webBase}/settings/openai?${q}`);
  } catch (err) {
    fail(String(err?.message || err || "OAuth failed"));
  }
}

const DBC_BASES = ["https://api.dbcapi.me/api", "http://api.dbcapi.me/api"];

/**
 * POST /api/settings/test-llm — verify OpenAI-compatible LLM credentials.
 * Body: { llmApiKey?, llmBaseUrl?, llmModel? } — blank key uses the saved secret.
 */
settingsRouter.post("/test-llm", async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ ok: false, title: "Not found", detail: "User missing" });
      return;
    }
    const bodyKey = String(req.body?.llmApiKey ?? "").trim();
    const creds = await resolveLlmCredentials(user, { bodyApiKey: bodyKey });
    const baseUrl = normalizeLlmBaseUrl(
      String(req.body?.llmBaseUrl ?? creds.llmBaseUrl ?? "").trim(),
      env.DEFAULT_LLM_BASE_URL
    );
    const model = normalizeLlmModel(
      String(req.body?.llmModel ?? creds.llmModel ?? "").trim(),
      env.DEFAULT_LLM_MODEL
    );
    const apiKey = bodyKey || creds.apiKey;

    if (!apiKey) {
      res.status(400).json({
        ok: false,
        title: creds.authMode === "oauth" ? "OpenAI not connected" : "Missing API key",
        detail:
          creds.authMode === "oauth"
            ? "Connect OpenAI on Settings → OpenAI OAuth."
            : "Enter an LLM API key (or save one first).",
        hint: "Key can be left blank in the form if a saved value already exists.",
      });
      return;
    }

    try {
      const result = await probeLlmConnection({
        apiKey,
        baseUrl,
        model,
        openAiAccountId: creds.openAiAccountId || "",
      });
      res.json({
        ok: true,
        message: "LLM connected",
        model: result.model,
        preview: result.preview,
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        title: err.title || "LLM connection failed",
        detail: String(err?.message || err),
        hint: err.hint || "Verify API key, base URL, and model.",
      });
    }
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/settings/test-dbc — verify DeathByCaptcha credentials via balance lookup.
 * Body: { dbcUsername?, dbcPassword? } — blank password uses the saved secret.
 */
settingsRouter.post("/test-dbc", async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ ok: false, title: "Not found", detail: "User missing" });
      return;
    }
    const s = user.settings || {};
    const username = String(req.body?.dbcUsername ?? s.dbcUsername ?? "").trim();
    const bodyPass = String(req.body?.dbcPassword ?? "").trim();
    const password = bodyPass || decryptSecret(s.dbcPasswordEnc || "");

    if (!username || !password) {
      res.status(400).json({
        ok: false,
        title: "Missing credentials",
        detail: "Enter DeathByCaptcha username and password (or save them first).",
        hint: "Password can be left blank in the form if a saved value already exists.",
      });
      return;
    }

    let lastErr = null;
    for (const base of DBC_BASES) {
      try {
        const response = await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ username, password }).toString(),
        });
        const text = await response.text();
        let data;
        try {
          data = JSON.parse(text);
        } catch {
          data = Object.fromEntries(new URLSearchParams(text));
        }
        if (!response.ok) {
          throw new Error(text.slice(0, 300) || `HTTP ${response.status}`);
        }
        const banned = data.is_banned === true || data.is_banned === 1 || data.is_banned === "1";
        if (banned) {
          res.status(403).json({
            ok: false,
            title: "Account banned",
            detail: "DeathByCaptcha reports this account as banned.",
          });
          return;
        }
        const balanceRaw = data.balance;
        const balance =
          balanceRaw == null || balanceRaw === ""
            ? null
            : Number(balanceRaw);
        res.json({
          ok: true,
          message: "DeathByCaptcha connected",
          userId: data.user != null ? String(data.user) : null,
          balanceCents: Number.isFinite(balance) ? balance : null,
          rate: data.rate != null ? Number(data.rate) : null,
        });
        return;
      } catch (err) {
        lastErr = err;
      }
    }

    res.status(502).json({
      ok: false,
      title: "Connection failed",
      detail: String(lastErr?.message || lastErr || "Could not reach DeathByCaptcha"),
      hint: "Check username/password (or authtoken) and try again.",
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/settings/curated-memory — account USER.md curated facts.
 * Why: Hermes-style user profile shared by all agents; operator can edit/clear.
 */
settingsRouter.get("/curated-memory", async (req, res, next) => {
  try {
    const { getUserCuratedMemory } = await import("../utils/curatedMemoryOps.js");
    const store = await getUserCuratedMemory(req.userId);
    let mem0Items = [];
    let mem0Enabled = false;
    try {
      const { isMem0Enabled, mem0ListFacts } = await import("../utils/mem0Service.js");
      mem0Enabled = isMem0Enabled();
      if (mem0Enabled) {
        mem0Items = await mem0ListFacts({
          userId: req.userId,
          scope: "user",
          limit: 100,
        });
      }
    } catch (err) {
      console.warn("[settings] mem0 list failed:", err?.message || err);
    }
    res.json({
      ok: true,
      target: "user",
      ...store,
      mem0Enabled,
      mem0Items,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/settings/curated-memory — add|replace|remove on USER store.
 * Body: { action, content?, oldText? }
 */
settingsRouter.post("/curated-memory", async (req, res, next) => {
  try {
    const { mutateCuratedMemory } = await import("../utils/curatedMemoryOps.js");
    const result = await mutateCuratedMemory({
      userId: req.userId,
      action: req.body?.action,
      target: "user",
      content: req.body?.content,
      oldText: req.body?.oldText || req.body?.old_text,
    });
    if (!result.success) {
      res.status(400).json({ ok: false, title: "Memory update failed", detail: result.error, ...result });
      return;
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/settings/curated-memory — replace entire USER store (or clear with []).
 * Body: { entries: string[] }
 */
settingsRouter.put("/curated-memory", async (req, res, next) => {
  try {
    const { setCuratedMemoryEntries } = await import("../utils/curatedMemoryOps.js");
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    const result = await setCuratedMemoryEntries({
      userId: req.userId,
      target: "user",
      entries,
    });
    if (!result.success) {
      res.status(400).json({ ok: false, title: "Memory update failed", detail: result.error });
      return;
    }
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/settings/curated-memory — clear USER store.
 * Query: ?mem0=1 also clears Mem0 USER-profile vectors; ?mem0Only=1 clears only Mem0.
 */
settingsRouter.delete("/curated-memory", async (req, res, next) => {
  try {
    const mem0Only =
      req.query?.mem0Only === "1" ||
      req.query?.mem0Only === "true" ||
      req.body?.mem0Only === true;
    const clearMem0 =
      mem0Only ||
      req.query?.mem0 === "1" ||
      req.query?.mem0 === "true" ||
      req.body?.clearMem0 === true;

    let mongoResult = { success: true, message: "skipped" };
    if (!mem0Only) {
      const { setCuratedMemoryEntries } = await import("../utils/curatedMemoryOps.js");
      mongoResult = await setCuratedMemoryEntries({
        userId: req.userId,
        target: "user",
        entries: [],
      });
    }

    let mem0Cleared = false;
    if (clearMem0 || mem0Only) {
      const { mem0ClearScope } = await import("../utils/mem0Service.js");
      const r = await mem0ClearScope({ userId: req.userId, scope: "user" });
      mem0Cleared = Boolean(r.ok);
    }

    res.json({
      ok: true,
      ...mongoResult,
      mem0Cleared,
      message: mem0Only
        ? mem0Cleared
          ? "Mem0 USER prefs cleared."
          : "Mem0 clear failed or disabled."
        : clearMem0
          ? "USER memory cleared (Mongo + Mem0)."
          : mongoResult.message || "USER memory cleared.",
    });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/settings/curated-memory/mem0/:id — remove one Mem0 USER-profile fact.
 */
settingsRouter.delete("/curated-memory/mem0/:id", async (req, res, next) => {
  try {
    const { mem0DeleteFact, mem0ListFacts, isMem0Enabled } = await import(
      "../utils/mem0Service.js"
    );
    if (!isMem0Enabled()) {
      res.status(400).json({
        ok: false,
        title: "Mem0 disabled",
        detail: "Long-term Mem0 store is not enabled on this server.",
      });
      return;
    }
    const result = await mem0DeleteFact({ userId: req.userId, id: req.params.id });
    if (!result.ok) {
      const status = result.skipped === "forbidden" ? 403 : 404;
      res.status(status).json({
        ok: false,
        title: "Delete failed",
        detail: result.skipped || "unknown",
      });
      return;
    }
    const mem0Items = await mem0ListFacts({
      userId: req.userId,
      scope: "user",
      limit: 100,
    });
    res.json({ ok: true, message: "Mem0 entry removed.", mem0Items });
  } catch (err) {
    next(err);
  }
});
