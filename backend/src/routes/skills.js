/**
 * @fileoverview Skills API — demonstrations, skills, and training requests.
 * Purpose: Human demo → skill pipeline and employee training queue.
 * Downstream: Skill, Demonstration, TrainingRequest models.
 */

import { Router } from "express";
import { Skill, SKILL_STATUSES, SKILL_EXECUTION_MODES } from "../models/Skill.js";
import { Demonstration } from "../models/Demonstration.js";
import { TrainingRequest, TRAINING_STATUSES } from "../models/TrainingRequest.js";
import { Task } from "../models/Task.js";

export const skillsRouter = Router();

/**
 * Parses skill steps from API body (array, JSON lines, or plain text lines).
 * @param {unknown} raw
 * @returns {unknown[]}
 */
function parseSkillStepsInput(raw) {
  if (Array.isArray(raw)) return raw;
  return String(raw || "")
    .split("\n")
    .map((line) => {
      const t = line.trim();
      if (!t) return null;
      try {
        const parsed = JSON.parse(t);
        if (parsed && typeof parsed === "object") return parsed;
      } catch {
        /* plain text step */
      }
      return t;
    })
    .filter(Boolean);
}

/**
 * Converts demo actions into skill steps — prefers structured objects for replay.
 * @param {object[]} demoSteps
 * @returns {{ steps: unknown[], executionMode: string }}
 */
function demoStepsToSkillSteps(demoSteps) {
  const actionSteps = (demoSteps || [])
    .map((s) => s.action)
    .filter((a) => a && typeof a === "object" && a.type && a.type !== "session");
  if (actionSteps.length) {
    return { steps: actionSteps, executionMode: "replay" };
  }
  const textSteps = (demoSteps || [])
    .map((s) => {
      const a = s.action || {};
      if (a.type === "type" && a.text) return `Type: ${a.text}`;
      if (a.type === "click") {
        const x = Math.round((Number(a.xNorm) || 0) * 100);
        const y = Math.round((Number(a.yNorm) || 0) * 100);
        return `Click at ${x}%, ${y}%`;
      }
      if (a.type === "key" && a.key) return `Press key: ${a.key}`;
      if (a.type === "scroll") return `Scroll ${Number(a.dy) > 0 ? "down" : "up"}`;
      if (a.type === "session") return "Human took control";
      if (typeof a === "object" && Object.keys(a).length) return JSON.stringify(a);
      return "";
    })
    .filter(Boolean);
  return { steps: textSteps, executionMode: "hints" };
}

/**
 * Converts stored task trajectory (or step events) into demonstration steps.
 * @param {object} task
 * @returns {object[]}
 */
function trajectoryToDemoSteps(task) {
  let rows = [];
  if (Array.isArray(task.trajectory) && task.trajectory.length) {
    rows = task.trajectory;
  } else {
    rows = (task.events || [])
      .filter((e) => e.type === "step" && e.payload?.action)
      .map((e) => ({
        step: e.payload?.step,
        action: e.payload.action,
        ok: e.payload?.result?.ok !== false,
        failure_class: e.payload?.result?.failure_class,
      }));
  }
  return rows.map((row) => {
    const a = row.action || {};
    const parts = [a.type || "action"];
    if (a.ref) parts.push(`ref:${a.ref}`);
    if (a.name) parts.push(`"${a.name}"`);
    if (a.url) parts.push(a.url);
    return {
      observation: row.url_changed ? "Page navigated" : "",
      action: a,
      result: row.ok === false ? row.failure_class || "failed" : "ok",
    };
  });
}

skillsRouter.get("/", async (req, res, next) => {
  try {
    const skills = await Skill.find({ user: req.userId }).sort({ updatedAt: -1 }).lean();
    res.json({ ok: true, skills });
  } catch (err) {
    next(err);
  }
});

skillsRouter.post("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    const skill = await Skill.create({
      user: req.userId,
      agent: body.agentId || null,
      name: String(body.name || "Skill").trim(),
      description: body.description || "",
      status: SKILL_STATUSES.includes(body.status) ? body.status : "draft",
      triggers: Array.isArray(body.triggers) ? body.triggers : [],
      steps: body.steps != null ? parseSkillStepsInput(body.steps) : [],
      verificationRules: Array.isArray(body.verificationRules) ? body.verificationRules : [],
      executionMode: SKILL_EXECUTION_MODES.includes(body.executionMode) ? body.executionMode : "hints",
      enforceVerification: Boolean(body.enforceVerification),
    });
    res.status(201).json({ ok: true, skill });
  } catch (err) {
    next(err);
  }
});

