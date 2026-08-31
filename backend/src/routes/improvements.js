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

/**
 * POST /api/improvements — create a manual improvement or A/B experiment proposal.
 */
improvementsRouter.post("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    const title = String(body.title || "").trim();
    if (!title) {
      res.status(400).json({ ok: false, detail: "title required" });
      return;
    }
    const proposal = await ImprovementProposal.create({
      user: req.userId,
      agent: body.agentId || null,
      goal: body.goalId || null,
      status: "proposed",
      title: title.slice(0, 200),
      currentState: String(body.currentState || "").slice(0, 2000),
      proposedState: String(body.proposedState || "").slice(0, 2000),
      expectedImpact: String(body.expectedImpact || "").slice(0, 1000),
      risk: String(body.risk || "medium").slice(0, 40),
      hypothesis: String(body.hypothesis || "").slice(0, 2000),
      variantA: String(body.variantA || "").slice(0, 2000),
      variantB: String(body.variantB || "").slice(0, 2000),
      trafficSplit: Math.max(0, Math.min(100, Number(body.trafficSplit) || 50)),
      evidence: body.evidence && typeof body.evidence === "object" ? body.evidence : {},
    });
    res.status(201).json({ ok: true, proposal });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/improvements/:id/start-experiment — mark testing and stamp start time.
 */
improvementsRouter.post("/:id/start-experiment", async (req, res, next) => {
  try {
    const proposal = await ImprovementProposal.findOne({ _id: req.params.id, user: req.userId });
    if (!proposal) {
      res.status(404).json({ ok: false, detail: "Proposal missing" });
      return;
    }
    proposal.status = "testing";
    proposal.experimentStartedAt = new Date();
    if (req.body?.trafficSplit != null) {
      proposal.trafficSplit = Math.max(0, Math.min(100, Number(req.body.trafficSplit) || 50));
    }
    await proposal.save();
    const { recordDecision } = await import("../models/DecisionJournal.js");
    await recordDecision(req.userId, {
      actorType: "user",
      authorityLevel: "internal",
      decision: `Started experiment: ${proposal.title}`,
      rationale: proposal.hypothesis || proposal.expectedImpact,
      context: { proposalId: String(proposal._id), trafficSplit: proposal.trafficSplit },
      outcome: "testing",
    }).catch(() => {});
    res.json({ ok: true, proposal });
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
