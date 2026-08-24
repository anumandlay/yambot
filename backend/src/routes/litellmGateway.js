/**
 * @fileoverview LiteLLM gateway routes — models, virtual keys, ChatGPT device-code OAuth.
 * Purpose: Expose LiteLLM proxy capabilities to authenticated YamBot users on Settings.
 * Downstream: litellmClient admin calls; SettingsPage + LlmGatewayModal.
 */

import { Router } from "express";
import { User } from "../models/User.js";
import {
  LITELLM_CATALOG,
  cancelChatGptOAuth,
  disconnectUserChatGpt,
  ensureUserChatGptModel,
  ensureUserVirtualKey,
  getChatGptOAuthStatus,
  isLitellmEnabled,
  resolveLitellmModelForUser,
  startChatGptOAuth,
} from "../utils/litellmClient.js";

export const litellmGatewayRouter = Router();

/**
 * GET /api/settings/litellm/status — whether gateway is active for this deployment.
 */
litellmGatewayRouter.get("/status", async (_req, res) => {
  res.json({
    ok: true,
    enabled: isLitellmEnabled(),
    defaultModel: process.env.LITELLM_DEFAULT_MODEL || "minimax",
  });
});

/**
 * GET /api/settings/litellm/models — model catalog + user ChatGPT connection state.
 */
litellmGatewayRouter.get("/models", async (req, res, next) => {
  try {
    if (!isLitellmEnabled()) {
      res.status(503).json({
        ok: false,
        title: "Gateway unavailable",
        detail: "LiteLLM is not configured on this server.",
      });
      return;
    }
    const user = await User.findById(req.userId);
    const s = user?.settings || {};
    res.json({
      ok: true,
      models: LITELLM_CATALOG,
      chatgptConnected: s.litellmChatGptConnected === true,
      chatgptAccountLabel: s.litellmChatGptAccountLabel || "",
      resolvedModel: user ? resolveLitellmModelForUser(s, String(user._id)) : "",
      hasVirtualKey: Boolean(s.litellmVirtualKeyEnc),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/settings/litellm/ensure-key — mint virtual key if missing (idempotent).
 */
litellmGatewayRouter.post("/ensure-key", async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ ok: false, title: "Not found", detail: "User missing" });
      return;
    }
    await ensureUserVirtualKey(user);
    res.json({ ok: true, message: "LiteLLM virtual key ready" });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/settings/litellm/oauth/chatgpt/start — device-code OAuth via LiteLLM.
 */
litellmGatewayRouter.post("/oauth/chatgpt/start", async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ ok: false, title: "Not found", detail: "User missing" });
      return;
    }
    await ensureUserVirtualKey(user);
    const session = await startChatGptOAuth(String(req.userId));
    if (!session.sessionId || !session.userCode) {
      res.status(502).json({
        ok: false,
        title: "OAuth start failed",
        detail: "LiteLLM did not return a device code.",
      });
      return;
    }
    res.json({ ok: true, ...session });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/settings/litellm/oauth/chatgpt/status?sessionId=
 */
litellmGatewayRouter.get("/oauth/chatgpt/status", async (req, res, next) => {
  try {
    const sessionId = String(req.query?.sessionId || "").trim();
    if (!sessionId) {
      res.status(400).json({ ok: false, title: "Missing session", detail: "sessionId is required" });
      return;
    }
    const status = await getChatGptOAuthStatus(sessionId);
    if (status.status === "success") {
      const user = await User.findById(req.userId);
      if (user) {
        const litellmModel = String(req.query?.model || user.settings?.llmModel || "chatgpt/gpt-5.3-codex");
        const modelName = await ensureUserChatGptModel(user, litellmModel);
        user.settings.llmGatewayMode = "litellm";
        user.settings.llmAuthMode = "oauth";
        user.settings.llmOAuthProvider = "chatgpt";
        user.settings.llmModel = litellmModel;
        user.settings.litellmChatGptAccountLabel = status.credentialName || userCredentialLabel(user);
        user.markModified("settings");
        await user.save();
        res.json({
          ok: true,
          status: "success",
          modelName,
          account: user.settings.litellmChatGptAccountLabel,
        });
        return;
      }
    }
    res.json({ ok: true, ...status });
  } catch (err) {
    next(err);
  }
});

/**
 * @param {import("../models/User.js").User} user
 * @returns {string}
 */
function userCredentialLabel(user) {
  return user.settings?.litellmCredentialName || user.email || "ChatGPT";
}

/**
 * POST /api/settings/litellm/oauth/chatgpt/cancel
 * Body: { sessionId? }
 */
litellmGatewayRouter.post("/oauth/chatgpt/cancel", async (req, res, next) => {
  try {
    await cancelChatGptOAuth(String(req.body?.sessionId || ""));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/settings/litellm/oauth/chatgpt/disconnect — clear YamBot gateway ChatGPT state.
 */
litellmGatewayRouter.post("/oauth/chatgpt/disconnect", async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ ok: false, title: "Not found", detail: "User missing" });
      return;
    }
    await disconnectUserChatGpt(user);
    res.json({ ok: true, message: "ChatGPT disconnected from LiteLLM gateway" });
  } catch (err) {
    next(err);
  }
});
