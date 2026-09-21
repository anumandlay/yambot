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

/** Too generic to be useful triggers / title tokens (cause false matches). */
const GENERIC_SKILL_TOKENS = new Set(
  "navigate filter extract report total details safe worker instructions concrete open click type page list check again log login sign password goal ack optional short status sentence thats https http www com agency admin".split(
    " "
  )
);

/** Mail hosts / auth words that must never become match triggers. */
const CREDENTIAL_SKILL_TOKENS = new Set(
  "gmail yahoo hotmail outlook icloud protonmail proton mail email password passwd secret token credential".split(
    " "
  )
);

/**
 * Strip emails, password assignments, and long digit secrets before tokenization.
 * @param {string} text
 * @returns {string}
 */
export function scrubCredentialText(text) {
  return String(text || "")
    .replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/gi, " ")
    .replace(/\b(password|passwd|pwd)\s*[:=]?\s*\S+/gi, " ")
    .replace(/\b\d{6,}\b/g, " ");
}

/**
 * @param {string} tok
 * @returns {boolean}
 */
export function isCredentialOrPiiToken(tok) {
  const t = String(tok || "")
    .toLowerCase()
    .trim();
  if (!t) return true;
  if (t.includes("@")) return true;
  if (CREDENTIAL_SKILL_TOKENS.has(t)) return true;
  if (/^\d{5,}$/.test(t)) return true;
  if (/^(password|passwd|secret|token)$/i.test(t)) return true;
  return false;
}

/**
 * Local-parts of emails in text (e.g. ayamunesh from ayamunesh@gmail.com).
 * @param {string} text
 * @returns {string[]}
 */
export function extractEmailLocalParts(text) {
  /** @type {string[]} */
  const parts = [];
  const re = /\b([\w.+-]+)@[\w.-]+\.\w+\b/gi;
  let m;
  while ((m = re.exec(String(text || "")))) {
    const local = String(m[1] || "")
      .toLowerCase()
      .split(/[.+]/)[0];
    if (local.length >= 4) parts.push(local);
  }
  return [...new Set(parts)];
}

