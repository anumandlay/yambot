/**
 * @fileoverview Company memory API — operating memory / digital twin facts.
 * Purpose: Durable company knowledge injected into autonomous loops and agents.
 * Downstream: CompanyMemory model.
 */

import { Router } from "express";
import { CompanyMemory, MEMORY_CATEGORIES } from "../models/CompanyMemory.js";

export const companyMemoryRouter = Router();

companyMemoryRouter.get("/meta", (_req, res) => {
  res.json({ ok: true, categories: MEMORY_CATEGORIES });
});

companyMemoryRouter.get("/", async (req, res, next) => {
  try {
    const filter = { user: req.userId };
    if (req.query.category) filter.category = String(req.query.category);
    const memories = await CompanyMemory.find(filter).sort({ updatedAt: -1 }).limit(200).lean();
    res.json({ ok: true, memories });
  } catch (err) {
    next(err);
  }
});

companyMemoryRouter.post("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    const memory = await CompanyMemory.create({
      user: req.userId,
      category: MEMORY_CATEGORIES.includes(body.category) ? body.category : "custom",
      key: String(body.key || "").trim(),
      value: String(body.value || "").trim(),
      confidence: Number(body.confidence) || 1,
      source: body.source || "manual",
    });
    res.status(201).json({ ok: true, memory });
  } catch (err) {
    next(err);
  }
});

companyMemoryRouter.put("/:id", async (req, res, next) => {
  try {
    const memory = await CompanyMemory.findOne({ _id: req.params.id, user: req.userId });
    if (!memory) {
      res.status(404).json({ ok: false, detail: "Memory missing" });
      return;
    }
    if (req.body?.value != null) memory.value = String(req.body.value).trim();
    if (req.body?.confidence != null) memory.confidence = Number(req.body.confidence) || 1;
    await memory.save();
    res.json({ ok: true, memory });
  } catch (err) {
    next(err);
  }
});

companyMemoryRouter.delete("/:id", async (req, res, next) => {
  try {
    await CompanyMemory.deleteOne({ _id: req.params.id, user: req.userId });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
