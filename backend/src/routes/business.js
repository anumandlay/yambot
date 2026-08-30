/**
 * @fileoverview Business setup API — plan from English brief, then apply after confirm.
 * Purpose: Multi-agent + schedule + trigger creation without manual form wiring.
 * Downstream: businessPlanFromBrief, applyBusinessPlan, BusinessSetupPage.
 */

import { Router } from "express";
import { planBusinessFromBrief, normalizeBusinessPlan } from "../utils/businessPlanFromBrief.js";
import { applyBusinessPlan } from "../utils/applyBusinessPlan.js";

export const businessRouter = Router();

/**
 * POST /api/business/plan — LLM plans agents/triggers/schedules/APIs (no creates).
 * Body: { brief: string }
 */
businessRouter.post("/plan", async (req, res, next) => {
  try {
    const result = await planBusinessFromBrief(
      req.userId,
      req.body?.brief || req.body?.text || ""
    );
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json({
      ok: true,
      brief: result.brief,
      plan: result.plan,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/business/apply — create agents + triggers from a confirmed plan.
 * Body: { plan: object } (same shape returned by /plan)
 */
businessRouter.post("/apply", async (req, res, next) => {
  try {
    const raw = req.body?.plan || req.body;
    const plan = normalizeBusinessPlan(raw || {});
    if (!plan.agents.length) {
      res.status(400).json({
        ok: false,
        title: "Plan required",
        detail: "Send the confirmed plan object from /api/business/plan.",
      });
      return;
    }
    const result = await applyBusinessPlan(req.userId, plan);
    if (!result.ok) {
      const status = /wallet|balance|insufficient/i.test(String(result.detail || ""))
        ? 402
        : 400;
      res.status(status).json(result);
      return;
    }
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
});
