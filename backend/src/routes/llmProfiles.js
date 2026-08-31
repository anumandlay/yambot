/**
 * @fileoverview CRUD + test for named LLM profiles.
 * Purpose: Let users save reusable LLM credentials and verify them before assigning to agents.
 * Downstream: Agent.llm.profile; Settings → LLM profiles page.
 */

import { Router } from "express";
import { LlmProfile, publicLlmProfile } from "../models/LlmProfile.js";
import { Agent } from "../models/Agent.js";
import { encryptSecret, decryptSecret } from "../utils/crypto.js";
import { env } from "../utils/env.js";
import { normalizeLlmBaseUrl, normalizeLlmModel } from "../utils/llmDefaults.js";
import { probeLlmConnection } from "../utils/llmTest.js";

export const llmProfilesRouter = Router();

/**
 * @param {object} body
 * @param {{ partial?: boolean, existing?: object }} [opts]
 * @returns {{ error?: object, fields?: object }}
 */
function pickProfileFields(body, opts = {}) {
  const existing = opts.existing || {};
  const name = body.name != null ? String(body.name || "").trim().slice(0, 120) : existing.name;
  if (!opts.partial || body.name != null) {
    if (!name) {
      return {
        error: {
          ok: false,
          title: "Name required",
          detail: "Give this LLM a short name (shown in the agent dropdown).",
        },
      };
    }
  }

  /** @type {object} */
  const fields = {};
  if (name != null) fields.name = name;
  if (body.baseUrl != null || !opts.partial) {
    const raw = String(body.baseUrl ?? existing.baseUrl ?? "").trim().slice(0, 500);
    fields.baseUrl = raw ? normalizeLlmBaseUrl(raw, raw) : "";
  }
  if (body.model != null || !opts.partial) {
    fields.model = String(body.model ?? existing.model ?? "")
      .trim()
      .slice(0, 200);
  }
  if (body.tier != null || !opts.partial) {
    const t = String(body.tier ?? existing.tier ?? "standard").trim();
    fields.tier = ["cheap", "standard", "premium"].includes(t) ? t : "standard";
  }
  if (body.costPer1kUsd != null) {
    fields.costPer1kUsd = Math.max(0, Number(body.costPer1kUsd) || 0);
  }

  const key = String(body.apiKey ?? "").replace(/\s+/g, "").trim();
  if (key) {
    fields.apiKeyEnc = encryptSecret(key);
  } else if (body.clearApiKey) {
    fields.apiKeyEnc = "";
  } else if (!opts.partial) {
    fields.apiKeyEnc = existing.apiKeyEnc || "";
  }

  return { fields };
}

/**
 * GET /api/llm-profiles
 */
