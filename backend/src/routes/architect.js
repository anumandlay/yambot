/**
 * @fileoverview Business Architect API — staged chat, blueprint persist, approve & build.
 * Purpose: /architect planner separate from lighter /business setup.
 * Downstream: architectChat, BusinessBlueprint, applyBusinessPlan, BusinessArchitectPage.
 */

import { Router } from "express";
import { BusinessBlueprint } from "../models/BusinessBlueprint.js";
import {
  chatArchitect,
  normalizeArchitectBlueprint,
  publicArchitectBlueprint,
} from "../utils/architectChat.js";
import { applyBusinessPlan } from "../utils/applyBusinessPlan.js";
import { mergeAnswersIntoPlan } from "../utils/businessChat.js";

export const architectRouter = Router();

/**
 * POST /api/architect/chat
 * Body: { messages, profileId?, answers?, understandingConfirmed?, understandingRejected?, blueprintId? }
 */
architectRouter.post("/chat", async (req, res, next) => {
  try {
    const result = await chatArchitect(req.userId, {
      messages: req.body?.messages,
      profileId: req.body?.profileId,
      answers: req.body?.answers,
      understandingConfirmed: req.body?.understandingConfirmed,
      understandingRejected: req.body?.understandingRejected,
      blueprintId: req.body?.blueprintId,
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/architect/:id — load saved blueprint draft/built.
 */
architectRouter.get("/:id", async (req, res, next) => {
  try {
    const doc = await BusinessBlueprint.findOne({
      _id: req.params.id,
      user: req.userId,
    }).lean();
    if (!doc) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Blueprint missing" });
      return;
    }
    res.json({
      ok: true,
      blueprintDoc: {
        _id: String(doc._id),
        title: doc.title,
        status: doc.status,
        stage: doc.stage,
        understanding: doc.understanding,
        blueprint: doc.blueprint,
        createdAgentIds: (doc.createdAgentIds || []).map(String),
        createdTriggerIds: (doc.createdTriggerIds || []).map(String),
        builtAt: doc.builtAt,
        updatedAt: doc.updatedAt,
      },
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/architect/apply — Approve & Build from blueprint + answers.
 * Body: { blueprintId?, blueprint?, answers? }
 */
architectRouter.post("/apply", async (req, res, next) => {
  try {
    const answers = req.body?.answers || null;
    let blueprint = null;
    /** @type {import('mongoose').Document|null} */
    let doc = null;

    if (req.body?.blueprintId) {
      doc = await BusinessBlueprint.findOne({
        _id: req.body.blueprintId,
        user: req.userId,
      });
      if (!doc) {
        res.status(404).json({ ok: false, title: "Not found", detail: "Blueprint missing" });
        return;
      }
      blueprint = normalizeArchitectBlueprint(doc.blueprint || req.body?.blueprint, answers);
    } else {
      blueprint = normalizeArchitectBlueprint(req.body?.blueprint, answers);
    }

    if (!blueprint?.plan?.agents?.length) {
      res.status(400).json({
        ok: false,
        title: "Blueprint incomplete",
        detail: "Confirm understanding and wait for a ready architecture before building.",
      });
      return;
    }

    const plan = answers
      ? mergeAnswersIntoPlan(blueprint.plan, answers)
      : blueprint.plan;

    const result = await applyBusinessPlan(req.userId, plan, answers);
    if (!result.ok) {
      const status = /wallet|balance|insufficient/i.test(String(result.detail || ""))
        ? 402
        : 400;
      res.status(status).json(result);
      return;
    }

    const agentIds = (result.created?.agents || [])
      .map((a) => a._id)
      .filter(Boolean);
    const triggerIds = (result.created?.triggers || [])
      .map((t) => t._id)
      .filter(Boolean);

    if (doc) {
      doc.status = "built";
      doc.stage = "ready";
      doc.blueprint = publicArchitectBlueprint({ ...blueprint, plan });
      doc.createdAgentIds = agentIds;
      doc.createdTriggerIds = triggerIds;
      doc.builtAt = new Date();
      doc.understanding = {
        ...(doc.understanding?.toObject?.() || doc.understanding || {}),
        confirmed: true,
      };
      await doc.save();
    } else {
      doc = await BusinessBlueprint.create({
        user: req.userId,
        title: blueprint.summary?.slice(0, 120) || "Business architecture",
        status: "built",
        stage: "ready",
        blueprint: publicArchitectBlueprint({ ...blueprint, plan }),
        understanding: { objective: blueprint.summary || "", bullets: [], assumptions: [], confirmed: true },
        createdAgentIds: agentIds,
        createdTriggerIds: triggerIds,
        builtAt: new Date(),
      });
    }

    res.status(201).json({
      ...result,
      blueprintId: String(doc._id),
    });
  } catch (err) {
    next(err);
  }
});
