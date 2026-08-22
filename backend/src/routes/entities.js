/**
 * @fileoverview Entities API — company world model with temporal memory.
 * Purpose: CRUD customers/leads/vendors and append observations over time.
 * Downstream: Entity model, investigation, goal autonomy.
 */

import { Router } from "express";
import { Entity, ENTITY_TYPES, appendEntityObservation } from "../models/Entity.js";

export const entitiesRouter = Router();

entitiesRouter.get("/meta", (_req, res) => {
  res.json({ ok: true, types: ENTITY_TYPES });
});

entitiesRouter.get("/", async (req, res, next) => {
  try {
    const filter = { user: req.userId };
    if (req.query.type) filter.type = String(req.query.type);
    const entities = await Entity.find(filter).sort({ updatedAt: -1 }).limit(100).lean();
    res.json({ ok: true, entities });
  } catch (err) {
    next(err);
  }
});

entitiesRouter.post("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    const entity = await Entity.create({
      user: req.userId,
      type: ENTITY_TYPES.includes(body.type) ? body.type : "custom",
      name: String(body.name || "").trim(),
      externalId: String(body.externalId || "").trim(),
      status: body.status || "active",
      attributes: body.attributes || {},
    });
    res.status(201).json({ ok: true, entity });
  } catch (err) {
    next(err);
  }
});

entitiesRouter.post("/:id/observations", async (req, res, next) => {
  try {
    const entity = await Entity.findOne({ _id: req.params.id, user: req.userId });
    if (!entity) {
      res.status(404).json({ ok: false, detail: "Entity missing" });
      return;
    }
    appendEntityObservation(entity, {
      source: req.body?.source || "api",
      kind: req.body?.kind || "note",
      content: req.body?.content || "",
      confidence: req.body?.confidence,
      meta: req.body?.meta || {},
    });
    await entity.save();
    res.json({ ok: true, entity });
  } catch (err) {
    next(err);
  }
});

entitiesRouter.get("/:id", async (req, res, next) => {
  try {
    const entity = await Entity.findOne({ _id: req.params.id, user: req.userId }).lean();
    if (!entity) {
      res.status(404).json({ ok: false, detail: "Entity missing" });
      return;
    }
    res.json({ ok: true, entity });
  } catch (err) {
    next(err);
  }
});
