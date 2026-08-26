/**
 * @fileoverview Shared /learn draft skill creation from task trajectories.
 * Purpose: Used by skills API and chat `/learn` slash command.
 * Downstream: POST /api/skills/learn, POST /api/chats/:id/messages.
 */

import { Skill } from "../models/Skill.js";
import { Task } from "../models/Task.js";
import {
  normalizeSkillSlug,
  slugFromName,
  trajectoryToPlaybookMd,
  trajectoryToStepLines,
} from "./skillMd.js";

/**
 * @param {string} userId
 * @param {string} name
 * @param {string} [preferred]
 * @param {string} [excludeId]
 */
export async function allocateSkillSlug(userId, name, preferred = "", excludeId = null) {
  const base = normalizeSkillSlug(preferred) || slugFromName(name);
  let slug = base;
  let n = 2;
  for (;;) {
    const filter = { user: userId, slug };
    if (excludeId) filter._id = { $ne: excludeId };
    const exists = await Skill.exists(filter);
    if (!exists) return slug;
    slug = `${base}-${n}`;
    n += 1;
  }
}

/**
 * @param {string} userId
 * @param {{ taskId?: string, chatId?: string, name?: string }} opts
 */
export async function createLearnedSkillDraft(userId, opts = {}) {
  let task = null;
  if (opts.taskId) {
    task = await Task.findOne({ _id: opts.taskId, user: userId });
  } else if (opts.chatId) {
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

  const name = String(opts.name || task.goal || "Learned skill").trim().slice(0, 120);
  const slug = await allocateSkillSlug(userId, name, opts.slug || "");
  const skill = await Skill.create({
    user: userId,
    agent: task.agent || null,
    name,
    slug,
    description: `Learned from task: ${String(task.goal || "").slice(0, 160)}`,
    playbookMd: trajectoryToPlaybookMd(task),
    status: "draft",
    steps: trajectoryToStepLines(task),
    verificationRules: ["Goal completed successfully"],
    sourceTask: task._id,
  });
  return { skill, sourceTaskId: task._id };
}
