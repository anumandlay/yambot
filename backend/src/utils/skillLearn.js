/**
 * @fileoverview Shared /learn draft skill creation from task trajectories.
 * Purpose: Used by skills API and chat `/learn` slash command.
 * Downstream: POST /api/skills/learn, POST /api/chats/:id/messages.
 */

import { Skill } from "../models/Skill.js";
import { normalizeSkillSlug, slugFromName } from "./skillMd.js";
import { ensureSkillSuggestionFromTask } from "./skillSuggestion.js";

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
 * @param {{ taskId?: string, chatId?: string, name?: string, slug?: string }} opts
 */
export async function createLearnedSkillDraft(userId, opts = {}) {
  const result = await ensureSkillSuggestionFromTask(userId, {
    taskId: opts.taskId,
    chatId: opts.chatId,
    name: opts.name,
    slug: opts.slug,
    minSteps: 1,
  });
  if (!result) return null;
  return { skill: result.skill, sourceTaskId: result.sourceTaskId };
}
