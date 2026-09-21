/**
 * @fileoverview Learn reusable Skills from successful browser runs (Hermes-style).
 * Purpose: After a multi-step success, upsert one production skill per agent+workflow
 * (durable named steps + triggers) so the next similar goal matches — without flooding
 * Suggested:* drafts. Downstream: worker task complete; Skills page; detectDbSkillMatch.
 */

import { Skill } from "../models/Skill.js";
import { Message } from "../models/Chat.js";
import { allocateSkillSlug } from "./skillLearn.js";

const STOP = new Set(
  "a an the and or for to of in on at by with from into over again also just please can you me my we our your this that those these is are was were be been being do does did doing have has had will would should could may might must not no yes ok hey hi hello thanks thank".split(
    " "
  )
);

/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractSignificantTokens(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/https?:\/\/[^\s]+/gi, " ")
    .replace(/[^a-z0-9.\s-]+/g, " ")
    .split(/[\s._-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 4 && !STOP.has(t) && !/^\d+$/.test(t));
}

/**
 * @param {string} text
 * @returns {string}
 */
export function extractDomainFromText(text) {
  const m = String(text || "").match(
    /(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i
  );
  return m ? String(m[1]).toLowerCase().replace(/^www\./, "") : "";
}

/**
 * Stable key so repeat goals upsert one skill instead of N drafts.
 * @param {string} goal
 * @param {string} [domain]
 * @returns {string}
 */
export function buildWorkflowKey(goal, domain = "") {
  const d = String(domain || extractDomainFromText(goal) || "")
    .toLowerCase()
    .trim();
  const tokens = [...new Set(extractSignificantTokens(goal))].sort().slice(0, 8);
  if (!tokens.length && !d) return "";
  return `${d}|${tokens.join("-")}`.slice(0, 140);
}

/**
 * Short human title for the skill.
 * @param {string} goal
 * @returns {string}
 */
export function skillTitleFromGoal(goal) {
  let g = String(goal || "")
    .replace(/\s+/g, " ")
    .trim();
  g = g.replace(/\bagain\b/gi, "").replace(/\s+/g, " ").trim();
  if (g.length > 90) g = `${g.slice(0, 87)}…`;
  return g || "Learned workflow";
}

/**
 * Trigger patterns for matching future goals (regex-safe substrings).
 * @param {string} goal
 * @param {string} [domain]
 * @returns {string[]}
 */
export function buildTriggersFromGoal(goal, domain = "") {
  const out = [];
  const d = String(domain || extractDomainFromText(goal) || "").trim();
  if (d) out.push(d.replace(/\./g, "\\."));
  const tokens = extractSignificantTokens(goal);
  // Prefer 2-grams from original order for phrases like "trial expiring"
  const words = String(goal || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));
  for (let i = 0; i < words.length - 1 && out.length < 8; i += 1) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    if (bigram.length >= 8) out.push(bigram.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
  for (const t of tokens) {
    if (out.length >= 10) break;
    if (!out.some((x) => x.toLowerCase() === t)) out.push(t);
  }
  return [...new Set(out)].slice(0, 10);
}

/**
 * Durable procedure lines — named UI / URLs only (no ephemeral e12 refs / secrets).
 * @param {object} task
 * @returns {string[]}
 */
export function extractDurableStepsFromTask(task) {
  const rows = Array.isArray(task?.trajectory) ? task.trajectory : [];
  /** @type {string[]} */
  const out = [];
  for (const row of rows) {
    const a = row?.action || {};
    const type = String(a.type || "").toLowerCase();
    if (!type || /^(wait|finish|memory|extract|observe|thinking|ask_user)$/i.test(type)) {
      continue;
    }
    if (type === "navigate" && a.url) {
      out.push(`Navigate to ${String(a.url).slice(0, 180)}`);
      continue;
    }
    if (type === "click") {
      const name = String(a.name || "").trim();
      const role = String(a.role || "").trim();
      if (name) {
        out.push(`Click ${role || "control"} "${name}"`);
        continue;
      }
    }
    if (type === "type" || type === "fill") {
      const name = String(a.name || a.label || "").trim();
      // Why: never persist passwords / long secrets into skill steps.
      const text = String(a.text || "");
      if (/password|passwd|secret|token/i.test(name) || /password|passwd/i.test(type)) {
        if (name) out.push(`Type credentials into "${name}"`);
        continue;
      }
      if (name && text.length && text.length <= 40) {
        out.push(`Type "${text}" into "${name}"`);
      } else if (name) {
        out.push(`Type into "${name}"`);
      }
      continue;
    }
    if ((type === "select" || type === "choose" || type === "choose_searchable") && a.name) {
      const val = String(a.value || a.query || a.text || "").trim();
      out.push(
        val
          ? `Select "${val}" in "${a.name}"`
          : `Open selector "${a.name}"`
      );
      continue;
    }
    if (type === "press_key" && a.key) {
      out.push(`Press key ${a.key}`);
    }
  }
  // Dedupe consecutive identical lines.
  return out.filter((line, i, arr) => line && line !== arr[i - 1]).slice(0, 20);
}

/**
 * @param {string} goal
 * @returns {boolean}
 */
export function shouldLearnSkillFromGoal(goal) {
  const g = String(goal || "").trim();
  if (g.length < 18) return false;
  if (/^(hi|hello|hey|thanks|thank you|ok|okay)\b/i.test(g)) return false;
  if (/^\s*remember\b/i.test(g) && g.length < 100) return false;
  if (/^open\s+\S+\s*$/i.test(g)) return false;
  return true;
}

/**
 * Upsert a production skill from a successful multi-step run.
 * @param {{
 *   userId: string,
 *   task: object,
 *   success: boolean,
 *   summary?: string,
 *   siteDomain?: string,
 * }} opts
 * @returns {Promise<{ skill: object, created: boolean, updated: boolean }|null>}
 */
export async function learnSkillFromSuccessfulRun(opts) {
  const { userId, task, success } = opts;
  if (!success || !userId || !task) return null;
  const goal = String(task.goal || "").trim();
  if (!shouldLearnSkillFromGoal(goal)) return null;

  const durable = extractDurableStepsFromTask(task);
  if (durable.length < 2) return null;

  const domain = String(opts.siteDomain || extractDomainFromText(goal) || "").trim();
  const workflowKey = buildWorkflowKey(goal, domain);
  if (!workflowKey) return null;

  const triggers = buildTriggersFromGoal(goal, domain);
  const name = skillTitleFromGoal(goal);
  const playbookMd = [
    "# When to use",
    goal,
    domain ? `\nDomain: ${domain}` : "",
    "",
    "## Procedure",
    ...durable.map((s, i) => `${i + 1}. ${s}`),
    "",
    "## Pitfalls",
    "- Prefer named controls (role + name) over ephemeral refs like e12.",
    "- Re-login if the session expired.",
    "",
    "## Verification",
    opts.summary
      ? `- ${String(opts.summary).slice(0, 400)}`
      : "- Goal completed successfully.",
  ]
    .filter((l) => l != null)
    .join("\n");

  const agentId = task.agent || null;
  let skill = null;
  if (workflowKey) {
    skill = await Skill.findOne({
      user: userId,
      workflowKey,
      ...(agentId ? { agent: agentId } : {}),
    });
  }
  if (!skill && agentId) {
    // Fallback: same agent + overlapping trigger bigram.
    const bigrams = triggers.filter((t) => t.includes(" "));
    if (bigrams.length) {
      skill = await Skill.findOne({
        user: userId,
        agent: agentId,
        status: { $in: ["production", "draft", "training"] },
        triggers: { $in: bigrams },
      }).sort({ updatedAt: -1 });
    }
  }

  let created = false;
  let updated = false;
  if (!skill) {
    const slug = await allocateSkillSlug(userId, name, "");
    skill = await Skill.create({
      user: userId,
      agent: agentId,
      name,
      slug,
      description: `Learned from successful run${domain ? ` on ${domain}` : ""}.`,
      playbookMd,
      status: "production",
      triggers,
      steps: durable,
      executionMode: "hints",
      verificationRules: ["Goal completed successfully"],
      sourceTask: task._id,
      workflowKey,
      stats: { runs: 1, successes: 1, failures: 0 },
    });
    created = true;
  } else {
    skill.name = name.slice(0, 120);
    skill.description = `Learned from successful run${domain ? ` on ${domain}` : ""}.`;
    skill.playbookMd = playbookMd;
    skill.steps = durable;
    skill.executionMode = "hints";
    skill.status = "production";
    skill.workflowKey = workflowKey || skill.workflowKey;
    skill.sourceTask = task._id;
    const merged = [...new Set([...(skill.triggers || []), ...triggers])].slice(0, 12);
    skill.triggers = merged;
    skill.stats = skill.stats || {};
    skill.stats.runs = (skill.stats.runs || 0) + 1;
    skill.stats.successes = (skill.stats.successes || 0) + 1;
    await skill.save();
    updated = true;
  }

  if (task.chat) {
    try {
      const verb = created ? "Skill learned" : "Skill updated";
      await Message.create({
        chat: task.chat,
        role: "system",
        content: [
          `${verb} · ${skill.name}`,
          `Triggers: ${(skill.triggers || []).slice(0, 5).join(", ") || "(none)"}`,
          `Procedure: ${durable.length} durable steps`,
          `Status: production — next similar goals can match this skill.`,
          "",
          durable.map((s, i) => `${i + 1}. ${s}`).join("\n"),
        ].join("\n"),
        meta: {
          kind: "skill_learned",
          ui: "icon",
          taskId: task._id,
          skillLearned: {
            skillId: String(skill._id),
            name: skill.name,
            slug: skill.slug,
            created,
            updated,
            triggers: skill.triggers || [],
            steps: durable,
            workflowKey,
          },
        },
      });
    } catch {
      /* non-fatal */
    }
  }

  return { skill, created, updated };
}
