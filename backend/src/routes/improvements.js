/**
 * @fileoverview Improvements API — autonomous improvement proposals.
 * Purpose: Review and approve workflow optimization suggestions.
 * Downstream: ImprovementProposal model, improvementLoop.
 */

import { Router } from "express";
import { ImprovementProposal, IMPROVEMENT_STATUSES } from "../models/ImprovementProposal.js";

export const improvementsRouter = Router();

improvementsRouter.get("/", async (req, res, next) => {
  try {
    const filter = { user: req.userId };
    if (req.query.status) filter.status = String(req.query.status);
    const proposals = await ImprovementProposal.find(filter).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ ok: true, proposals });
  } catch (err) {
    next(err);
  }
});

improvementsRouter.post("/:id/resolve", async (req, res, next) => {
  try {
    const proposal = await ImprovementProposal.findOne({ _id: req.params.id, user: req.userId });
    if (!proposal) {
      res.status(404).json({ ok: false, detail: "Proposal missing" });
      return;
    }
    const status = IMPROVEMENT_STATUSES.includes(req.body?.status) ? req.body.status : "approved";
    proposal.status = status;
    await proposal.save();
    res.json({ ok: true, proposal });
  } catch (err) {
    next(err);
  }
});
