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
      "Batch type email/username then password (do not use fill_form)",
      "Click Sign in / Continue (ask_user if askBeforeLogin)",
      "Act on the next snapshot after submit (do not invent wait_for text)",
    ],
    hints: [
      "Use one actions batch: type email → type password → click Sign in.",
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
      "Type shipping/payment fields in one batch only when autonomy allows",
      "ask_user before final purchase/submit",
    ],
    hints: [
      "Open Cart/Basket FIRST — do not browse unrelated products.",
      "Use dismiss_dialog for cookie banners and promo modals.",
      "Stop at payment boundary unless user explicitly authorized purchase.",
      "Do not wait_for invented phrases like Added to cart — use the live snapshot.",
    ],
  },
  {
    id: "email",
    label: "Email compose / inbox",
    triggers: [/gmail|outlook|compose|inbox|send email|reply/i],
    steps: [
      "Open compose or reply",
      "Batch type To/Subject/Body (contenteditable body uses type)",
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
  return (
    `SKILL PROGRESS: step ${progress.current}/${progress.total} — do this next: ${progress.label}` +
    (progress.doneCount
      ? ` (${progress.doneCount} skill step(s) already reflected in history)`
      : "")
  );
}

/**
 * Normalizes stored skill steps (strings or action objects) for prompt display.
 * @param {unknown[]} steps
 * @returns {string[]}
 */
export function normalizeSkillSteps(steps) {
  return (steps || []).map((s) => {
    if (typeof s === "string") return s.trim();
    if (!s || typeof s !== "object") return String(s || "").trim();
    const action = /** @type {{ type?: string, name?: string, text?: string, url?: string }} */ (s);
    if (action.type) {
      const parts = [action.type];
      if (action.name) parts.push(`"${action.name}"`);
      if (action.text) parts.push(`text: ${action.text}`);
      if (action.url) parts.push(`url: ${action.url}`);
      return parts.join(" ");
    }
    return JSON.stringify(s);
  }).filter(Boolean);
}

/**
 * Strip emails / password literals before match tokenization.
 * @param {string} text
 * @returns {string}
 */
function scrubCredentialText(text) {
  return String(text || "")
    .replace(/\b[\w.+-]+@[\w.-]+\.\w+\b/gi, " ")
    .replace(/\b(password|passwd|pwd)\s*[:=]?\s*\S+/gi, " ")
    .replace(/\b\d{6,}\b/g, " ");
}

/**
 * @param {string} text
 * @returns {string[]}
 */
function extractEmailLocalParts(text) {
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
 * @param {string} tok
 * @returns {boolean}
 */
function isCredentialOrPiiToken(tok) {
  const t = String(tok || "")
    .toLowerCase()
    .trim();
  if (!t) return true;
  if (t.includes("@")) return true;
  if (
    /^(gmail|yahoo|hotmail|outlook|icloud|protonmail|proton|mail|email|password|passwd|secret|token|credential)$/.test(
      t
    )
  ) {
    return true;
  }
  if (/^\d{5,}$/.test(t)) return true;
  return false;
}

/**
 * Tokens too generic for skill/workflow overlap (would match any "open …" goal).
 * Why: trial-expiring skills were winning register goals via open/vughy overlap alone.
 */
const SKILL_GENERIC_TOKENS = new Set(
  "a an the and or for to of in on at by with from into over again also just please can you me my we our your this that those these is are was were be been being do does did doing have has had will would should could may might must not no yes ok hey hi hello thanks thank navigate filter extract report total details safe worker instructions concrete open click type page list check log login sign password goal ack https http www com agency admin apply using site same next then after before when while more less than onto unto about between without within".split(
    " "
  )
);

/**
 * Significant tokens for skill match (mirrors backend skillWorkflowLearn).
 * @param {string} text
 * @returns {string[]}
 */
function skillMatchTokens(text) {
  const bannedLocals = new Set(extractEmailLocalParts(text));
  return scrubCredentialText(text)
    .toLowerCase()
    .replace(/https?:\/\/[^\s]+/gi, " ")
    .replace(/[^a-z0-9.\s-]+/g, " ")
    .split(/[\s._|/-]+/)
    .map((t) => t.trim())
    .filter(
      (t) =>
        t.length >= 4 &&
        !SKILL_GENERIC_TOKENS.has(t) &&
        !isCredentialOrPiiToken(t) &&
        !bannedLocals.has(t) &&
        !/^\d+$/.test(t)
    );
}

/**
 * Goal/skill intent families used to reject cross-workflow matches.
 * @param {string} text
 * @returns {{ register: boolean, trialAdmin: boolean }}
 */
export function skillIntentFlags(text) {
  const blob = String(text || "");
  return {
    register:
      /sign\s*up|register|create\s+(an?\s+)?account|onboard|join\s+(as|now)|new\s+account|travel\s+agency/i.test(
        blob
      ),
    trialAdmin:
      /trial[- ]?expir|days?\s*left|super\s*admin|admin\s*login|\/agency\/login|filter.*india|india.*filter|extract.*(account|row|email)|trial\s+expiring/i.test(
        blob
      ),
  };
}

/**
 * True when goal and skill describe opposite workflows (e.g. register vs trial-expiring).
 * @param {string} goal
 * @param {object} skill
 * @returns {boolean}
 */
export function skillIntentConflicts(goal, skill) {
  const goalFlags = skillIntentFlags(goal);
  const skillBlob = [
    skill?.name,
    skill?.description,
    skill?.slug,
    skill?.workflowKey,
    ...(Array.isArray(skill?.triggers) ? skill.triggers : []),
    ...(Array.isArray(skill?.steps)
      ? skill.steps.map((s) => (typeof s === "string" ? s : s?.text || s?.label || ""))
      : []),
  ]
    .filter(Boolean)
    .join("\n");
  const skillFlags = skillIntentFlags(skillBlob);
  if (goalFlags.register && skillFlags.trialAdmin && !skillFlags.register) return true;
  if (goalFlags.trialAdmin && skillFlags.register && !goalFlags.register) return true;
  return false;
}

/**
 * @param {string} pat
 * @returns {boolean}
 */
function isDomainTrigger(pat) {
  const raw = String(pat || "").replace(/\\\./g, ".");
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(raw);
}

/**
 * Skip email/password triggers left on older skills.
 * @param {string} pat
 * @returns {boolean}
 */
function isCredentialTrigger(pat) {
  const raw = String(pat || "")
    .toLowerCase()
    .replace(/\\\./g, ".");
  if (!raw) return true;
  if (raw.includes("@")) return true;
  if (isDomainTrigger(pat)) return false;
  const parts = raw.split(/[\s@._-]+/).filter(Boolean);
  if (parts.some((p) => isCredentialOrPiiToken(p))) return true;
  if (/^\d{5,}$/.test(raw.replace(/\s+/g, ""))) return true;
  return false;
}

/**
 * Matches production skills against goal + URL using triggers, workflowKey overlap, and name tokens.
 * Why: domain-only hits are too broad (every Vughy visit); require content signal or key overlap.
 * @param {object[]} skills
 * @param {string} goal
 * @param {string} [url]
 * @returns {{ skill: object, matchedTriggers: string[], score: number, reason: string }|null}
 */
export function detectDbSkillMatch(skills, goal, url = "") {
  const blob = `${goal} ${url}`;
  const blobLower = blob.toLowerCase();
  const goalTokens = new Set(skillMatchTokens(goal));
  let best = null;
  let bestScore = 0;
  let bestTriggers = [];
  let bestReason = "";

  for (const skill of skills || []) {
    // Why: register goals must not load trial-expiring/admin-login playbooks (and vice versa).
    if (skillIntentConflicts(goal, skill)) continue;

    const triggers = skill.triggers || [];
    const matchedTriggers = [];
    let score = 0;
    let domainHit = false;
    let contentTriggerHits = 0;

    for (const trigger of triggers) {
      const pat = String(trigger || "").trim();
      if (!pat || isCredentialTrigger(pat)) continue;
      let hit = false;
      try {
        hit = new RegExp(pat, "i").test(blob);
      } catch {
        hit = blobLower.includes(pat.toLowerCase());
      }
      if (!hit) continue;
      if (isDomainTrigger(pat)) {
        domainHit = true;
        score += 0.4;
        continue;
      }
      matchedTriggers.push(pat);
      contentTriggerHits += 1;
      score += pat.includes(" ") ? 2.5 : 1.5;
    }

    const keyParts = String(skill.workflowKey || "")
      .toLowerCase()
      .split(/[|.-]+/)
      .filter(
        (t) =>
          t.length >= 4 &&
          !SKILL_GENERIC_TOKENS.has(t) &&
          !isCredentialOrPiiToken(t) &&
          !/^(gmail|yahoo|hotmail|agency|admin|https|http)$/.test(t)
      );
    let keyOverlap = 0;
    for (const t of keyParts) {
      // Why: only count goal tokens — blobLower.includes("open") matched every "open vughy…" goal.
      if (goalTokens.has(t)) keyOverlap += 1;
    }
    if (keyOverlap) score += keyOverlap * 1.25;
    if (keyParts.length >= 2 && keyOverlap / keyParts.length >= 0.4) score += 2;

    const hay = skillMatchTokens(
      `${skill.name || ""} ${skill.description || ""} ${skill.slug || ""}`
    ).slice(0, 12);
    let nameHits = 0;
    for (const tok of hay) {
      if (goalTokens.has(tok)) {
        nameHits += 1;
        score += 0.7;
      }
    }

    const contentSignal = contentTriggerHits > 0 || keyOverlap >= 2 || nameHits >= 2;
    if (!contentSignal) continue;
    if (score < 2) continue;

    if (score > bestScore) {
      bestScore = score;
      best = skill;
      bestTriggers = matchedTriggers;
      const bits = [];
      if (matchedTriggers.length) {
        bits.push(`triggers ${matchedTriggers.map((t) => `"${t}"`).join(", ")}`);
      }
      if (keyOverlap >= 2) bits.push(`workflow overlap ${keyOverlap}`);
      if (nameHits >= 2) bits.push(`name tokens ${nameHits}`);
      if (domainHit) bits.push("same domain");
      bestReason = bits.join(" · ") || `score ${score.toFixed(1)}`;
    }
  }

  if (!best) return null;
  return {
    skill: best,
    matchedTriggers: bestTriggers,
    score: bestScore,
    reason: bestReason,
  };
}

/**
 * Matches a production skill from MongoDB against goal text + URL using trigger patterns.
 * @param {object[]} skills
 * @param {string} goal
 * @param {string} [url]
 * @returns {object|null}
 */
export function detectDbSkill(skills, goal, url = "") {
  return detectDbSkillMatch(skills, goal, url)?.skill || null;
}

/**
 * @param {object|null} skill
 * @returns {string}
 */
export function formatDbSkillBlock(skill) {
  if (!skill) return "";
  const steps = normalizeSkillSteps(skill.steps);
  const lines = [
    `ACTIVE SKILL (learned): ${skill.name}`,
    "SKILL STEERING (mandatory when controls match):",
    "- Execute Suggested flow in order — do not invent a different path for the same site/workflow.",
    "- Each turn: prefer the current Suggested flow step (see SKILL PROGRESS) as your primary actions.",
    "- Skip a step only if that control is absent or already done; then continue with the next step.",
    "- Do not switch sites unless the goal says so.",
  ];
  if (skill.slug) lines.push(`Invoke: /${skill.slug}`);
  if (skill.description) lines.push(String(skill.description));
  if (steps.length) {
    lines.push("Suggested flow:");
    for (let i = 0; i < steps.length; i += 1) {
      lines.push(`  ${i + 1}. ${steps[i]}`);
    }
  }
  if (skill.executionMode === "replay") {
    lines.push("Execution: deterministic replay of stored demo actions before the agent loop.");
  }
  if (skill.playbookMd) {
    lines.push(parsePlaybookSections(skill.playbookMd));
  }
  if (skill.verificationRules?.length) {
    lines.push("Verify:");
    for (const rule of skill.verificationRules) lines.push(`  - ${rule}`);
  }
  return lines.join("\n");
}

/**
 * Lightweight SKILL.md section extraction for worker prompts.
 * @param {string} md
 * @returns {string}
 */
function parsePlaybookSections(md) {
  const raw = String(md || "").trim();
  if (!raw) return "";
  const chunks = [];
  const when = raw.match(/#\s*when to use[\s\S]*?(?=\n#\s|\n##\s|$)/i);
  const proc = raw.match(/#\s*procedure[\s\S]*?(?=\n#\s|\n##\s|$)/i);
  const pitfalls = raw.match(/#\s*pitfall[\s\S]*?(?=\n#\s|\n##\s|$)/i);
  const verify = raw.match(/#\s*verif[\s\S]*?(?=\n#\s|\n##\s|$)/i);
  if (when) chunks.push(when[0].trim());
  if (proc) chunks.push(proc[0].trim());
  if (pitfalls) chunks.push(pitfalls[0].trim());
  if (verify) chunks.push(verify[0].trim());
  if (!chunks.length) return raw.slice(0, 2000);
  return chunks.join("\n\n");
}

/**
 * Progressive disclosure — skill names/slugs only until one is matched or invoked.
 * @param {object[]} skills
 * @returns {string}
 */
export function formatSkillsCatalogBlock(skills) {
  if (!skills?.length) return "";
  const lines = [
    "AVAILABLE PRODUCTION SKILLS (user may invoke with /slug in chat):",
  ];
  for (const skill of skills) {
    const slug = skill.slug || skill.name;
    const desc = skill.description ? ` — ${String(skill.description).slice(0, 80)}` : "";
    lines.push(`- /${slug}: ${skill.name}${desc}`);
  }
  return lines.join("\n");
}

/**
 * @param {object|null} skill
 * @param {object[]} history
 * @returns {{ current: number, total: number, label: string, doneCount: number }|null}
 */
export function computeDbSkillProgress(skill, history) {
  const steps = normalizeSkillSteps(skill?.steps);
  if (!steps.length) return null;
  const total = steps.length;
  const hist = Array.isArray(history) ? history : [];
  let done = 0;
  for (let i = 0; i < steps.length; i += 1) {
    if (skillStepLikelyDone(steps[i], hist)) done = i + 1;
    else break;
  }
  const current = Math.min(done + 1, total);
  return {
    current,
    total,
    label: steps[current - 1] || steps[0],
    doneCount: done,
  };
}

/**
 * Heuristic: has history already covered this durable skill step?
 * @param {string} stepLine
 * @param {object[]} history
 * @returns {boolean}
 */
function skillStepLikelyDone(stepLine, history) {
  const step = String(stepLine || "").toLowerCase();
  if (!step) return false;
  const quoted = step.match(/"([^"]+)"/)?.[1] || "";
  if (/navigate/.test(step)) {
    const urlMatch = step.match(/https?:\/\/[^\s"]+/i);
    if (urlMatch) {
      try {
        const host = new URL(urlMatch[0]).hostname.replace(/^www\./, "");
        return history.some((h) => {
          const u = String(h?.action?.url || h?.url || "").toLowerCase();
          return u.includes(host);
        });
      } catch {
        /* fall through */
      }
    }
    return history.some((h) => String(h?.action?.type || "").toLowerCase() === "navigate");
  }
  if (/credentials|password/.test(step)) {
    return history.some((h) => {
      const t = String(h?.action?.type || "").toLowerCase();
      const n = String(h?.action?.name || "").toLowerCase();
      return (t === "type" || t === "fill") && /pass/.test(n);
    });
  }
  if (/\btype\b/.test(step)) {
    if (quoted) {
      return history.some((h) => {
        const t = String(h?.action?.type || "").toLowerCase();
        const n = String(h?.action?.name || "").toLowerCase();
        return (t === "type" || t === "fill") && n.includes(quoted.toLowerCase());
      });
    }
    return history.some((h) => /^(type|fill)$/i.test(String(h?.action?.type || "")));
  }
  if (/click/.test(step) && quoted) {
    return history.some((h) => {
      const t = String(h?.action?.type || "").toLowerCase();
      const n = String(h?.action?.name || "").toLowerCase();
      return t === "click" && n.includes(quoted.toLowerCase());
    });
  }
  if (/select|choose/.test(step)) {
    return history.some((h) => /select|choose/i.test(String(h?.action?.type || "")));
  }
  return false;
}

/**
 * Soft placeholder rules from /learn — not literal phrases that appear in the result text.
 * Why: "Goal completed successfully" was regex-tested against the summary and always failed.
 * @param {string} pat
 * @returns {boolean}
 */
function isSuccessMetaVerificationRule(pat) {
  return /^(goal\s+)?completed\s+successfully\.?$|^success\.?$|^task\s+(done|succeeded|completed)\.?$|^replay steps without error\.?$|^match success criteria\.?$/i.test(
    String(pat || "").trim()
  );
}

/**
 * Checks skill verification rules against summary + trajectory text (hint-only).
 * @param {object|null} skill
 * @param {{ success?: boolean, summary?: string, trajectory?: object[] }} ctx
 * @returns {{ passed: boolean, notes: string[], shouldFail: boolean }}
 */
export function evaluateSkillVerification(skill, ctx) {
  const rules = skill?.verificationRules || [];
  if (!rules.length) return { passed: true, notes: [], shouldFail: false };
  const blob = [
    ctx.summary || "",
    JSON.stringify(ctx.trajectory || []),
    ctx.success ? "success" : "failure",
  ]
    .join(" ")
    .toLowerCase();
  const notes = [];
  for (const rule of rules) {
    const pat = String(rule || "").trim();
    if (!pat) continue;
    // Why: learn defaults are outcome checks, not substrings of the chat result.
    if (isSuccessMetaVerificationRule(pat)) {
      if (!ctx.success) notes.push(`Rule not met: ${pat}`);
      continue;
    }
    try {
      if (!new RegExp(pat, "i").test(blob)) notes.push(`Rule not met: ${pat}`);
    } catch {
      if (!blob.includes(pat.toLowerCase())) notes.push(`Rule not met: ${pat}`);
    }
  }
  return {
    passed: notes.length === 0,
    notes,
    shouldFail: notes.length > 0 && Boolean(skill?.enforceVerification),
  };
}
