/**
 * @fileoverview Settings routes — LLM + DeathByCaptcha credentials for the agent.
 * Purpose: Let users configure provider keys on the website for cloud workers.
 * Downstream: User.settings (encrypted); `/api/worker/runtime-config` reads decrypted values.
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
    const savedKey = decryptSecret(s.llmApiKeyEnc || "");
    const savedDbcPass = decryptSecret(s.dbcPasswordEnc || "");
    res.json({
      ok: true,
      settings: {
        llmApiKeyMasked: mask(savedKey),
        hasLlmApiKey: Boolean(savedKey),
        llmBaseUrl: s.llmBaseUrl || env.DEFAULT_LLM_BASE_URL,
        llmModel: s.llmModel || env.DEFAULT_LLM_MODEL,
        visionApiKeyMasked: mask(decryptSecret(s.visionApiKeyEnc || "")),
        hasVisionApiKey: Boolean(decryptSecret(s.visionApiKeyEnc || "")),
        visionBaseUrl: s.visionBaseUrl || "",
        visionModel: s.visionModel || "",
        dbcUsername: s.dbcUsername || "",
        dbcPasswordMasked: mask(savedDbcPass),
        hasDbcPassword: Boolean(savedDbcPass),
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
    if (!user.settings) user.settings = {};

    if (typeof body.llmBaseUrl === "string") user.settings.llmBaseUrl = body.llmBaseUrl.trim();
    if (typeof body.llmModel === "string") user.settings.llmModel = body.llmModel.trim();
    if (typeof body.visionBaseUrl === "string") user.settings.visionBaseUrl = body.visionBaseUrl.trim();
    if (typeof body.visionModel === "string") user.settings.visionModel = body.visionModel.trim();
    if (typeof body.dbcUsername === "string") user.settings.dbcUsername = body.dbcUsername.trim();
    if (typeof body.confirmBeforeSubmit === "boolean") {
      user.settings.confirmBeforeSubmit = body.confirmBeforeSubmit;
    }
    // Why: blank string means "leave unchanged" so the UI can omit re-entry of secrets.
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

const DBC_BASES = ["https://api.dbcapi.me/api", "http://api.dbcapi.me/api"];

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
        // Why: DBC balance check is POST/GET to /api with username+password (or authtoken as password).
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
 * Extracts a human-readable error from an OpenAI-compatible JSON body.
 * @param {string} bodyText
 * @returns {string|null}
 */
function extractLlmApiMessage(bodyText) {
  try {
    const json = JSON.parse(bodyText);
    return json?.error?.message || json?.error?.code || json?.message || json?.error || null;
  } catch {
    return null;
  }
}

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
    const s = user.settings || {};
    const bodyKey = String(req.body?.llmApiKey ?? "").trim();
    const apiKey = bodyKey || decryptSecret(s.llmApiKeyEnc || "") || env.DEFAULT_LLM_API_KEY || "";
    const baseUrl = String(req.body?.llmBaseUrl ?? s.llmBaseUrl ?? env.DEFAULT_LLM_BASE_URL).trim();
    const model = String(req.body?.llmModel ?? s.llmModel ?? env.DEFAULT_LLM_MODEL).trim();

    if (!apiKey) {
      res.status(400).json({
        ok: false,
        title: "Missing API key",
        detail: "Enter an LLM API key (or save one first).",
        hint: "Key can be left blank in the form if a saved value already exists.",
      });
      return;
    }

    const root = baseUrl.replace(/\/$/, "");
    const url = `${root}/chat/completions`;

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          max_tokens: 16,
          messages: [{ role: "user", content: "Reply with exactly: ok" }],
        }),
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        title: "Connection failed",
        detail: String(err?.message || err || "Could not reach the LLM server"),
        hint: "Check the base URL and your network.",
      });
      return;
    }

    const text = await response.text();
    if (!response.ok) {
      const apiMsg = extractLlmApiMessage(text);
      const detail = apiMsg ? String(apiMsg) : text.slice(0, 500) || `HTTP ${response.status}`;
      let hint = "Verify API key, base URL, and model.";
      if (response.status === 401 || response.status === 403) hint = "Check your API key (and model access).";
      else if (response.status === 404) hint = "Check the base URL ends with /v1 and the model name.";
      else if (response.status === 429) hint = "Rate limited or out of quota.";
      res.status(502).json({
        ok: false,
        title: `LLM request failed (${response.status})`,
        detail,
        hint,
      });
      return;
    }

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      res.status(502).json({
        ok: false,
        title: "Invalid LLM response",
        detail: "Provider returned non-JSON.",
        hint: "Check base URL and model.",
      });
      return;
    }

    const rawContent =
      data.choices?.[0]?.message?.content ?? data.choices?.[0]?.message?.reasoning_content ?? "";
    const preview =
      typeof rawContent === "string"
        ? rawContent.trim().slice(0, 120)
        : String(rawContent || "").slice(0, 120);

    res.json({
      ok: true,
      message: "LLM connected",
      model: data.model || model,
      preview: preview || "(empty reply)",
    });
  } catch (err) {
    next(err);
  }
});
