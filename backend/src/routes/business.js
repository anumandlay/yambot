/**
 * @fileoverview Business setup API — interactive chat plan, then apply after confirm.
 * Purpose: Multi-agent + schedule + trigger creation from plain-English conversation.
 * Downstream: businessChat, businessPlanFromBrief, applyBusinessPlan, BusinessSetupPage.
 */

import { Router } from "express";
import { planBusinessFromBrief, normalizeBusinessPlan } from "../utils/businessPlanFromBrief.js";
import { applyBusinessPlan } from "../utils/applyBusinessPlan.js";
import { chatBusinessPlan, mergeAnswersIntoPlan } from "../utils/businessChat.js";

export const businessRouter = Router();

/**
 * Strip secrets from a plan before sending to the browser (passwords stay client-side in answers).
 * @param {object|null} plan
 * @returns {object|null}
 */
function publicPlan(plan) {
  if (!plan) return null;
  const p = normalizeBusinessPlan(plan);
  return {
    ...p,
    agents: p.agents.map((a) => ({
      ...a,
      email: a.email
        ? {
            ...a.email,
            smtpPassword: a.email.smtpPassword ? "(provided)" : "",
          }
        : null,
    })),
  };
}

/**
 * POST /api/business/chat — interactive planner turn.
 * Body: { messages: [{role,content}], profileId?, answers? }
 */
businessRouter.post("/chat", async (req, res, next) => {
  try {
    const result = await chatBusinessPlan(req.userId, {
      messages: req.body?.messages,
      profileId: req.body?.profileId,
      answers: req.body?.answers,
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json({
      ...result,
      plan: publicPlan(result.plan),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/business/plan — one-shot LLM plan (no creates). Kept for compatibility.
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
      plan: publicPlan(result.plan),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/business/apply — create agents + triggers from a confirmed plan.
 * Body: { plan: object, answers?: object }
 */
businessRouter.post("/apply", async (req, res, next) => {
  try {
    const raw = req.body?.plan || req.body;
    const answers = req.body?.answers || null;
    const plan = answers ? mergeAnswersIntoPlan(raw || {}, answers) : normalizeBusinessPlan(raw || {});
    if (!plan.agents.length) {
      res.status(400).json({
        ok: false,
        title: "Plan required",
        detail: "Finish the planning chat until a plan is ready, then confirm.",
      });
      return;
    }
    const result = await applyBusinessPlan(req.userId, plan, answers);
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
