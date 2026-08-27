/**
 * @fileoverview Unified skill suggestion — one draft + demonstration per completed task.
 * Purpose: Replace duplicate draft/training/demo paths after task complete or Teach skill.
 * Downstream: worker task complete, skills routes, demo finish, /learn.
 */

import { Skill } from "../models/Skill.js";
import { Demonstration } from "../models/Demonstration.js";
import { Task } from "../models/Task.js";
import {
  trajectoryToPlaybookMd,
  trajectoryToStepLines,
} from "./skillMd.js";
import { allocateSkillSlug } from "./skillLearn.js";

/**
 * Converts stored task trajectory (or step events) into demonstration steps.
 * @param {object} task
 * @returns {object[]}
 */
export function trajectoryToDemoSteps(task) {
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
    return {
      observation: row.url_changed ? "Page navigated" : "",
      action: a,
      result: row.ok === false ? row.failure_class || "failed" : "ok",
    };
  });
}

/**
 * Converts demo actions into skill steps — prefers structured objects for replay.
 * @param {object[]} demoSteps
 * @returns {{ steps: unknown[], executionMode: string }}
 */
export function demoStepsToSkillSteps(demoSteps) {
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
 * @param {object[]} demoSteps
 * @returns {boolean}
 */
function demoHasHumanReplaySteps(demoSteps) {
  return (demoSteps || []).some((s) => {
    const a = s?.action;
    if (!a || typeof a !== "object") return false;
    return a.type === "type" || a.xNorm != null || a.yNorm != null;
  });
}

/**
 * Links a Teach-skill demonstration to an existing task draft (or enriches steps).
 * @param {string} userId
 * @param {import('mongoose').Document} demo
 */
export async function linkDemonstrationToTaskDraft(userId, demo) {
  if (!demo?.task) return null;
  const skill = await Skill.findOne({
    user: userId,
    sourceTask: demo.task,
    status: { $in: ["draft", "training"] },
  });
  if (!skill) return null;

  if (skill.status === "training") {
    skill.status = "draft";
  }
  if (!skill.sourceDemonstration) {
    skill.sourceDemonstration = demo._id;
  }
  const fromDemo = demoStepsToSkillSteps(demo.steps);
  if (fromDemo.steps.length && demoHasHumanReplaySteps(demo.steps)) {
    skill.steps = fromDemo.steps;
    skill.executionMode = fromDemo.executionMode;
  }
  await skill.save();

  if (!demo.convertedSkill) {
    demo.convertedSkill = skill._id;
    await demo.save();
  }
  return skill;
}

/**
 * Creates or returns one draft skill + demonstration for a completed task.
 * Why: One workflow → one demo row + one draft skill (no separate training status).
 * @param {string} userId
 * @param {{ taskId?: string, task?: object, chatId?: string, name?: string, slug?: string, minSteps?: number }} opts
 * @returns {Promise<{ skill: import('mongoose').Document, demonstration: import('mongoose').Document|null, sourceTaskId: string, created: boolean }|null>}
 */
export async function ensureSkillSuggestionFromTask(userId, opts = {}) {
  let task = opts.task || null;
  if (!task && opts.taskId) {
    task = await Task.findOne({ _id: opts.taskId, user: userId });
  } else if (!task && opts.chatId) {
    task = await Task.findOne({
      user: userId,
      chat: opts.chatId,
      status: { $in: ["done", "error"] },
      trajectory: { $exists: true, $not: { $size: 0 } },
    })
      .sort({ completedAt: -1, updatedAt: -1 })
      .lean();
  }
  if (!task) return null;

  const minSteps = opts.minSteps != null ? opts.minSteps : 2;
  const trajectory = Array.isArray(task.trajectory) ? task.trajectory : [];
  if (trajectory.length < minSteps) return null;

  const demoSteps = trajectoryToDemoSteps(task);
  let demo = await Demonstration.findOne({ user: userId, task: task._id }).sort({
    updatedAt: -1,
  });

  if (!demo && demoSteps.length) {
    demo = await Demonstration.create({
      user: userId,
      agent: task.agent,
      task: task._id,
      title: String(task.goal || "Task run").trim().slice(0, 120),
      steps: demoSteps,
    });
  } else if (demo && demoSteps.length && !demoHasHumanReplaySteps(demo.steps)) {
    demo.steps = demoSteps;
    if (!demo.title) {
      demo.title = String(task.goal || "Task run").trim().slice(0, 120);
    }
    await demo.save();
  }

  let skill = await Skill.findOne({ user: userId, sourceTask: task._id });
  let created = false;

  if (!skill) {
    const name = String(
      opts.name || `Suggested: ${String(task.goal || "workflow").slice(0, 48)}`
    )
      .trim()
      .slice(0, 120);
    const slug = await allocateSkillSlug(userId, name, opts.slug || "");
    let steps = trajectoryToStepLines(task);
    let executionMode = "hints";
    if (demo?.steps?.length) {
      const fromDemo = demoStepsToSkillSteps(demo.steps);
      if (fromDemo.steps.length) {
        steps = fromDemo.steps;
        executionMode = fromDemo.executionMode;
      }
    }
    skill = await Skill.create({
      user: userId,
      agent: task.agent || null,
      name,
      slug,
      description: `Learned from task: ${String(task.goal || "").slice(0, 160)}`,
      playbookMd: trajectoryToPlaybookMd(task),
      status: "draft",
      steps,
      executionMode,
      verificationRules: ["Goal completed successfully"],
      sourceTask: task._id,
      sourceDemonstration: demo?._id || null,
    });
    created = true;
  } else {
    if (skill.status === "training") {
      skill.status = "draft";
    }
    if (demo && !skill.sourceDemonstration) {
      skill.sourceDemonstration = demo._id;
    }
    if (demo?.steps?.length && demoHasHumanReplaySteps(demo.steps)) {
      const fromDemo = demoStepsToSkillSteps(demo.steps);
      skill.steps = fromDemo.steps;
      skill.executionMode = fromDemo.executionMode;
    }
    await skill.save();
  }

  if (demo && !demo.convertedSkill) {
    demo.convertedSkill = skill._id;
    await demo.save();
  }

  return { skill, demonstration: demo, sourceTaskId: task._id, created };
}
