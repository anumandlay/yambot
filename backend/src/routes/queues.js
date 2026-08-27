/**
 * @fileoverview Queues API — unified views for tickets, campaigns, agent tasks.
 * Purpose: Dedicated work queue endpoints for QueuesPage (upgrade #8).
 * Downstream: Ticket, Campaign, Task models.
 */

import { Router } from "express";
import { Ticket } from "../models/Ticket.js";
import { Enrollment, Campaign } from "../models/Campaign.js";
import { Task } from "../models/Task.js";
import { Agent } from "../models/Agent.js";

export const queuesRouter = Router();

queuesRouter.get("/tickets", async (req, res, next) => {
  try {
    const status = req.query.status ? String(req.query.status) : { $nin: ["closed"] };
    const tickets = await Ticket.find({ user: req.userId, status })
      .sort({ priority: -1, updatedAt: -1 })
      .limit(100)
      .populate("requesterEntity", "name attributes")
      .populate("assigneeAgent", "name")
      .lean();
    res.json({ ok: true, tickets });
  } catch (err) {
    next(err);
  }
});

queuesRouter.get("/campaigns", async (req, res, next) => {
  try {
    const campaigns = await Campaign.find({ user: req.userId, status: "active" })
      .sort({ updatedAt: -1 })
      .limit(20)
      .lean();
    const pipeline = await Enrollment.aggregate([
      { $match: { user: req.userId } },
      { $group: { _id: { campaign: "$campaign", stage: "$stage" }, count: { $sum: 1 } } },
    ]);
    res.json({ ok: true, campaigns, pipeline });
  } catch (err) {
    next(err);
  }
});

queuesRouter.get("/tasks", async (req, res, next) => {
  try {
    const filter = {
      user: req.userId,
      status: { $in: ["pending", "running", "waiting_user"] },
    };
    if (req.query.agentId) filter.agent = String(req.query.agentId);
    const tasks = await Task.find(filter)
      .sort({ priority: -1, createdAt: 1 })
      .limit(100)
      .populate("agent", "name")
      .lean();
    const agents = await Agent.find({ user: req.userId }).select("name").lean();
    res.json({ ok: true, tasks, agents });
  } catch (err) {
    next(err);
  }
});
