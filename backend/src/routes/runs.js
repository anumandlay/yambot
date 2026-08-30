/**
 * @fileoverview Agent run history API — filterable Task list with final replies.
 * Purpose: Power /runs and /agents/:id/runs so users see when each agent ran and resultSummary.
 * Downstream: Task, Agent models; AgentRunsPage; AgentRunStatusPage.
 */

import { Router } from "express";
import mongoose from "mongoose";
import { Task } from "../models/Task.js";
import { Agent } from "../models/Agent.js";

export const runsRouter = Router();

/**
 * Serialize a task for run-history UIs (no huge events/trajectory by default).
 * @param {object} t
 * @param {{ includeEvents?: boolean }} [opts]
 */
function publicRun(t, opts = {}) {
  const agent = t.agent && typeof t.agent === "object" ? t.agent : null;
  return {
    _id: String(t._id),
    status: t.status,
    goal: String(t.goal || "").slice(0, 500),
    resultSummary: String(t.resultSummary || "").slice(0, 4000),
    lastError: String(t.lastError || "").slice(0, 2000),
    startedAt: t.startedAt || t.claimedAt || t.createdAt || null,
    completedAt: t.completedAt || null,
    createdAt: t.createdAt || null,
    updatedAt: t.updatedAt || null,
    chatId: t.chat ? String(t.chat) : null,
    agentId: agent ? String(agent._id) : t.agent ? String(t.agent) : null,
    agentName: agent?.name || "",
    priority: t.priority || "normal",
    evaluation: t.evaluation || null,
    eventCount: Array.isArray(t.events) ? t.events.length : 0,
    ...(opts.includeEvents
      ? {
          events: (t.events || []).slice(-40).map((e) => ({
            type: e.type,
            at: e.at,
            payload: e.payload,
          })),
        }
      : {}),
  };
}

/**
 * Build Mongo filter from query string.
 * @param {string} userId
 * @param {import('express').Request['query']} query
 */
function buildRunFilter(userId, query) {
  /** @type {Record<string, unknown>} */
  const filter = { user: userId };

  if (query.agentId && mongoose.isValidObjectId(String(query.agentId))) {
    filter.agent = String(query.agentId);
  }

  const status = String(query.status || "").trim();
  if (status && status !== "all") {
    if (status.includes(",")) {
      filter.status = { $in: status.split(",").map((s) => s.trim()).filter(Boolean) };
    } else {
      filter.status = status;
    }
  }

  const from = query.from ? new Date(String(query.from)) : null;
  let to = query.to ? new Date(String(query.to)) : null;
  // Why: HTML date inputs are day-precision — include the whole end day.
  if (to && !Number.isNaN(to.getTime()) && String(query.to).length <= 10) {
    to = new Date(to.getTime() + 24 * 60 * 60 * 1000 - 1);
  }
  if ((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))) {
    /** @type {Record<string, Date>} */
    const range = {};
    if (from && !Number.isNaN(from.getTime())) range.$gte = from;
    if (to && !Number.isNaN(to.getTime())) range.$lte = to;
    filter.createdAt = range;
  }

  const q = String(query.q || "").trim();
  if (q) {
    filter.$or = [
      { goal: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
      { resultSummary: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
      { lastError: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
    ];
  }

  return filter;
}

/**
 * GET /api/runs — filtered run history across agents.
 * Query: agentId, status (or comma-list / all), from, to, q, limit, skip
 */
runsRouter.get("/", async (req, res, next) => {
  try {
    const filter = buildRunFilter(req.userId, req.query);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const skip = Math.max(Number(req.query.skip) || 0, 0);

    const [runs, total, agents] = await Promise.all([
      Task.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select(
          "status goal resultSummary lastError startedAt claimedAt completedAt createdAt updatedAt chat agent priority evaluation events"
        )
        .populate("agent", "name")
        .lean(),
      Task.countDocuments(filter),
      Agent.find({ user: req.userId }).select("name skill computer.online").sort({ name: 1 }).lean(),
    ]);

    res.json({
      ok: true,
      total,
      limit,
      skip,
      runs: runs.map((t) => publicRun(t)),
      agents: agents.map((a) => ({
        _id: String(a._id),
        name: a.name,
        skill: a.skill || "",
        online: Boolean(a.computer?.online),
      })),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/runs/:id — one run detail (optional events).
 */
runsRouter.get("/:id", async (req, res, next) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ ok: false, title: "Invalid id", detail: "Bad run id" });
      return;
    }
    const t = await Task.findOne({ _id: req.params.id, user: req.userId })
      .populate("agent", "name")
      .lean();
    if (!t) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Run missing" });
      return;
    }
    res.json({ ok: true, run: publicRun(t, { includeEvents: true }) });
  } catch (err) {
    next(err);
  }
});
