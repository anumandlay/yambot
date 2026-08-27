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
import {
  appendDemoSessionStep,
  finishDemoSession,
  startDemoSession,
} from "../utils/demoSession.js";
import {
  normalizeSkillSlug,
  parseSkillMd,
  serializeSkillMd,
  slugFromName,
  trajectoryToPlaybookMd,
  trajectoryToStepLines,
} from "../utils/skillMd.js";
import { allocateSkillSlug, createLearnedSkillDraft } from "../utils/skillLearn.js";
import {
  demoStepsToSkillSteps,
  ensureSkillSuggestionFromTask,
} from "../utils/skillSuggestion.js";

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
 * Ensures a unique slug per user when creating or renaming skills.
 * @param {string} userId
 * @param {string} name
 * @param {string} [preferred]
 * @param {string} [excludeId]
 */
async function ensureSkillSlug(userId, name, preferred = "", excludeId = null) {
  return allocateSkillSlug(userId, name, preferred, excludeId);
}

/**
 * Applies playbook markdown onto description/steps/verification when structured fields empty.
 * @param {import("mongoose").Document} skill
 */
function syncSkillFromPlaybook(skill) {
  const md = String(skill.playbookMd || "").trim();
  if (!md) return;
  const parsed = parseSkillMd(md);
  if (!skill.description && parsed.whenToUse) {
    skill.description = parsed.whenToUse.split("\n")[0].slice(0, 280);
  }
  if ((!skill.steps || !skill.steps.length) && parsed.procedure) {
    skill.steps = parsed.procedure
      .split("\n")
      .map((line) => line.replace(/^\d+\.\s*/, "").replace(/^-\s*/, "").trim())
      .filter(Boolean);
  }
  if ((!skill.verificationRules || !skill.verificationRules.length) && parsed.verification) {
    skill.verificationRules = parsed.verification
      .split("\n")
      .map((line) => line.replace(/^-\s*/, "").trim())
      .filter(Boolean);
  }
}

/**
 * Normalizes legacy training status to draft for API responses.
 * @param {object} skill
 * @returns {object}
 */
function normalizeSkillStatus(skill) {
  if (!skill || skill.status !== "training") return skill;
  return { ...skill, status: "draft" };
}

skillsRouter.get("/", async (req, res, next) => {
  try {
    await Skill.updateMany(
      { user: req.userId, status: "training" },
      { $set: { status: "draft" } }
    );
    const skills = await Skill.find({ user: req.userId }).sort({ updatedAt: -1 }).lean();
    res.json({ ok: true, skills: skills.map(normalizeSkillStatus) });
  } catch (err) {
    next(err);
  }
});

