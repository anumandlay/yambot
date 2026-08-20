/**
 * @fileoverview Settings routes — LLM + DeathByCaptcha credentials for the agent.
 * Purpose: Let users configure provider keys on the website instead of only in the extension.
 * Downstream: User.settings (encrypted); extension `/runtime-config` reads decrypted values.
 */

import { Router } from "express";
import { User } from "../models/User.js";
import { encryptSecret, decryptSecret } from "../utils/crypto.js";
import { env } from "../utils/env.js";

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
 * GET /api/settings — public fields + masked secrets.
 */
settingsRouter.get("/", async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ ok: false, title: "Not found", detail: "User missing" });
      return;
    }
    const s = user.settings || {};
    const apiKey = decryptSecret(s.llmApiKeyEnc || "") || env.DEFAULT_LLM_API_KEY || "";
    const dbcPass = decryptSecret(s.dbcPasswordEnc || "");
    res.json({
      ok: true,
      settings: {
        llmApiKeyMasked: mask(apiKey),
        hasLlmApiKey: Boolean(apiKey),
        llmBaseUrl: s.llmBaseUrl || env.DEFAULT_LLM_BASE_URL,
        llmModel: s.llmModel || env.DEFAULT_LLM_MODEL,
        dbcUsername: s.dbcUsername || "",
        dbcPasswordMasked: mask(dbcPass),
        hasDbcPassword: Boolean(dbcPass),
        confirmBeforeSubmit: s.confirmBeforeSubmit === true,
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
    const nextSettings = { ...(user.settings?.toObject?.() || user.settings || {}) };

    if (typeof body.llmBaseUrl === "string") nextSettings.llmBaseUrl = body.llmBaseUrl.trim();
    if (typeof body.llmModel === "string") nextSettings.llmModel = body.llmModel.trim();
    if (typeof body.dbcUsername === "string") nextSettings.dbcUsername = body.dbcUsername.trim();
    if (typeof body.confirmBeforeSubmit === "boolean") {
      nextSettings.confirmBeforeSubmit = body.confirmBeforeSubmit;
    }
    // Why: blank string means "leave unchanged" so the UI can omit re-entry of secrets.
    if (typeof body.llmApiKey === "string" && body.llmApiKey.trim()) {
      nextSettings.llmApiKeyEnc = encryptSecret(body.llmApiKey.trim());
    }
    if (typeof body.dbcPassword === "string" && body.dbcPassword.trim()) {
      nextSettings.dbcPasswordEnc = encryptSecret(body.dbcPassword.trim());
    }

    user.settings = nextSettings;
    await user.save();
    res.json({ ok: true, message: "Settings saved" });
  } catch (err) {
    next(err);
  }
});
