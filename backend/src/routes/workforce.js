/**
 * @fileoverview Workforce API — manager delegation and workload (Layer 3).
 * Purpose: Overview queue depth per agent; delegate parent goals to managed workers.
 * Downstream: Agent.role/managedAgents, Goal.parentGoal, Task counts.
 */

import { Router } from "express";
import { Agent, toAgentSnapshot } from "../models/Agent.js";
import { Task, priorityRank } from "../models/Task.js";
import { Goal, buildGoalRunText, toGoalPublic } from "../models/Goal.js";
import { Chat, Message } from "../models/Chat.js";
import { writeAudit } from "../utils/audit.js";

export const workforceRouter = Router();

/**
 * GET /api/workforce/overview — agents with pending/running task counts.
 */
workforceRouter.get("/overview", async (req, res, next) => {
  try {
    const agents = await Agent.find({ user: req.userId, active: { $ne: false } })
      .select("name role managedAgents computer.online computer.lastSeenAt")
      .lean();

    const counts = await Task.aggregate([
      {
        $match: {
          user: req.userId,
          status: { $in: ["pending", "running", "waiting_user"] },
        },
      },
      {
        $group: {
          _id: "$agent",
          pending: {
            $sum: { $cond: [{ $eq: ["$status", "pending"] }, 1, 0] },
          },
          running: {
            $sum: { $cond: [{ $eq: ["$status", "running"] }, 1, 0] },
          },
          waiting: {
            $sum: { $cond: [{ $eq: ["$status", "waiting_user"] }, 1, 0] },
          },
        },
      },
    ]);

    const byAgent = new Map(counts.map((c) => [String(c._id), c]));

    res.json({
      ok: true,
      agents: agents.map((a) => {
        const c = byAgent.get(String(a._id)) || {};
        return {
          id: String(a._id),
          name: a.name,
          role: a.role || "worker",
          managedAgents: (a.managedAgents || []).map(String),
          online: Boolean(a.computer?.online),
          workload: {
            pending: c.pending || 0,
            running: c.running || 0,
            waiting: c.waiting || 0,
          },
        };
      }),
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/workforce/delegate — manager creates child goals for other agents.
 * Body: { parentGoalId, assignments: [{ agentId, title?, instructions? }] }
 */
workforceRouter.post("/delegate", async (req, res, next) => {
  try {
    const parentGoalId = String(req.body?.parentGoalId || "").trim();
    const assignments = Array.isArray(req.body?.assignments) ? req.body.assignments : [];
    if (!parentGoalId || !assignments.length) {
      res.status(400).json({
        ok: false,
        detail: "parentGoalId and assignments[] required",
      });
      return;
    }

    const parent = await Goal.findOne({ _id: parentGoalId, user: req.userId });
    if (!parent) {
      res.status(404).json({ ok: false, detail: "Parent goal missing" });
      return;
    }

    const managerAgent = parent.agent
      ? await Agent.findOne({ _id: parent.agent, user: req.userId })
      : null;
    if (managerAgent?.role !== "manager") {
      res.status(403).json({
        ok: false,
        detail: "Parent goal must belong to a manager agent to delegate.",
      });
      return;
    }

    const allowed = new Set((managerAgent.managedAgents || []).map(String));
    const created = [];

    for (const a of assignments.slice(0, 10)) {
      const agentId = String(a.agentId || "").trim();
      if (!agentId || !allowed.has(agentId)) continue;

      const child = await Goal.create({
        user: req.userId,
        agent: agentId,
        parentGoal: parent._id,
        title: String(a.title || `${parent.title} (delegated)`).slice(0, 200),
        description: parent.description,
        instructions: String(a.instructions || parent.instructions || "").trim(),
        successCriteria: parent.successCriteria,
        priority: parent.priority,
        status: "active",
      });
      created.push(toGoalPublic(child));
    }

    await writeAudit({
      userId: req.userId,
      action: "workforce.delegate",
      goalId: String(parent._id),
      agentId: String(managerAgent._id),
      detail: `Delegated ${created.length} child goal(s)`,
      meta: { childGoalIds: created.map((g) => g._id) },
    });

    res.status(201).json({ ok: true, goals: created });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/workforce/run-goal/:goalId — run any goal (used after delegation).
 */
workforceRouter.post("/run-goal/:goalId", async (req, res, next) => {
  try {
    const goal = await Goal.findOne({ _id: req.params.goalId, user: req.userId });
    if (!goal || !goal.agent) {
      res.status(404).json({ ok: false, detail: "Goal or agent missing" });
      return;
    }
    const agentDoc = await Agent.findOne({ _id: goal.agent, user: req.userId });
    if (!agentDoc) {
      res.status(404).json({ ok: false, detail: "Agent missing" });
      return;
    }

    let chat;
    if (goal.chatId) {
      chat = await Chat.findOne({ _id: goal.chatId, user: req.userId });
    }
    if (!chat) {
      chat = await Chat.create({
        user: req.userId,
        agent: agentDoc._id,
        title: `Goal · ${goal.title}`.slice(0, 80),
      });
      goal.chatId = chat._id;
      await goal.save();
    }

    const runText = buildGoalRunText(goal);
    const message = await Message.create({
      chat: chat._id,
      role: "user",
      content: runText,
      meta: { kind: "goal_run", goalId: goal._id },
    });

    const task = await Task.create({
      user: req.userId,
      chat: chat._id,
      message: message._id,
      goal: runText,
      goalRef: goal._id,
      priority: goal.priority || "normal",
      priorityRank: priorityRank(goal.priority),
      agent: agentDoc._id,
      agentSnapshot: toAgentSnapshot(agentDoc),
      runner: "cloud",
      status: "pending",
      events: [{ type: "queued", payload: { goalId: String(goal._id), delegated: true } }],
    });

    res.status(201).json({ ok: true, task, chatId: chat._id });
  } catch (err) {
    next(err);
  }
});