skillsRouter.post("/", async (req, res, next) => {
  try {
    const body = req.body || {};
    const name = String(body.name || "Skill").trim();
    const slug = await ensureSkillSlug(req.userId, name, body.slug || "");
    const skill = await Skill.create({
      user: req.userId,
      agent: body.agentId || null,
      name,
      slug,
      description: body.description || "",
      playbookMd: body.playbookMd || "",
      status: SKILL_STATUSES.includes(body.status) ? body.status : "draft",
      triggers: Array.isArray(body.triggers) ? body.triggers : [],
      steps: body.steps != null ? parseSkillStepsInput(body.steps) : [],
      verificationRules: Array.isArray(body.verificationRules) ? body.verificationRules : [],
      executionMode: SKILL_EXECUTION_MODES.includes(body.executionMode) ? body.executionMode : "hints",
      enforceVerification: Boolean(body.enforceVerification),
    });
    if (!skill.playbookMd) skill.playbookMd = serializeSkillMd(skill);
    syncSkillFromPlaybook(skill);
    await skill.save();
    res.status(201).json({ ok: true, skill });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/skills/learn — draft skill from a task trajectory (`/learn` in chat).
 * Body: { taskId?, chatId?, name? }
 */
skillsRouter.post("/learn", async (req, res, next) => {
  try {
    const body = req.body || {};
    const result = await createLearnedSkillDraft(req.userId, {
      taskId: body.taskId,
      chatId: body.chatId,
      name: body.name,
      slug: body.slug,
    });
    if (!result) {
      res.status(404).json({
        ok: false,
        title: "No task to learn from",
        detail: "Run a goal first, then use /learn in this chat.",
        hint: "The latest completed task with a trajectory becomes the draft playbook.",
      });
      return;
    }
    res.status(201).json({ ok: true, skill: result.skill, sourceTaskId: result.sourceTaskId });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/skills/import — create skill from pasted SKILL.md.
 * Body: { markdown, name?, agentId?, status? }
 */
skillsRouter.post("/import", async (req, res, next) => {
  try {
    const markdown = String(req.body?.markdown || "").trim();
    if (!markdown) {
      res.status(400).json({ ok: false, detail: "Paste SKILL.md markdown to import." });
      return;
    }
    const parsed = parseSkillMd(markdown);
    const firstLine = markdown.split("\n").find((l) => l.startsWith("#")) || "";
    const name =
      String(req.body?.name || firstLine.replace(/^#+\s*/, "") || "Imported skill").trim();
    const slug = await ensureSkillSlug(req.userId, name, req.body?.slug || "");
    const skill = await Skill.create({
      user: req.userId,
      agent: req.body?.agentId || null,
      name,
      slug,
      description: parsed.whenToUse.split("\n")[0]?.slice(0, 280) || "",
      playbookMd: markdown,
      status: SKILL_STATUSES.includes(req.body?.status) ? req.body.status : "draft",
      steps: parsed.procedure
        .split("\n")
        .map((line) => line.replace(/^\d+\.\s*/, "").replace(/^-\s*/, "").trim())
        .filter(Boolean),
      verificationRules: parsed.verification
        .split("\n")
        .map((line) => line.replace(/^-\s*/, "").trim())
        .filter(Boolean),
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
    if (demo.convertedSkill) {
      const existing = await Skill.findOne({ _id: demo.convertedSkill, user: req.userId });
      if (existing) {
        res.json({ ok: true, skill: normalizeSkillStatus(existing.toObject()), alreadyLinked: true });
        return;
      }
    }
    if (demo.task) {
      const linked = await ensureSkillSuggestionFromTask(req.userId, {
        taskId: String(demo.task),
        minSteps: 1,
      });
      if (linked?.skill) {
        demo.convertedSkill = linked.skill._id;
        await demo.save();
        res.json({ ok: true, skill: normalizeSkillStatus(linked.skill.toObject()), linked: true });
        return;
      }
    }
    const { steps, executionMode } = demoStepsToSkillSteps(demo.steps);
    const skill = await Skill.create({
      user: req.userId,
      agent: demo.agent,
      name: String(req.body?.name || demo.title || "Learned skill").trim(),
      description: `Learned from demonstration: ${String(demo.title || "").slice(0, 160)}`,
      status: "draft",
      steps,
      executionMode,
      verificationRules: ["Replay steps without error", "Match success criteria"],
      sourceDemonstration: demo._id,
      sourceTask: demo.task || null,
    });
    demo.convertedSkill = skill._id;
    await demo.save();
    res.status(201).json({ ok: true, skill });
  } catch (err) {
    next(err);
  }
});

/** POST /api/skills/demos/start — begin Take control demonstration (UI-facing). */
skillsRouter.post("/demos/start", async (req, res, next) => {
  try {
    const agentId = String(req.body?.agentId || "").trim();
    const demo = await startDemoSession(req.userId, {
      agentId,
      taskId: req.body?.taskId || null,
      title: req.body?.title,
    });
    res.status(201).json({ ok: true, demonstration: demo });
  } catch (err) {
    next(err);
  }
});

/** POST /api/skills/demos/step — append a demonstration step. */
skillsRouter.post("/demos/step", async (req, res, next) => {
  try {
    const demoId = String(req.body?.demoId || "").trim();
    const demo = await appendDemoSessionStep(req.userId, demoId, {
      observation: req.body?.observation,
      action: req.body?.action,
      result: req.body?.result,
    });
    if (!demo) {
      res.status(404).json({ ok: false, detail: "Demonstration missing" });
      return;
    }
    res.json({ ok: true, demonstration: demo });
  } catch (err) {
    next(err);
  }
});

/** POST /api/skills/demos/finish — finalize demonstration + emit demo.captured. */
skillsRouter.post("/demos/finish", async (req, res, next) => {
  try {
    const demoId = String(req.body?.demoId || "").trim();
    const demo = await finishDemoSession(req.userId, {
      demoId,
      title: req.body?.title,
    });
    if (!demo) {
      res.status(404).json({ ok: false, detail: "Demonstration missing" });
      return;
    }
    res.json({ ok: true, demonstration: demo });
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
    const result = await ensureSkillSuggestionFromTask(req.userId, {
      taskId: String(task._id),
      name: String(req.body?.title || task.goal || "Task run").trim().slice(0, 120),
      minSteps: 1,
    });
    if (!result) {
      res.status(400).json({ ok: false, detail: "Task has no trajectory to save" });
      return;
    }
    res.status(201).json({
      ok: true,
      demonstration: result.demonstration,
      skill: normalizeSkillStatus(result.skill.toObject()),
    });
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

/**
 * DELETE /api/skills/demos/:demoId — remove a captured demonstration.
 * Why: Keeps converted skills; only clears sourceDemonstration link on those skills.
 */
skillsRouter.delete("/demos/:demoId", async (req, res, next) => {
  try {
    const demo = await Demonstration.findOne({ _id: req.params.demoId, user: req.userId });
    if (!demo) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Demonstration missing" });
      return;
    }
    await Skill.updateMany(
      { user: req.userId, sourceDemonstration: demo._id },
      { $unset: { sourceDemonstration: "" } }
    );
    await Demonstration.deleteOne({ _id: demo._id });
    res.json({ ok: true, deletedId: String(demo._id) });
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

skillsRouter.get("/:id/export", async (req, res, next) => {
  try {
    const skill = await Skill.findOne({ _id: req.params.id, user: req.userId }).lean();
    if (!skill) {
      res.status(404).json({ ok: false, detail: "Skill missing" });
      return;
    }
    const markdown = serializeSkillMd(skill);
    res.json({ ok: true, markdown, slug: skill.slug, name: skill.name });
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
    res.json({ ok: true, skill: normalizeSkillStatus(skill) });
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
    if (body.slug != null) {
      skill.slug = await ensureSkillSlug(
        req.userId,
        skill.name,
        body.slug || skill.name,
        String(skill._id)
      );
    } else if (!skill.slug) {
      skill.slug = await ensureSkillSlug(req.userId, skill.name, "", String(skill._id));
    }
    if (body.description != null) skill.description = String(body.description).trim();
    if (body.playbookMd != null) skill.playbookMd = String(body.playbookMd);
    if (body.status != null && SKILL_STATUSES.includes(body.status)) {
      skill.status = body.status === "training" ? "draft" : body.status;
    }
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
    syncSkillFromPlaybook(skill);
    if (!String(skill.playbookMd || "").trim()) {
      skill.playbookMd = serializeSkillMd(skill);
    }
    await skill.save();
    res.json({ ok: true, skill });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/skills/:id — remove a skill; unlink demos/training that pointed at it.
 */
skillsRouter.delete("/:id", async (req, res, next) => {
  try {
    const skill = await Skill.findOne({ _id: req.params.id, user: req.userId });
    if (!skill) {
      res.status(404).json({ ok: false, title: "Not found", detail: "Skill missing" });
      return;
    }
    const skillId = skill._id;
    await Promise.all([
      Demonstration.updateMany(
        { user: req.userId, convertedSkill: skillId },
        { $unset: { convertedSkill: "" } }
      ),
      TrainingRequest.updateMany(
        { user: req.userId, skill: skillId },
        { $unset: { skill: "" } }
      ),
    ]);
    await Skill.deleteOne({ _id: skillId });
    res.json({ ok: true, deletedId: String(skillId) });
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
