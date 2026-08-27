/**
 * @fileoverview Draft skill fields from a plain-English brief via the user's LLM.
 * Purpose: Fill name, slug, description, SKILL.md playbook, triggers, steps, verification.
 * Downstream: POST /api/skills/draft-from-brief, SkillEditPage Generate with AI.
 */

import { User } from "../models/User.js";
import { resolveLlmCredentials } from "./llmCredentials.js";
import { llmChatCompletion } from "./llmChat.js";
import { normalizeSkillSlug, slugFromName } from "./skillMd.js";

/**
 * @param {string} raw
 * @returns {object|null}
 */
function parseDraftJson(raw) {
  const text = String(raw || "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : text;
  try {
    return JSON.parse(candidate);
  } catch {
    const brace = candidate.match(/\{[\s\S]*\}/);
    if (!brace) return null;
    try {
      return JSON.parse(brace[0]);
    } catch {
      return null;
    }
  }
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function toStringList(value) {
  if (Array.isArray(value)) {
    return value.map((v) => String(v || "").trim()).filter(Boolean).slice(0, 40);
  }
  return String(value || "")
    .split(/\n|;/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 40);
}

/**
 * @param {object} parsed
 * @returns {{
 *   name: string,
 *   slug: string,
 *   description: string,
 *   playbookMd: string,
 *   triggers: string[],
 *   steps: string[],
 *   verificationRules: string[],
 * }}
 */
function normalizeDraft(parsed) {
  const name = String(parsed?.name || "").trim().slice(0, 80);
  const slugRaw = String(parsed?.slug || "").trim();
  const slug = normalizeSkillSlug(slugRaw) || (name ? slugFromName(name) : "");
  return {
    name,
    slug: slug.slice(0, 64),
    description: String(parsed?.description || "").trim().slice(0, 400),
    playbookMd: String(parsed?.playbookMd || parsed?.playbook || "").trim().slice(0, 12000),
    triggers: toStringList(parsed?.triggers),
    steps: toStringList(parsed?.steps),
    verificationRules: toStringList(parsed?.verificationRules || parsed?.verification),
  };
}

/**
 * Generates skill definition fields from a user brief.
 * @param {string} userId
 * @param {string} brief
 * @returns {Promise<{ ok: true, draft: object } | { ok: false, title: string, detail: string, hint?: string }>}
 */
export async function draftSkillFromBrief(userId, brief) {
  const text = String(brief || "").trim();
  if (text.length < 8) {
    return {
      ok: false,
      title: "Brief too short",
      detail: "Describe the skill in a sentence or two (at least a few words).",
    };
  }

  const user = await User.findById(userId);
  if (!user) {
    return { ok: false, title: "User missing", detail: "Could not load your account." };
  }

  const creds = await resolveLlmCredentials(user);
  if (!creds.apiKey) {
    return {
      ok: false,
      title: "LLM not configured",
      detail: "Connect your LLM in Settings before generating skill fields.",
      hint: "Open Settings → LLM, save an API key or OAuth, then try again.",
    };
  }

  const system = [
    "You write YamBot reusable Skills (browser workflow playbooks) from a short plain-English brief.",
    "A Skill injects procedure hints when triggers match a goal or page URL — it is not a full agent persona.",
    "Return JSON only (no markdown fences) with keys:",
    "name, slug, description, playbookMd, triggers, steps, verificationRules.",
    "",
    "Rules:",
    "- name: short skill label (e.g. Login to Gmail, Save travel agency lead).",
    "- slug: lowercase kebab-case for /slash invoke (e.g. gmail-login). Letters, numbers, hyphens only.",
    "- description: one sentence when this skill should apply.",
    "- playbookMd: Hermes-style markdown with EXACTLY these section headers:",
    "  # When to use",
    "  ## Procedure",
    "  ## Pitfalls",
    "  ## Verification",
    "  Procedure should be numbered concrete browser/CRM steps.",
    "- triggers: JSON array of 2–8 short substring patterns that match goal text or URLs (e.g. \"gmail.com\", \"login\", \"travel agency lead\").",
    "- steps: JSON array of short procedure lines (same as Procedure, for structured UI).",
    "- verificationRules: JSON array of success checks (what must be true when done).",
    "- If the brief involves Company entities: mention create_entity / search_entities with type/kind/status/attributes as appropriate.",
    "  Types: lead|customer|vendor|product|custom (+ kind for segments/tables).",
    "- Do NOT set status, agent, or replay click coordinates — humans control those.",
    "- Keep playbook focused and practical for a Playwright browser agent.",
  ].join("\n");

  let raw;
  try {
    raw = await llmChatCompletion({
      apiKey: creds.apiKey,
      baseUrl: creds.llmBaseUrl,
      model: creds.llmModel,
      openAiAccountId: creds.oauthAccount || "",
      temperature: 0.4,
      maxTokens: 2200,
      timeoutMs: 60_000,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Skill brief:\n${text.slice(0, 4000)}\n\nReply with JSON only.`,
        },
      ],
    });
  } catch (err) {
    return {
      ok: false,
      title: err.title || "LLM request failed",
      detail: err.message || String(err),
      hint: err.hint || "Check Settings → LLM and try again.",
    };
  }

  const parsed = parseDraftJson(raw);
  if (!parsed) {
    return {
      ok: false,
      title: "Could not parse AI response",
      detail: "The model did not return valid JSON. Try again with a clearer brief.",
    };
  }

  const draft = normalizeDraft(parsed);
  if (!draft.playbookMd && !draft.steps.length && !draft.name) {
    return {
      ok: false,
      title: "Empty draft",
      detail: "The model returned no usable fields. Try rephrasing the brief.",
    };
  }

  return { ok: true, draft };
}