llmProfilesRouter.get("/", async (req, res, next) => {
  try {
    const profiles = await LlmProfile.find({ user: req.userId }).sort({ name: 1 }).lean();
    res.json({ ok: true, profiles: profiles.map(publicLlmProfile) });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/llm-profiles
 */
llmProfilesRouter.post("/", async (req, res, next) => {
  try {
    const picked = pickProfileFields(req.body || {}, { partial: false });
    if (picked.error) {
      res.status(400).json(picked.error);
      return;
    }
    if (!picked.fields.apiKeyEnc) {
      res.status(400).json({
        ok: false,
        title: "API key required",
        detail: "Enter an API key for this LLM profile.",
      });
      return;
    }
    const profile = await LlmProfile.create({
      ...picked.fields,
      user: req.userId,
    });
    res.status(201).json({ ok: true, profile: publicLlmProfile(profile) });
  } catch (err) {
    if (err?.code === 11000) {
      res.status(409).json({
        ok: false,
        title: "Name taken",
        detail: "You already have an LLM profile with that name.",
      });
      return;
    }
    next(err);
  }
});

/**
 * PUT /api/llm-profiles/:id
 */
llmProfilesRouter.put("/:id", async (req, res, next) => {
  try {
    const profile = await LlmProfile.findOne({ _id: req.params.id, user: req.userId });
    if (!profile) {
      res.status(404).json({ ok: false, title: "Not found", detail: "LLM profile missing" });
      return;
    }
    const picked = pickProfileFields(req.body || {}, {
      partial: true,
      existing: profile.toObject(),
    });
    if (picked.error) {
      res.status(400).json(picked.error);
      return;
    }
    // Why: blank apiKey in the form means keep the existing encrypted secret.
    if (picked.fields.apiKeyEnc === undefined) {
      delete picked.fields.apiKeyEnc;
    }
    Object.assign(profile, picked.fields);
    await profile.save();
    res.json({ ok: true, profile: publicLlmProfile(profile) });
  } catch (err) {
    if (err?.code === 11000) {
      res.status(409).json({
        ok: false,
        title: "Name taken",
        detail: "You already have an LLM profile with that name.",
      });
      return;
    }
    next(err);
  }
});

/**
 * DELETE /api/llm-profiles/:id — clears agent references to this profile.
 */
llmProfilesRouter.delete("/:id", async (req, res, next) => {
  try {
    const profile = await LlmProfile.findOneAndDelete({
      _id: req.params.id,
      user: req.userId,
    });
    if (!profile) {
      res.status(404).json({ ok: false, title: "Not found", detail: "LLM profile missing" });
      return;
    }
    // Why: agents pointing here fall back to Settings after delete.
    await Agent.updateMany(
      { user: req.userId, "llm.profile": profile._id },
      {
        $set: {
          "llm.useCustom": false,
          "llm.profile": null,
        },
      }
    );
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/llm-profiles/test — probe credentials without requiring a saved profile.
 * Body: { apiKey?, baseUrl?, model?, profileId? }
 */
llmProfilesRouter.post("/test", async (req, res, next) => {
  try {
    const bodyKey = String(req.body?.apiKey ?? "").replace(/\s+/g, "").trim();
    let apiKey = bodyKey;
    let baseUrl = String(req.body?.baseUrl ?? "").trim();
    let model = String(req.body?.model ?? "").trim();

    const profileId = String(req.body?.profileId || "").trim();
    if (profileId) {
      const profile = await LlmProfile.findOne({ _id: profileId, user: req.userId });
      if (!profile) {
        res.status(404).json({ ok: false, title: "Not found", detail: "LLM profile missing" });
        return;
      }
      if (!apiKey) apiKey = decryptSecret(profile.apiKeyEnc || "");
      if (!baseUrl) baseUrl = profile.baseUrl || "";
      if (!model) model = profile.model || "";
    }

    baseUrl = normalizeLlmBaseUrl(baseUrl, env.DEFAULT_LLM_BASE_URL);
    model = normalizeLlmModel(model, env.DEFAULT_LLM_MODEL);

    if (!apiKey) {
      res.status(400).json({
        ok: false,
        title: "Missing API key",
        detail: "Enter an API key (or save one on the profile first).",
      });
      return;
    }

    try {
      const result = await probeLlmConnection({ apiKey, baseUrl, model });
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
 * POST /api/llm-profiles/:id/test — probe a saved profile (optional body overrides).
 */
llmProfilesRouter.post("/:id/test", async (req, res, next) => {
  try {
    const profile = await LlmProfile.findOne({ _id: req.params.id, user: req.userId });
    if (!profile) {
      res.status(404).json({ ok: false, title: "Not found", detail: "LLM profile missing" });
      return;
    }
    const bodyKey = String(req.body?.apiKey ?? "").trim();
    const apiKey = bodyKey || decryptSecret(profile.apiKeyEnc || "");
    const baseUrl = normalizeLlmBaseUrl(
      String(req.body?.baseUrl ?? profile.baseUrl ?? "").trim(),
      env.DEFAULT_LLM_BASE_URL
    );
    const model = normalizeLlmModel(
      String(req.body?.model ?? profile.model ?? "").trim(),
      env.DEFAULT_LLM_MODEL
    );

    if (!apiKey) {
      res.status(400).json({
        ok: false,
        title: "Missing API key",
        detail: "This profile has no API key. Enter one and save, then test.",
      });
      return;
    }

    try {
      const result = await probeLlmConnection({ apiKey, baseUrl, model });
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
