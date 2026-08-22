/**
 * @fileoverview Processes API — workflow definitions, instances, bottleneck analysis.
 * Purpose: Process graphs and mining for workforce intelligence.
 * Downstream: ProcessDefinition, ProcessInstance models.
 */

import { Router } from "express";
import {
  ProcessDefinition,
  ProcessInstance,
  computeProcessBottlenecks,
} from "../models/Process.js";

export const processesRouter = Router();

processesRouter.get("/definitions", async (req, res, next) => {
  try {
    const definitions = await ProcessDefinition.find({ user: req.userId })
      .sort({ updatedAt: -1 })
      .lean();
    res.json({ ok: true, definitions });
  } catch (err) {
    next(err);
  }
});

processesRouter.post("/definitions", async (req, res, next) => {
  try {
    const body = req.body || {};
    const def = await ProcessDefinition.create({
      user: req.userId,
      name: String(body.name || "Process").trim(),
      description: body.description || "",
      stages: Array.isArray(body.stages) ? body.stages : [],
      transitions: Array.isArray(body.transitions) ? body.transitions : [],
    });
    res.status(201).json({ ok: true, definition: def });
  } catch (err) {
    next(err);
  }
});

processesRouter.get("/instances", async (req, res, next) => {
  try {
    const filter = { user: req.userId };
    if (req.query.definitionId) filter.definition = String(req.query.definitionId);
    const instances = await ProcessInstance.find(filter).sort({ updatedAt: -1 }).limit(100).lean();
    res.json({ ok: true, instances });
  } catch (err) {
    next(err);
  }
});

processesRouter.post("/instances", async (req, res, next) => {
  try {
    const body = req.body || {};
    const def = await ProcessDefinition.findOne({ _id: body.definitionId, user: req.userId });
    if (!def) {
      res.status(404).json({ ok: false, detail: "Definition missing" });
      return;
    }
    const firstStage = def.stages?.[0]?.id || "";
    const instance = await ProcessInstance.create({
      user: req.userId,
      definition: def._id,
      entity: body.entityId || null,
      currentStage: body.currentStage || firstStage,
      history: [{ stage: body.currentStage || firstStage, note: "Started" }],
    });
    res.status(201).json({ ok: true, instance });
  } catch (err) {
    next(err);
  }
});

processesRouter.get("/definitions/:id/bottlenecks", async (req, res, next) => {
  try {
    const bottlenecks = await computeProcessBottlenecks(req.userId, req.params.id);
    res.json({ ok: true, bottlenecks });
  } catch (err) {
    next(err);
  }
});
