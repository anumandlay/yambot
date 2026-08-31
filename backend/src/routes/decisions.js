/**
 * @fileoverview Decision journal API + authority policy fields.
 * Purpose: List/create decisions; expose authority level settings.
 * Downstream: DecisionsPage, PoliciesPage, Command Center.
 */

import { Router } from "express";
import { DecisionJournal, AUTHORITY_LEVELS, recordDecision } from "../models/DecisionJournal.js";
import { writeAudit } from "../utils/audit.js";

export const decisionsRouter = Router();

decisionsRouter.get("/meta", (_req, res) => {
  res.json({
    ok: true,
    authorityLevels: AUTHORITY_LEVELS,
    labels: {
      observe: "Level 0 — Observe only",
      internal: "Level 1 — Internal CRM/files",
      external: "Level 2 — External messages",
      financial: "Level 3 — Financial actions",
      critical: "Level 4 — Always need human approval",
    },
  });
});

decisionsRouter.get("/", async (req, res, next) => {
  try {
    const rows = await DecisionJournal.find({ user: req.userId })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    res.json({ ok: true, decisions: rows });
  } catch (err) {
    next(err);
  }
});

decisionsRouter.post("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    if (!String(body.decision || "").trim()) {
      res.status(400).json({ ok: false, detail: "decision required" });
      return;
    }
    const row = await recordDecision(req.userId, {
      ...body,
      actorType: body.actorType || "user",
    });
    await writeAudit({
      userId: req.userId,
      action: "decision.recorded",
      meta: { decisionId: String(row._id), decision: row.decision },
    }).catch(() => {});
    res.status(201).json({ ok: true, decision: row });
  } catch (err) {
    next(err);
  }
});
