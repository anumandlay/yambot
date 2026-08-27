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

processesRouter.put("/definitions/:id", async (req, res, next) => {
  try {
    const def = await ProcessDefinition.findOne({ _id: req.params.id, user: req.userId });
    if (!def) {
      res.status(404).json({ ok: false, detail: "Definition missing" });
      return;
    }
    const body = req.body || {};
    if (body.name != null) def.name = String(body.name).trim();
    if (body.description != null) def.description = String(body.description);
    if (Array.isArray(body.stages)) def.stages = body.stages;
    if (Array.isArray(body.transitions)) def.transitions = body.transitions;
    if (body.active != null) def.active = Boolean(body.active);
    await def.save();
    res.json({ ok: true, definition: def });
  } catch (err) {
    next(err);
  }
});

processesRouter.get("/instances", async (req, res, next) => {
  try {
    const filter = { user: req.userId };
    if (req.query.definitionId) filter.definition = String(req.query.definitionId);
    if (req.query.status) filter.status = String(req.query.status);
    const instances = await ProcessInstance.find(filter)
      .sort({ updatedAt: -1 })
      .limit(200)
      .populate("definition", "name stages")
      .populate("entity", "name type")
      .lean();
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
