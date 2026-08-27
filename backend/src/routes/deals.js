/**
 * @fileoverview Deals API — sales pipeline CRUD.
 * Purpose: Deal stages and amounts beyond lead entities.
 * Downstream: DealsPage, worker search_deals.
 */

import { Router } from "express";
import { Deal, DEAL_STAGES } from "../models/Deal.js";

export const dealsRouter = Router();

dealsRouter.get("/", async (req, res, next) => {
  try {
    const filter = { user: req.userId };
    if (req.query.stage) filter.stage = String(req.query.stage);
    const deals = await Deal.find(filter)
      .sort({ updatedAt: -1 })
      .limit(200)
      .populate("entity", "name attributes")
      .populate("assigneeAgent", "name")
      .lean();
    res.json({ ok: true, deals });
  } catch (err) {
    next(err);
  }
});

dealsRouter.post("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = String(body.name || "").trim();
    if (!name) {
      res.status(400).json({ ok: false, detail: "name required" });
      return;
    }
    const deal = await Deal.create({
      user: req.userId,
      name,
      stage: DEAL_STAGES.includes(body.stage) ? body.stage : "prospect",
      amount: Number(body.amount) || 0,
      currency: body.currency || "USD",
      entity: body.entityId || null,
      assigneeAgent: body.assigneeAgentId || null,
      notes: body.notes || "",
    });
    res.status(201).json({ ok: true, deal });
  } catch (err) {
    next(err);
  }
});

dealsRouter.put("/:id", async (req, res, next) => {
  try {
    const deal = await Deal.findOne({ _id: req.params.id, user: req.userId });
    if (!deal) {
      res.status(404).json({ ok: false, detail: "Deal missing" });
      return;
    }
    const body = req.body || {};
    if (body.name != null) deal.name = String(body.name).trim();
    if (body.stage && DEAL_STAGES.includes(body.stage)) deal.stage = body.stage;
    if (body.amount != null) deal.amount = Number(body.amount) || 0;
    if (body.notes != null) deal.notes = String(body.notes);
    await deal.save();
    res.json({ ok: true, deal });
  } catch (err) {
    next(err);
  }
});
