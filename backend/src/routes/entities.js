/**
 * @fileoverview Entities API — company world model with temporal memory.
 * Purpose: CRUD customers/leads/vendors and append observations over time.
 * Downstream: Entity model, investigation, goal autonomy.
 */

import { Router } from "express";
import { Entity, ENTITY_TYPES, appendEntityObservation } from "../models/Entity.js";
import { importLeadsFromCsv, CSV_IMPORT_MAX_ROWS } from "../utils/csvLeadsImport.js";

export const entitiesRouter = Router();

entitiesRouter.get("/meta", (_req, res) => {
  res.json({ ok: true, types: ENTITY_TYPES });
});

entitiesRouter.get("/", async (req, res, next) => {
  try {
    const filter = { user: req.userId };
    if (req.query.type) filter.type = String(req.query.type);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const [entities, total] = await Promise.all([
      Entity.find(filter).sort({ updatedAt: -1 }).limit(limit).lean(),
      Entity.countDocuments(filter),
    ]);
    res.json({ ok: true, entities, total, limit });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/entities/stats — counts by type for import/campaign UI.
 */
entitiesRouter.get("/stats", async (req, res, next) => {
  try {
    const filter = { user: req.userId };
    if (req.query.type) filter.type = String(req.query.type);
    const total = await Entity.countDocuments(filter);
    const withEmail = await Entity.countDocuments({
      ...filter,
      $or: [{ "attributes.email": { $exists: true, $ne: "" } }, { externalId: { $regex: /@/ } }],
    });
    res.json({ ok: true, total, withEmail });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/entities/import — bulk CSV lead import (name, email, …).
 * Body: { csv: string, entityType?: string, updateExisting?: boolean }
 */
entitiesRouter.post("/import", async (req, res, next) => {
  try {
    const csv = String(req.body?.csv || req.body?.text || "").trim();
    if (!csv) {
      res.status(400).json({ ok: false, detail: "csv text required" });
      return;
    }
    const entityType = ENTITY_TYPES.includes(req.body?.entityType) ? req.body.entityType : "lead";
    const result = await importLeadsFromCsv(req.userId, csv, {
      entityType,
      updateExisting: req.body?.updateExisting !== false,
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

entitiesRouter.get("/import/meta", (_req, res) => {
  res.json({
    ok: true,
    maxRows: CSV_IMPORT_MAX_ROWS,
    columns: ["email", "name", "company", "phone", "first_name", "last_name"],
    example: "email,name,company\njane@example.com,Jane Doe,Acme Inc",
  });
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

entitiesRouter.put("/:id", async (req, res, next) => {
  try {
    const entity = await Entity.findOne({ _id: req.params.id, user: req.userId });
    if (!entity) {
      res.status(404).json({ ok: false, detail: "Entity missing" });
      return;
    }
    const body = req.body || {};
    if (body.name != null) entity.name = String(body.name).trim();
    if (body.type != null && ENTITY_TYPES.includes(body.type)) entity.type = body.type;
    if (body.status != null) entity.status = String(body.status).trim();
    if (body.externalId != null) entity.externalId = String(body.externalId).trim();
    if (body.attributes != null && typeof body.attributes === "object") {
      entity.attributes = body.attributes;
      entity.markModified("attributes");
    }
    if (body.relatedAgents != null && Array.isArray(body.relatedAgents)) {
      entity.relatedAgents = body.relatedAgents.map(String).filter(Boolean).slice(0, 20);
    }
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