skillsRouter.post("/from-demo/:demoId", async (req, res, next) => {
  try {
    const demo = await Demonstration.findOne({ _id: req.params.demoId, user: req.userId });
    if (!demo) {
      res.status(404).json({ ok: false, detail: "Demonstration missing" });
      return;
    }
    const { steps, executionMode } = demoStepsToSkillSteps(demo.steps);
    const skill = await Skill.create({
      user: req.userId,
      agent: demo.agent,
      name: String(req.body?.name || demo.title || "Learned skill").trim(),
      description: `Generated from demonstration ${demo._id}`,
      status: "training",
      steps,
      executionMode,
      verificationRules: ["Replay steps without error", "Match success criteria"],
      sourceDemonstration: demo._id,
    });
    demo.convertedSkill = skill._id;
    await demo.save();
    res.status(201).json({ ok: true, skill });
  } catch (err) {
    next(err);
  }
});

skillsRouter.post("/demos/from-task/:taskId", async (req, res, next) => {
  try {
    const task = await Task.findOne({ _id: req.params.taskId, user: req.userId });
    if (!task) {
      res.status(404).json({ ok: false, detail: "Task missing" });
      return;
    }
    const steps = trajectoryToDemoSteps(task);
    if (!steps.length) {
      res.status(400).json({ ok: false, detail: "Task has no trajectory to save" });
      return;
    }
    const demo = await Demonstration.create({
      user: req.userId,
      agent: task.agent,
      task: task._id,
      title: String(req.body?.title || task.goal || "Task trajectory").trim().slice(0, 120),
      steps,
    });
    res.status(201).json({ ok: true, demonstration: demo });
  } catch (err) {
    next(err);
  }
});

skillsRouter.get("/demos", async (req, res, next) => {
  try {
    const demos = await Demonstration.find({ user: req.userId }).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ ok: true, demonstrations: demos });
  } catch (err) {
    next(err);
  }
});

skillsRouter.get("/training", async (req, res, next) => {
  try {
    const filter = { user: req.userId };
    if (req.query.status) filter.status = String(req.query.status);
    const requests = await TrainingRequest.find(filter)
      .populate("agent", "name")
      .populate({
        path: "task",
        select: "chat goal status",
        populate: { path: "chat", select: "_id title" },
      })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean();
    res.json({ ok: true, requests });
  } catch (err) {
    next(err);
  }
});

skillsRouter.get("/:id", async (req, res, next) => {
  try {
    const skill = await Skill.findOne({ _id: req.params.id, user: req.userId }).lean();
    if (!skill) {
      res.status(404).json({ ok: false, detail: "Skill missing" });
      return;
    }
    res.json({ ok: true, skill });
  } catch (err) {
    next(err);
  }
});

skillsRouter.patch("/:id", async (req, res, next) => {
  try {
    const skill = await Skill.findOne({ _id: req.params.id, user: req.userId });
    if (!skill) {
      res.status(404).json({ ok: false, detail: "Skill missing" });
      return;
    }
    const body = req.body || {};
    if (body.name != null) skill.name = String(body.name).trim();
    if (body.description != null) skill.description = String(body.description).trim();
    if (body.status != null && SKILL_STATUSES.includes(body.status)) skill.status = body.status;
    if (body.agentId != null || body.agent != null) {
      skill.agent = body.agentId || body.agent || null;
    }
    if (body.triggers != null) {
      skill.triggers = Array.isArray(body.triggers)
        ? body.triggers.map((t) => String(t).trim()).filter(Boolean)
        : String(body.triggers)
            .split(/[\n,]+/)
            .map((t) => t.trim())
            .filter(Boolean);
    }
    if (body.steps != null) {
      skill.steps = parseSkillStepsInput(body.steps);
    }
    if (body.verificationRules != null) {
      skill.verificationRules = Array.isArray(body.verificationRules)
        ? body.verificationRules.map((r) => String(r).trim()).filter(Boolean)
        : String(body.verificationRules)
            .split("\n")
            .map((r) => r.trim())
            .filter(Boolean);
    }
    if (body.executionMode != null && SKILL_EXECUTION_MODES.includes(body.executionMode)) {
      skill.executionMode = body.executionMode;
    }
    if (body.enforceVerification != null) {
      skill.enforceVerification = Boolean(body.enforceVerification);
    }
    await skill.save();
    res.json({ ok: true, skill });
  } catch (err) {
    next(err);
  }
});

skillsRouter.post("/training", async (req, res, next) => {
  try {
    const body = req.body || {};
    const request = await TrainingRequest.create({
      user: req.userId,
      agent: body.agentId,
      task: body.taskId || null,
      workflow: body.workflow || "",
      observation: body.observation || "",
      recommendation: body.recommendation || "Record a human demonstration",
      status: "pending",
    });
    res.status(201).json({ ok: true, request });
  } catch (err) {
    next(err);
  }
});

skillsRouter.post("/training/:id/resolve", async (req, res, next) => {
  try {
    const request = await TrainingRequest.findOne({ _id: req.params.id, user: req.userId });
    if (!request) {
      res.status(404).json({ ok: false, detail: "Request missing" });
      return;
    }
    request.status = TRAINING_STATUSES.includes(req.body?.status) ? req.body.status : "completed";
    if (req.body?.skillId) request.skill = req.body.skillId;
    await request.save();
    res.json({ ok: true, request });
  } catch (err) {
    next(err);
  }
});
