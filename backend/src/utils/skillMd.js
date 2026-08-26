/**
 * @fileoverview Hermes-style SKILL.md parsing and generation for YamBot skills.
 * Purpose: Dual format — structured Mongo fields plus markdown playbook for LLM injection.
 * Downstream: skills routes, worker prompt formatting, /learn draft generation.
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
 * @param {string} name
 * @returns {string}
 */
export function slugFromName(name) {
  const slug = normalizeSkillSlug(name);
  return slug || "skill";
}

/**
 * @typedef {{ whenToUse: string, procedure: string, pitfalls: string, verification: string, raw: string }} ParsedPlaybook
 */

/**
 * Parses SKILL.md sections (Hermes / agentskills.io style).
 * @param {string} md
 * @returns {ParsedPlaybook}
 */
export function parseSkillMd(md) {
  const raw = String(md || "").trim();
  const sections = {
    whenToUse: "",
    procedure: "",
    pitfalls: "",
    verification: "",
  };
  if (!raw) return { ...sections, raw: "" };

  const headingRe = /^#\s+(.+)$/gim;
  const matches = [...raw.matchAll(headingRe)];
  if (!matches.length) {
    sections.procedure = raw;
    return { ...sections, raw };
  }

  for (let i = 0; i < matches.length; i += 1) {
    const title = String(matches[i][1] || "").trim().toLowerCase();
    const start = (matches[i].index ?? 0) + matches[i][0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? raw.length) : raw.length;
    const body = raw.slice(start, end).trim();
    if (/when to use|usage|trigger/.test(title)) sections.whenToUse = body;
    else if (/procedure|steps|workflow|how/.test(title)) sections.procedure = body;
    else if (/pitfall|warning|caution|gotcha/.test(title)) sections.pitfalls = body;
    else if (/verif|success|check/.test(title)) sections.verification = body;
    else if (!sections.procedure) sections.procedure = body;
  }

  return { ...sections, raw };
}

/**
 * @param {object} skill
 * @returns {string}
 */
export function serializeSkillMd(skill) {
  if (skill?.playbookMd) return String(skill.playbookMd).trim();
  const lines = [`# ${skill?.name || "Skill"}`, ""];
  if (skill?.description) {
    lines.push("## When to use", skill.description, "");
  }
  const steps = Array.isArray(skill?.steps) ? skill.steps : [];
  if (steps.length) {
    lines.push("## Procedure");
    for (const step of steps) {
      if (typeof step === "string") lines.push(`- ${step}`);
      else if (step?.type) lines.push(`- ${JSON.stringify(step)}`);
    }
    lines.push("");
  }
  const rules = skill?.verificationRules || [];
  if (rules.length) {
    lines.push("## Verification");
    for (const rule of rules) lines.push(`- ${rule}`);
  }
  return lines.join("\n").trim();
}

/**
 * @param {object|null} skill
 * @param {{ full?: boolean }} [opts]
 * @returns {string}
 */
export function formatPlaybookForPrompt(skill, opts = {}) {
  if (!skill) return "";
  const full = opts.full !== false;
  const parsed = parseSkillMd(skill.playbookMd || serializeSkillMd(skill));
  const lines = [`PLAYBOOK: ${skill.name}`];
  if (skill.description && !parsed.whenToUse) lines.push(`When: ${skill.description}`);
  if (parsed.whenToUse) lines.push(`When to use:\n${parsed.whenToUse}`);
  if (full) {
    if (parsed.procedure) lines.push(`Procedure:\n${parsed.procedure}`);
    if (parsed.pitfalls) lines.push(`Pitfalls:\n${parsed.pitfalls}`);
    if (parsed.verification) lines.push(`Verification:\n${parsed.verification}`);
  } else {
    lines.push("(Full playbook loads when skill is invoked or matched.)");
  }
  return lines.join("\n\n");
}

/**
 * Builds a draft SKILL.md from a completed task trajectory.
 * @param {object} task
 * @returns {string}
 */
export function trajectoryToPlaybookMd(task) {
  const goal = String(task?.goal || "Workflow").trim();
  const summary = String(task?.resultSummary || "").trim();
  const rows = Array.isArray(task?.trajectory) ? task.trajectory : [];
  const procedureLines = rows.slice(0, 25).map((row, i) => {
    const a = row?.action || {};
    const parts = [a.type || "step"];
    if (a.name) parts.push(`"${a.name}"`);
    if (a.url) parts.push(a.url);
    if (a.text) parts.push(`text: ${String(a.text).slice(0, 80)}`);
    return `${i + 1}. ${parts.join(" ")}`;
  });

  const lines = [
    "# When to use",
    goal,
    "",
    "## Procedure",
    ...(procedureLines.length ? procedureLines : ["1. Review recorded trajectory and refine steps."]),
    "",
    "## Pitfalls",
    "- Confirm login/session before replaying.",
    "- Re-check selectors if the site layout changed.",
    "",
    "## Verification",
    summary ? `- ${summary}` : "- Goal completed without errors.",
  ];
  return lines.join("\n");
}

/**
 * @param {object} task
 * @returns {string[]}
 */
export function trajectoryToStepLines(task) {
  const rows = Array.isArray(task?.trajectory) ? task.trajectory : [];
  return rows
    .map((row) => {
      const a = row?.action || {};
      if (typeof a === "string") return a;
      if (a.type === "type" && a.text) return `Type: ${a.text}`;
      if (a.type === "click" && a.name) return `Click "${a.name}"`;
      if (a.type === "navigate" && a.url) return `Navigate to ${a.url}`;
      if (a.type) return `${a.type}${a.name ? `: ${a.name}` : ""}`;
      return "";
    })
    .filter(Boolean);
}
