/**
 * @fileoverview Slash-command parsing for skills in chat goals.
 * Purpose: `/skill-slug goal` explicit invoke and `/learn` draft creation.
 * Downstream: chats message route, ChatDetailPage compose preview.
 */

import { normalizeSkillSlug } from "./skillMd.js";

/**
 * @param {string} content
 * @returns {{ name: string }|null}
 */
export function parseLearnCommand(content) {
  const raw = String(content || "").trim();
  if (!/^\/learn\b/i.test(raw)) return null;
  const rest = raw.replace(/^\/learn\b/i, "").trim();
  return { name: rest };
}

/**
 * @param {string} content
 * @returns {{ slug: string, goal: string }|null}
 */
export function parseSkillSlash(content) {
  const raw = String(content || "").trim();
  const match = raw.match(/^\/([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  const command = match[1].toLowerCase();
  if (command === "learn") return null;
  return {
    slug: normalizeSkillSlug(command),
    goal: String(match[2] || "").trim(),
  };
}

/**
 * @param {object[]} skills
 * @param {string} slug
 * @returns {object|null}
 */
export function findSkillBySlash(skills, slug) {
  const norm = normalizeSkillSlug(slug);
  if (!norm) return null;
  for (const skill of skills || []) {
    const candidates = [
      skill.slug,
      skill.name,
      ...(skill.triggers || []).map((t) => String(t).replace(/\\/g, "")),
    ];
    for (const c of candidates) {
      if (normalizeSkillSlug(c) === norm) return skill;
    }
  }
  return null;
}

/**
 * Strips leading @mention and /slash from compose text for display goal preview.
 * @param {string} content
 * @param {{ mentionStripped?: string }} [ctx]
 * @returns {string}
 */
export function stripDispatchPrefixes(content, ctx = {}) {
  let text = ctx.mentionStripped != null ? ctx.mentionStripped : String(content || "").trim();
  const slash = parseSkillSlash(text);
  if (slash) text = slash.goal;
  return text.trim();
}
