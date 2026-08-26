/**
 * @fileoverview Client-side slash-command preview for chat compose.
 * Purpose: Mirror server rules for /learn and /skill-slug in the UI.
 */

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeSkillSlug(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * @param {string} content
 * @returns {{ name: string }|null}
 */
export function parseLearnCommand(content) {
  const raw = String(content || "").trim();
  if (!/^\/learn\b/i.test(raw)) return null;
  return { name: raw.replace(/^\/learn\b/i, "").trim() };
}

/**
 * @param {string} content
 * @returns {{ slug: string, goal: string }|null}
 */
export function parseSkillSlash(content) {
  const raw = String(content || "").trim();
  const match = raw.match(/^\/([a-z0-9][a-z0-9-]*)(?:\s+([\s\S]*))?$/i);
  if (!match) return null;
  if (match[1].toLowerCase() === "learn") return null;
  return {
    slug: normalizeSkillSlug(match[1]),
    goal: String(match[2] || "").trim(),
  };
}

/**
 * @param {{ slug?: string, name?: string, triggers?: string[] }[]} skills
 * @param {string} slug
 * @returns {object|null}
 */
export function findSkillBySlash(skills, slug) {
  const norm = normalizeSkillSlug(slug);
  if (!norm) return null;
  for (const skill of skills || []) {
    const candidates = [skill.slug, skill.name];
    for (const c of candidates) {
      if (normalizeSkillSlug(c) === norm) return skill;
    }
  }
  return null;
}
