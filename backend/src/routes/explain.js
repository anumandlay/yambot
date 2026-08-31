/**
 * @fileoverview Explainability API — Learning Mode chains for tasks/runs/correlations.
 * Purpose: Surface trigger → policy → employee → action → result for trust & debugging.
 * Downstream: Command Center, Agent Runs “Ask why”.
 */

import { Router } from "express";
import { explainBusinessAction, generateSopFromAgent } from "../utils/explainability.js";

export const explainRouter = Router();

/**
 * GET /api/explain?taskId=&runId=&correlationId=
 */
explainRouter.get("/", async (req, res, next) => {
  try {
    const result = await explainBusinessAction(req.userId, {
      taskId: req.query.taskId,
      runId: req.query.runId,
      correlationId: req.query.correlationId,
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

/**
 * POST /api/explain/sop — generate SOP markdown from an employee.
 */
explainRouter.post("/sop", async (req, res, next) => {
  try {
    const agentId = String(req.body?.agentId || "").trim();
    if (!agentId) {
      res.status(400).json({ ok: false, detail: "agentId required" });
      return;
    }
    const result = await generateSopFromAgent(req.userId, agentId);
    if (!result.ok) {
      res.status(404).json(result);
      return;
    }
    res.json(result);
  } catch (err) {
    next(err);
  }
});
