/**
 * @fileoverview Goals API — Employee OS objectives (Layer 1).
 * Purpose: CRUD durable goals and enqueue cloud worker runs linked to agents.
 * Downstream: Goal model, Chat/Message/Task, audit log.
 */

import { Router } from "express";
import { Goal, GOAL_PRIORITIES, GOAL_STATUSES, buildGoalRunText, recordGoalRun, toGoalPublic } from "../models/Goal.js";
import { Agent, toAgentSnapshot } from "../models/Agent.js";
import { Chat, Message } from "../models/Chat.js";
import { Task, priorityRank } from "../models/Task.js";
import { writeAudit } from "../utils/audit.js";

export const goalsRouter = Router();

/**
 * @param {object} body
 */
function pickGoalFields(body) {
  const out = {};
  if (body.title != null) out.title = String(body.title || "").trim();
  if (body.description != null) out.description = String(body.description || "").trim();
  if (body.instructions != null) out.instructions = String(body.instructions || "").trim();
  if (body.successCriteria != null) out.successCriteria = String(body.successCriteria || "").trim();
  if (body.agent != null) out.agent = body.agent || null;
  if (body.parentGoal != null) out.parentGoal = body.parentGoal || null;
  if (body.status != null) {
    const s = String(body.status);
    out.status = GOAL_STATUSES.includes(s) ? s : "active";
  }
  if (body.priority != null) {
    const p = String(body.priority);
    out.priority = GOAL_PRIORITIES.includes(p) ? p : "normal";
  }
  if (body.kpis != null && Array.isArray(body.kpis)) {
    out.kpis = body.kpis
      .map((k) => ({
        name: String(k?.name || "").trim(),
        target: k?.target == null ? null : Number(k.target),
        current: Number(k?.current) || 0,
        unit: String(k?.unit || "").trim(),
      }))
      .filter((k) => k.name)
      .slice(0, 20);
  }
  if (body.autonomy != null && typeof body.autonomy === "object") {
    out.autonomy = {
      enabled: body.autonomy.enabled === true,
      checkIntervalMinutes: Math.max(15, Number(body.autonomy.checkIntervalMinutes) || 60),
      autoRun: body.autonomy.autoRun !== false,
    };
  }
  if (body.sla != null && typeof body.sla === "object") {
    out.sla = {
      responseMinutes: Math.max(0, Number(body.sla.responseMinutes) || 0),
      name: String(body.sla.name || "").trim(),
    };
  }
  return out;
}

goalsRouter.get("/meta", (_req, res) => {
  res.json({ ok: true, statuses: GOAL_STATUSES, priorities: GOAL_PRIORITIES });
});

goalsRouter.get("/", async (req, res, next) => {
  try {
    const filter = { user: req.userId };
    if (req.query.agentId) filter.agent = String(req.query.agentId);
    if (req.query.status) filter.status = String(req.query.status);
    const goals = await Goal.find(filter).sort({ updatedAt: -1 }).lean();
    res.json({ ok: true, goals: goals.map(toGoalPublic) });
  } catch (err) {
    next(err);
  }
});

goalsRouter.post("/", async (req, res, next) => {
  try {
    const fields = pickGoalFields(req.body || {});
    if (!fields.title) {
      res.status(400).json({ ok: false, title: "Title required", detail: "Give the goal a title." });
      return;
    }
    const goal = await Goal.create({ ...fields, user: req.userId });
    await writeAudit({
      userId: req.userId,
      action: "goal.created",
      goalId: String(goal._id),
      agentId: goal.agent ? String(goal.agent) : null,
      detail: goal.title,
    });
    res.status(201).json({ ok: true, goal: toGoalPublic(goal) });
  } catch (err) {
    next(err);
  }
});

goalsRouter.get("/:id", async (req, res, next) => {
  try {
    const goal = await Goal.findOne({ _id: req.params.id, user: req.userId }).lean();
    if (!goal) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Goal missing" });
      return;
    }
    res.json({ ok: true, goal: toGoalPublic(goal) });
  } catch (err) {
    next(err);
  }
});

goalsRouter.put("/:id", async (req, res, next) => {
  try {
    const goal = await Goal.findOne({ _id: req.params.id, user: req.userId });
    if (!goal) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Goal missing" });
      return;
    }
    const fields = pickGoalFields(req.body || {});
    Object.assign(goal, fields);
    await goal.save();
    await writeAudit({
      userId: req.userId,
      action: "goal.updated",
      goalId: String(goal._id),
      agentId: goal.agent ? String(goal.agent) : null,
      detail: goal.title,
    });
    res.json({ ok: true, goal: toGoalPublic(goal) });
  } catch (err) {
    next(err);
  }
});

goalsRouter.delete("/:id", async (req, res, next) => {
  try {
    const goal = await Goal.findOneAndDelete({ _id: req.params.id, user: req.userId });
    if (!goal) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Goal missing" });
      return;
    }
    await writeAudit({
      userId: req.userId,
      action: "goal.deleted",
      goalId: String(goal._id),
      detail: goal.title,
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/goals/:id/run — enqueue a cloud task for this goal.
 */
goalsRouter.post("/:id/run", async (req, res, next) => {
  try {
    const goal = await Goal.findOne({ _id: req.params.id, user: req.userId });
    if (!goal) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Goal missing" });
      return;
    }
    if (!goal.agent) {
      res.status(400).json({
        ok: false,
        title: "Agent required",
        detail: "Assign an agent to this goal before running.",
      });
      return;
    }
    if (goal.status === "archived" || goal.status === "completed") {
      res.status(400).json({
        ok: false,
        title: "Goal inactive",
        detail: `Goal status is ${goal.status}. Set to active first.`,
      });
      return;
    }

    const agentDoc = await Agent.findOne({ _id: goal.agent, user: req.userId });
    if (!agentDoc) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Agent missing" });
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
    const snapshot = toAgentSnapshot(agentDoc);
    const priority = goal.priority || "normal";

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
      priority,
      priorityRank: priorityRank(priority),
      agent: agentDoc._id,
      agentSnapshot: snapshot,
      runner: "cloud",
      status: "pending",
      events: [
        {
          type: "queued",
          payload: {
            goalId: String(goal._id),
            goalTitle: goal.title,
            priority,
            agentId: String(agentDoc._id),
          },
        },
      ],
    });

    await Message.create({
      chat: chat._id,
      role: "system",
      content: `Goal “${goal.title}” queued (${priority} priority) on cloud computer.`,
      meta: { taskId: task._id, goalId: goal._id, status: "pending" },
    });

    await writeAudit({
      userId: req.userId,
      action: "goal.run",
      goalId: String(goal._id),
      agentId: String(agentDoc._id),
      taskId: String(task._id),
      detail: goal.title,
      meta: { priority },
    });

    res.status(201).json({ ok: true, task, chatId: chat._id, message });
  } catch (err) {
    next(err);
  }
});