/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractSignificantTokens(text) {
  const bannedLocals = new Set(extractEmailLocalParts(text));
  return scrubCredentialText(text)
    .toLowerCase()
    .replace(/https?:\/\/[^\s]+/gi, " ")
    .replace(/[^a-z0-9.\s-]+/g, " ")
    .split(/[\s._-]+/)
    .map((t) => t.trim())
    .filter(
      (t) =>
        t.length >= 4 &&
        !STOP.has(t) &&
        !GENERIC_SKILL_TOKENS.has(t) &&
        !isCredentialOrPiiToken(t) &&
        !bannedLocals.has(t) &&
        !/^\d+$/.test(t)
    );
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
 * Goals that are Auto placeholders / meta, not real workflows.
 * @param {string} goal
 * @returns {boolean}
 */
export function isPlaceholderSkillGoal(goal) {
  const g = String(goal || "").trim();
  if (!g) return true;
  if (/<[^>\n]{2,80}>/.test(g)) return true;
  if (/\bconcrete worker instructions\b/i.test(g)) return true;
  if (/\bworker instructions\b/i.test(g) && g.length < 80) return true;
  if (/\bthat'?s safe\b/i.test(g) && g.length < 120) return true;
  if (/^(goal|ack)\s*:/i.test(g)) return true;
  if (/\boptional short (status )?sentence\b/i.test(g)) return true;
  if (/^\.{2,}\s*$/.test(g) || g === "...") return true;
  if (/^log in,\s*navigate,\s*filter/i.test(g)) return true;
  return false;
}

/**
 * Prefer the human-facing goal over Auto/worker rewrites for learning.
 * @param {object} task
 * @returns {string}
 */
export function resolveGoalForSkillLearn(task) {
  const events = Array.isArray(task?.events) ? task.events : [];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const uf = String(events[i]?.payload?.userFacingGoal || "").trim();
    if (uf.length >= 18 && !isPlaceholderSkillGoal(uf)) return uf;
  }
  const metaGoal = String(task?.meta?.userFacingGoal || "").trim();
  if (metaGoal.length >= 18 && !isPlaceholderSkillGoal(metaGoal)) return metaGoal;
  return String(task?.goal || "").trim();
}

/**
 * Short human title for the skill.
 * @param {string} goal
 * @returns {string}
 */
export function skillTitleFromGoal(goal) {
  let g = scrubCredentialText(goal)
    .replace(/\s+/g, " ")
    .trim();
  const pin = g.search(/\bACTIVE USER MESSAGE\b/i);
  if (pin > 24) g = g.slice(0, pin).trim();
  g = g.replace(/\bagain\b/gi, "").replace(/\s+/g, " ").trim();
  g = g.replace(/\.\s*that'?s safe\.?\s*$/i, ".").trim();
  if (g.length > 90) g = `${g.slice(0, 87)}…`;
  return g || "Learned workflow";
}

/**
 * Drop credential/PII triggers (email hosts, passwords, digit secrets).
 * @param {string[]} triggers
 * @returns {string[]}
 */
export function sanitizeSkillTriggers(triggers, bannedExtras = []) {
  const banned = new Set(
    (bannedExtras || []).map((t) => String(t || "").toLowerCase()).filter(Boolean)
  );
  const out = [];
  for (const raw of triggers || []) {
    const pat = String(raw || "").trim();
    if (!pat) continue;
    if (isCredentialTrigger(pat)) continue;
    const parts = pat
      .toLowerCase()
      .replace(/\\\./g, ".")
      .split(/[\s@._-]+/)
      .filter(Boolean);
    if (parts.some((p) => banned.has(p))) continue;
    out.push(pat);
  }
  return [...new Set(out)].slice(0, 12);
}

/**
 * @param {string} pat
 * @returns {boolean}
 */
export function isCredentialTrigger(pat) {
  const raw = String(pat || "")
    .toLowerCase()
    .replace(/\\\./g, ".");
  if (!raw) return true;
  if (raw.includes("@")) return true;
  if (isDomainTriggerPat(raw)) return false;
  const parts = raw.split(/[\s@._-]+/).filter(Boolean);
  if (!parts.length) return true;
  // Why: "ayamunesh gmail" / "gmail 12345678" must not score matches.
  if (parts.some((p) => isCredentialOrPiiToken(p))) return true;
  if (/^\d{5,}$/.test(raw.replace(/\s+/g, ""))) return true;
  return false;
}

/**
 * @param {string} raw
 * @returns {boolean}
 */
function isDomainTriggerPat(raw) {
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(String(raw || ""));
}

/**
 * Trigger patterns for matching future goals (regex-safe substrings).
 * @param {string} goal
 * @param {string} [domain]
 * @returns {string[]}
 */
export function buildTriggersFromGoal(goal, domain = "") {
  const out = [];
  const bannedLocals = extractEmailLocalParts(goal);
  const d = String(domain || extractDomainFromText(goal) || "").trim();
  if (d) out.push(d.replace(/\./g, "\\."));
  const words = scrubCredentialText(goal)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .split(/\s+/)
    .filter(
      (w) =>
        w.length >= 4 &&
        !STOP.has(w) &&
        !GENERIC_SKILL_TOKENS.has(w) &&
        !isCredentialOrPiiToken(w) &&
        !bannedLocals.includes(w)
    );
  for (let i = 0; i < words.length - 1 && out.length < 8; i += 1) {
    const bigram = `${words[i]} ${words[i + 1]}`;
    if (bigram.length >= 8) out.push(bigram.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  }
  for (const t of extractSignificantTokens(goal)) {
    if (out.length >= 10) break;
    if (!out.some((x) => x.toLowerCase() === t)) out.push(t);
  }
  return sanitizeSkillTriggers(out, bannedLocals).slice(0, 10);
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
  if (isPlaceholderSkillGoal(g)) return false;
  if (/^(hi|hello|hey|thanks|thank you|ok|okay)\b/i.test(g)) return false;
  if (/^\s*remember\b/i.test(g) && g.length < 100) return false;
  if (/^open\s+\S+\s*$/i.test(g)) return false;
  if (extractSignificantTokens(g).length < 1) return false;
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
  const goal = resolveGoalForSkillLearn(task);
  if (!shouldLearnSkillFromGoal(goal)) return null;

  const durable = extractDurableStepsFromTask(task);
  if (durable.length < 2) return null;

  const domain = String(opts.siteDomain || extractDomainFromText(goal) || "").trim();
  const workflowKey = buildWorkflowKey(goal, domain);
  if (!workflowKey) return null;

  const triggers = buildTriggersFromGoal(goal, domain);
  const contentTriggers = triggers.filter((t) => !String(t).includes("\\."));
  if (contentTriggers.length < 1 && extractSignificantTokens(goal).length < 2) {
    return null;
  }

  const name = skillTitleFromGoal(goal);
  const playbookMd = [
    "# When to use",
    goal.slice(0, 500),
    domain ? `\nDomain: ${domain}` : "",
    "",
    "## Procedure",
    ...durable.map((s, i) => `${i + 1}. ${s}`),
    "",
    "## Pitfalls",
    "- Prefer named controls (role + name) over ephemeral refs like e12.",
    "- Re-login if the session expired.",
    "- Follow Suggested flow when the same UI is visible; skip steps that do not apply.",
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
    const merged = sanitizeSkillTriggers(
      [...(skill.triggers || []), ...triggers],
      extractEmailLocalParts(`${goal} ${skill.name || ""} ${skill.playbookMd || ""}`)
    );
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
