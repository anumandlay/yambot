/**
 * @fileoverview Policies API — user-level governance defaults (Layer 2).
 * Purpose: Configure approval gates, URL blocks, budgets, and HTTP tool allowlists.
 * Downstream: User.settings; merged with per-agent policy in runtime-config.
 */

import { Router } from "express";
import { User } from "../models/User.js";
import { getEffectivePolicy } from "../utils/policy.js";
import { writeAudit } from "../utils/audit.js";

export const policiesRouter = Router();

/**
 * GET /api/policies — effective defaults for the signed-in user.
 */
policiesRouter.get("/", async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ ok: false, detail: "User missing" });
      return;
    }
    const s = user.settings || {};
    res.json({
      ok: true,
      policy: {
        requireApprovalForSubmit: s.requireApprovalForSubmit === true,
        blockedUrlPatterns: s.blockedUrlPatterns || [],
        monthlyBudgetUsd: Number(s.monthlyBudgetUsd) || 0,
        dailyBudgetUsd: Number(s.dailyBudgetUsd) || 0,
        maxTaskMinutes: Number(s.maxTaskMinutes) || 0,
        escalateWaitingMinutes: Number(s.escalateWaitingMinutes) || 30,
        httpAllowHosts: s.httpAllowHosts || [],
        confirmBeforeSubmit: s.confirmBeforeSubmit === true,
        maxAuthorityLevel: s.maxAuthorityLevel || "external",
        learningMode: s.learningMode === true,
      },
      effective: getEffectivePolicy(s),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/policies — update user policy defaults.
 */
policiesRouter.put("/", async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      res.status(404).json({ ok: false, detail: "User missing" });
      return;
    }
    const body = req.body || {};
    if (!user.settings) user.settings = {};
    if (typeof body.requireApprovalForSubmit === "boolean") {
      user.settings.requireApprovalForSubmit = body.requireApprovalForSubmit;
    }
    if (typeof body.confirmBeforeSubmit === "boolean") {
      user.settings.confirmBeforeSubmit = body.confirmBeforeSubmit;
    }
    if (typeof body.learningMode === "boolean") {
      user.settings.learningMode = body.learningMode;
    }
    if (body.maxAuthorityLevel != null) {
      const lvl = String(body.maxAuthorityLevel).trim();
      if (["observe", "internal", "external", "financial", "critical"].includes(lvl)) {
        user.settings.maxAuthorityLevel = lvl;
      }
    }
    if (body.monthlyBudgetUsd != null) {
      user.settings.monthlyBudgetUsd = Math.max(0, Number(body.monthlyBudgetUsd) || 0);
    }
    if (body.dailyBudgetUsd != null) {
      user.settings.dailyBudgetUsd = Math.max(0, Number(body.dailyBudgetUsd) || 0);
    }
    if (body.maxTaskMinutes != null) {
      user.settings.maxTaskMinutes = Math.max(0, Number(body.maxTaskMinutes) || 0);
    }
    if (body.escalateWaitingMinutes != null) {
      user.settings.escalateWaitingMinutes = Math.max(5, Number(body.escalateWaitingMinutes) || 30);
    }
    if (Array.isArray(body.blockedUrlPatterns)) {
      user.settings.blockedUrlPatterns = body.blockedUrlPatterns
        .map((p) => String(p).trim())
        .filter(Boolean)
        .slice(0, 50);
    }
    if (Array.isArray(body.httpAllowHosts)) {
      user.settings.httpAllowHosts = body.httpAllowHosts
        .map((h) => String(h).trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 100);
    }
    user.markModified("settings");
    await user.save();
    await writeAudit({
      userId: req.userId,
      action: "policy.updated",
      detail: "User policy defaults saved",
    });
    res.json({ ok: true, message: "Policy saved" });
  } catch (err) {
    next(err);
  }
});
