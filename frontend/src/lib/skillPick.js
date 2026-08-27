/**
 * @fileoverview Skill pick helpers — extract which skill loaded and why from messages/tasks.
 * Purpose: Chat thread and active-run bar read the same shape from user meta or worker events.
 */

/** @typedef {{ source: string, skillId?: string, skillName?: string, slug?: string, templateId?: string, reason?: string, matchedTriggers?: string[] }} SkillPick */

/** Human labels for worker `skill_selected` source values. */
export const SKILL_PICK_SOURCE_LABELS = {
  slash: "Slash invoke",
  trigger: "Trigger match",
  template: "Built-in template",
  none: "No skill",
};

/**
 * @param {string} [source]
 * @returns {string}
 */
export function skillPickSourceLabel(source) {
  return SKILL_PICK_SOURCE_LABELS[source] || source || "Unknown";
}

/**
 * Reads skill pick metadata from a chat message (user slash meta or system skill_selected).
 * @param {object|null|undefined} message
 * @returns {SkillPick|null}
 */
export function skillPickFromMessage(message) {
  if (!message?.meta) return null;
  if (message.meta.skillPick && typeof message.meta.skillPick === "object") {
    return message.meta.skillPick;
  }
  if (message.meta.invokedSkillName) {
    const slug = message.meta.skillSlug || "";
    return {
      source: message.meta.pickSource || "slash",
      skillId: message.meta.invokedSkillId ? String(message.meta.invokedSkillId) : undefined,
      skillName: message.meta.invokedSkillName,
      slug: slug || undefined,
      reason:
        message.meta.pickReason ||
        (slug
          ? `You typed /${slug} in the goal (explicit slash invoke).`
          : "Skill invoked from chat."),
    };
  }
  return null;
}

/**
 * Latest `skill_selected` event payload on a task (set when the worker starts the run).
 * @param {object|null|undefined} task
 * @returns {SkillPick|null}
 */
export function skillPickFromTask(task) {
  const events = task?.events;
  if (!Array.isArray(events) || !events.length) return null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev?.type === "skill_selected" && ev.payload && typeof ev.payload === "object") {
      return ev.payload;
    }
  }
  return null;
}
