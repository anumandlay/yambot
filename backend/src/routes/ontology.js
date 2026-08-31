/**
 * @fileoverview Ontology API — shared business entity vocabulary.
 * Purpose: Expose types/relationships for UI + LLM prompts.
 * Downstream: Command Center, Architect, Entity links.
 */

import { Router } from "express";
import { Entity } from "../models/Entity.js";
import { getOntologyDescriptor, ONTOLOGY_RELS } from "../utils/ontology.js";

export const ontologyRouter = Router();

ontologyRouter.get("/", (_req, res) => {
  res.json({ ok: true, ontology: getOntologyDescriptor() });
});

/**
 * POST /api/ontology/links — link two entities.
 * Body: { fromId, toId, rel }
 */
ontologyRouter.post("/links", async (req, res, next) => {
  try {
    const fromId = String(req.body?.fromId || "").trim();
    const toId = String(req.body?.toId || "").trim();
    const rel = String(req.body?.rel || "related_to").trim();
    if (!fromId || !toId) {
      res.status(400).json({ ok: false, detail: "fromId and toId required" });
      return;
    }
    if (!ONTOLOGY_RELS.includes(rel)) {
      res.status(400).json({ ok: false, detail: `rel must be one of ${ONTOLOGY_RELS.join(", ")}` });
      return;
    }
    const from = await Entity.findOne({ _id: fromId, user: req.userId });
    const to = await Entity.findOne({ _id: toId, user: req.userId });
    if (!from || !to) {
      res.status(404).json({ ok: false, detail: "Entity missing" });
      return;
    }
    from.links = from.links || [];
    if (!from.links.some((l) => String(l.entityId) === toId && l.rel === rel)) {
      from.links.push({ rel, entityId: to._id });
      await from.save();
    }
    res.json({ ok: true, entity: from });
  } catch (err) {
    next(err);
  }
});
