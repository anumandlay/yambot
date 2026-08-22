/**
 * @fileoverview Skill templates — lightweight state-machine hints per goal type.
 * Purpose: Phase 5 injects proven flows (login, shopping, email) into the LLM prompt.
 * Downstream: learn.js, agent.js system prompt.
 */

/**
 * @typedef {{ id: string, label: string, triggers: RegExp[], steps: string[], hints: string[] }} SkillTemplate
 */

/** @type {SkillTemplate[]} */
export const SKILL_TEMPLATES = [
  {
    id: "login",
    label: "Login / authentication",
    triggers: [/log\s*in|sign\s*in|authenticate|sso|password/i, /\/login|\/signin|\/auth/i],
    steps: [
      "Navigate to login page if not already there",
      "fill_form with email/username and password fields",
      "Click Sign in / Continue (ask_user if askBeforeLogin)",
      "wait_for authenticated state or dashboard URL",
    ],
    hints: [
      "Prefer fill_form over individual type actions when both fields are visible.",
      "If MFA appears, use ask_user or check_email for the code.",
      "Do not loop re-entering credentials after a failed attempt — read errors first.",
    ],
  },
  {
    id: "shopping",
    label: "Shopping / checkout",
    triggers: [/cart|checkout|buy|purchase|add to (cart|bag)|basket/i],
    steps: [
      "Open cart/basket from header icon or /cart URL on same host",
      "Review items; proceed to checkout",
      "fill_form for shipping/payment only when autonomy allows",
      "ask_user before final purchase/submit",
    ],
    hints: [
      "Open Cart/Basket FIRST — do not browse unrelated products.",
      "Use dismiss_dialog for cookie banners and promo modals.",
      "Stop at payment boundary unless user explicitly authorized purchase.",
    ],
  },
  {
    id: "email",
    label: "Email compose / inbox",
    triggers: [/gmail|outlook|compose|inbox|send email|reply/i],
    steps: [
      "Open compose or reply",
      "fill_form To/Subject/Body or type into contenteditable body",
      "ask_user before Send if askBeforeSubmit",
    ],
    hints: [
      "Prefer send_email action when SMTP identity is configured.",
      "Gmail body is contenteditable — use type on Message body ref.",
      "check_email for verification codes before ask_user.",
    ],
  },
  {
    id: "research",
    label: "Web research",
    triggers: [/research|compare|find|list|summarize|review sites/i],
    steps: [
      "Open promising result links",
      "extract key facts per page",
      "finish with structured summary + URLs",
    ],
    hints: [
      "Extract before navigating away from a useful page.",
      "Use open_tab for parallel comparison when helpful.",
    ],
  },
];

/**
 * Detects the best-matching skill for a goal + URL.
 * @param {string} goal
 * @param {string} [url]
 * @returns {SkillTemplate|null}
 */
export function detectSkill(goal, url = "") {
  const blob = `${goal} ${url}`.toLowerCase();
  let best = null;
  let bestScore = 0;
  for (const skill of SKILL_TEMPLATES) {
    let score = 0;
    for (const re of skill.triggers) {
      if (re.test(blob)) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = skill;
    }
  }
  return bestScore > 0 ? best : null;
}

/**
 * @param {SkillTemplate|null} skill
 * @returns {string}
 */
export function formatSkillBlock(skill) {
  if (!skill) return "";
  const lines = [`ACTIVE SKILL: ${skill.label} (${skill.id})`];
  if (skill.steps?.length) {
    lines.push("Suggested flow:");
    for (const s of skill.steps) lines.push(`  ${skill.steps.indexOf(s) + 1}. ${s}`);
  }
  if (skill.hints?.length) {
    lines.push("Hints:");
    for (const h of skill.hints) lines.push(`  - ${h}`);
  }
  return lines.join("\n");
}

/**
 * Estimates which skill step the agent is on from history + page.
 * @param {SkillTemplate|null} skill
 * @param {object[]} history
 * @param {object} [obs]
 * @returns {{ current: number, total: number, label: string }|null}
 */
export function computeSkillProgress(skill, history, obs) {
  if (!skill?.steps?.length) return null;
  const total = skill.steps.length;
  let score = 0;
  const types = new Set((history || []).map((h) => h.action?.type).filter(Boolean));
  const url = String(obs?.url || "").toLowerCase();

  if (skill.id === "login") {
    if (/login|signin|auth|account/.test(url)) score = 1;
    if (types.has("fill_form") || types.has("type")) score = Math.max(score, 2);
    if (types.has("click") && history.some((h) => /sign|log|continue/i.test(h.action?.name || ""))) {
      score = Math.max(score, 3);
    }
    if (types.has("finish")) score = total;
  } else if (skill.id === "shopping") {
    if (/cart|basket|bag|checkout/.test(url)) score = 1;
    if (types.has("click") && history.some((h) => /checkout|proceed/i.test(h.action?.name || ""))) {
      score = Math.max(score, 2);
    }
    if (types.has("fill_form")) score = Math.max(score, 3);
    if (types.has("finish")) score = total;
  } else if (skill.id === "email") {
    if (/mail|compose|inbox/.test(url)) score = 1;
    if (types.has("type") || types.has("fill_form") || types.has("send_email")) score = 2;
    if (types.has("finish")) score = total;
  } else if (skill.id === "research") {
    score = Math.min(total - 1, Math.floor((history?.length || 0) / 4));
    if (types.has("finish")) score = total;
  }

  const current = Math.min(Math.max(score, 1), total);
  return { current, total, label: skill.steps[current - 1] || skill.steps[0] };
}

/**
 * @param {{ current: number, total: number, label: string }|null} progress
 * @returns {string}
 */
export function formatSkillProgressBlock(progress) {
  if (!progress) return "";
  return `SKILL PROGRESS: step ${progress.current}/${progress.total} — ${progress.label}`;
}
