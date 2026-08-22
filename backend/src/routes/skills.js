/**
 * @fileoverview Skills API — demonstrations, skills, and training requests.
 * Purpose: Human demo → skill pipeline and employee training queue.
 * Downstream: Skill, Demonstration, TrainingRequest models.
 */

import { Router } from "express";
import { Skill, SKILL_STATUSES } from "../models/Skill.js";
import { Demonstration } from "../models/Demonstration.js";
import { TrainingRequest, TRAINING_STATUSES } from "../models/TrainingRequest.js";

export const skillsRouter = Router();

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
      steps: Array.isArray(body.steps) ? body.steps : [],
      verificationRules: Array.isArray(body.verificationRules) ? body.verificationRules : [],
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
    const skill = await Skill.create({
      user: req.userId,
      agent: demo.agent,
      name: String(req.body?.name || demo.title || "Learned skill").trim(),
      description: `Generated from demonstration ${demo._id}`,
      status: "training",
      steps: (demo.steps || []).map((s) => s.action).filter(Boolean),
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
    const requests = await TrainingRequest.find(filter).sort({ createdAt: -1 }).limit(50).lean();
    res.json({ ok: true, requests });
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
