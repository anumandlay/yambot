/**
 * @fileoverview Triggers API — automation rules CRUD.
 * Purpose: Configure time/event/condition/threshold/change/anomaly triggers.
 * Downstream: Trigger model, triggerEngine.
 */

import { Router } from "express";
import { Trigger, TRIGGER_TYPES, TRIGGER_ACTIONS, normalizeTriggerEventType } from "../models/Trigger.js";

export const triggersRouter = Router();

triggersRouter.get("/meta", (_req, res) => {
  res.json({ ok: true, types: TRIGGER_TYPES, actions: TRIGGER_ACTIONS });
});

triggersRouter.get("/", async (req, res, next) => {
  try {
    const triggers = await Trigger.find({ user: req.userId }).sort({ updatedAt: -1 }).lean();
    res.json({ ok: true, triggers });
  } catch (err) {
    next(err);
  }
});

triggersRouter.post("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    const trigger = await Trigger.create({
      user: req.userId,
      name: String(body.name || "Trigger").trim(),
      enabled: body.enabled !== false,
      type: TRIGGER_TYPES.includes(body.type) ? body.type : "event",
      agent: body.agentId || body.agent || null,
      goal: body.goalId || body.goal || null,
      config: body.config || {},
      action: TRIGGER_ACTIONS.includes(body.action) ? body.action : "enqueue_task",
      actionConfig: body.actionConfig || {},
      completionEventType: normalizeTriggerEventType(body.completionEventType),
      completionEventOnFailure: normalizeTriggerEventType(body.completionEventOnFailure),
    });
    res.status(201).json({ ok: true, trigger });
  } catch (err) {
    next(err);
  }
});

triggersRouter.put("/:id", async (req, res, next) => {
  try {
    const trigger = await Trigger.findOne({ _id: req.params.id, user: req.userId });
    if (!trigger) {
      res.status(404).json({ ok: false, detail: "Trigger missing" });
      return;
    }
    const body = req.body || {};
    if (body.name != null) trigger.name = String(body.name).trim();
    if (body.enabled != null) trigger.enabled = Boolean(body.enabled);
    if (body.config != null) trigger.config = body.config;
    if (body.actionConfig != null) trigger.actionConfig = body.actionConfig;
    if (body.completionEventType != null) {
      trigger.completionEventType = normalizeTriggerEventType(body.completionEventType);
    }
    if (body.completionEventOnFailure != null) {
      trigger.completionEventOnFailure = normalizeTriggerEventType(body.completionEventOnFailure);
    }
    if (body.agentId != null || body.agent != null) {
      trigger.agent = body.agentId || body.agent || null;
    }
    if (body.action != null && TRIGGER_ACTIONS.includes(body.action)) {
      trigger.action = body.action;
    }
    await trigger.save();
    res.json({ ok: true, trigger });
  } catch (err) {
    next(err);
  }
});

triggersRouter.delete("/:id", async (req, res, next) => {
  try {
    await Trigger.deleteOne({ _id: req.params.id, user: req.userId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
