/**
 * @fileoverview Governance API — audit trail and LLM usage (Layer 5).
 * Purpose: Expose audit events and aggregated token/cost stats for the dashboard.
 * Downstream: AuditEvent model, Task.llmUsage from worker completes.
 */

import { Router } from "express";
import { AuditEvent } from "../models/AuditEvent.js";
import { Task } from "../models/Task.js";
import { User } from "../models/User.js";

export const governanceRouter = Router();

/**
 * GET /api/governance/audit — recent audit events.
 * Query: limit?, agentId?, goalId?, action?
 */
governanceRouter.get("/audit", async (req, res, next) => {
  try {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const filter = { user: req.userId };
    if (req.query.agentId) filter.agent = String(req.query.agentId);
    if (req.query.goalId) filter.goal = String(req.query.goalId);
    if (req.query.action) filter.action = String(req.query.action);

    const events = await AuditEvent.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json({ ok: true, events });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/governance/performance — employee performance reviews.
 */
governanceRouter.get("/performance", async (req, res, next) => {
  try {
    const { PerformanceReview } = await import("../models/PerformanceReview.js");
    const filter = { user: req.userId };
    if (req.query.agentId) filter.agent = String(req.query.agentId);
    const reviews = await PerformanceReview.find(filter)
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    res.json({ ok: true, reviews });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/governance/performance/:agentId — generate a fresh review.
 */
governanceRouter.post("/performance/:agentId", async (req, res, next) => {
  try {
    const { generatePerformanceReview } = await import("../utils/performanceReview.js");
    const days = Math.min(90, Number(req.body?.days) || 30);
    const review = await generatePerformanceReview(req.userId, req.params.agentId, days);
    res.status(201).json({ ok: true, review });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/governance/usage — LLM usage rollup from completed tasks.
 * Query: days? (default 30), agentId?
 */
governanceRouter.get("/usage", async (req, res, next) => {
  try {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const match = {
      user: req.userId,
      completedAt: { $gte: since },
      status: { $in: ["done", "error"] },
    };
    if (req.query.agentId) match.agent = String(req.query.agentId);

    const [rollup] = await Task.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          tasks: { $sum: 1 },
          promptTokens: { $sum: "$llmUsage.promptTokens" },
          completionTokens: { $sum: "$llmUsage.completionTokens" },
          totalTokens: { $sum: "$llmUsage.totalTokens" },
          llmCalls: { $sum: "$llmUsage.calls" },
          estimatedUsd: { $sum: "$llmUsage.estimatedUsd" },
        },
      },
    ]);

    const byAgent = await Task.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$agent",
          tasks: { $sum: 1 },
          totalTokens: { $sum: "$llmUsage.totalTokens" },
          estimatedUsd: { $sum: "$llmUsage.estimatedUsd" },
        },
      },
      { $sort: { totalTokens: -1 } },
      { $limit: 20 },
    ]);

    res.json({
      ok: true,
      days,
      since,
      summary: {
        tasks: rollup?.tasks || 0,
        promptTokens: rollup?.promptTokens || 0,
        completionTokens: rollup?.completionTokens || 0,
        totalTokens: rollup?.totalTokens || 0,
        llmCalls: rollup?.llmCalls || 0,
        estimatedUsd: Number((rollup?.estimatedUsd || 0).toFixed(4)),
      },
      byAgent: byAgent.map((row) => ({
        agentId: row._id ? String(row._id) : null,
        tasks: row.tasks,
        totalTokens: row.totalTokens || 0,
        estimatedUsd: Number((row.estimatedUsd || 0).toFixed(4)),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/governance/budget — monthly spend vs configured cap.
 */
governanceRouter.get("/budget", async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).select("settings").lean();
    const budgetUsd = Number(user?.settings?.monthlyBudgetUsd) || 0;
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const match = {
      user: req.userId,
      completedAt: { $gte: monthStart },
      status: { $in: ["done", "error"] },
    };
    if (req.query.agentId) match.agent = String(req.query.agentId);
    const [row] = await Task.aggregate([
      { $match: match },
      { $group: { _id: null, usd: { $sum: "$llmUsage.estimatedUsd" } } },
    ]);
    const spentUsd = Number(row?.usd) || 0;
    res.json({
      ok: true,
      budget: {
        monthlyUsd: budgetUsd,
        spentUsd: Number(spentUsd.toFixed(4)),
        exceeded: budgetUsd > 0 && spentUsd >= budgetUsd,
        monthStart,
      },
    });
  } catch (err) {
    next(err);
  }
});
