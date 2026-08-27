/**
 * @fileoverview Draft agent profile fields from a plain-English brief via the user's LLM.
 * Purpose: Fill skill, persona, standing instructions (with entities), and success criteria.
 * Downstream: POST /api/agents/draft-from-brief, AgentEditPage Generate with AI.
 */

import { User } from "../models/User.js";
import { resolveLlmCredentials } from "./llmCredentials.js";
import { llmChatCompletion } from "./llmChat.js";

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
 * @param {object} parsed
 * @returns {{
 *   name: string,
 *   description: string,
 *   skill: string,
 *   profile: string,
 *   instructions: string,
 *   successCriteria: string,
 * }}
 */
function normalizeDraft(parsed) {
  return {
    name: String(parsed?.name || "").trim().slice(0, 80),
    description: String(parsed?.description || "").trim().slice(0, 300),
    skill: String(parsed?.skill || "").trim().slice(0, 2000),
    profile: String(parsed?.profile || "").trim().slice(0, 4000),
    instructions: String(parsed?.instructions || "").trim().slice(0, 8000),
    successCriteria: String(parsed?.successCriteria || "").trim().slice(0, 2000),
  };
}

/**
 * Generates agent definition fields from a user brief.
 * @param {string} userId
 * @param {string} brief
 * @returns {Promise<{ ok: true, draft: object } | { ok: false, title: string, detail: string, hint?: string }>}
 */
export async function draftAgentFromBrief(userId, brief) {
  const text = String(brief || "").trim();
  if (text.length < 8) {
    return {
      ok: false,
      title: "Brief too short",
      detail: "Describe the job in a sentence or two (at least a few words).",
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
      detail: "Connect your LLM in Settings before generating agent fields.",
      hint: "Open Settings → LLM, save an API key or OAuth, then try again.",
    };
  }

  const system = [
    "You write YamBot browser-agent definitions from a short plain-English job brief.",
    "Return JSON only (no markdown) with keys:",
    'name, description, skill, profile, instructions, successCriteria.',
    "",
    "Rules:",
    "- profile: 2–4 sentences persona (who the agent is, tone, role).",
    "- skill: one short line of what they are good at.",
    "- instructions: numbered standing rules for EVERY run. Be concrete.",
    "- If the brief involves finding/saving leads, contacts, CRM, or a database: include create_entity / search_entities / update_entity or set_entity_status.",
    "  For new leads use type lead, status \"new\", and attributes such as email, phone, address, website when available.",
    "  Tell the agent to skip duplicates and skip rows without email when prospecting.",
    "- If the brief invents a custom dataset/table (weather, inventory, surveys, …): use type custom and kind \"<table_name>\" (slug, e.g. weather).",
    "  Put the fields in attributes. Instruct create_entity and search_entities with the same kind so another agent can read that table.",
    "- If the brief involves support issues: mention create_ticket / search_tickets / update_ticket.",
    "- If the brief involves email outreach: mention send_email and status updates after send.",
    "- Do NOT mention country, territory, or agent group folders — the human assigns the group separately.",
    "- successCriteria: clear finish conditions (what must be true to call the task done).",
    "- name: short agent name if the brief implies one; else a sensible label.",
    "- description: one short sentence summary.",
  ].join("\n");

  let raw;
  try {
    raw = await llmChatCompletion({
      apiKey: creds.apiKey,
      baseUrl: creds.llmBaseUrl,
      model: creds.llmModel,
      openAiAccountId: creds.oauthAccount || "",
      temperature: 0.4,
      maxTokens: 1800,
      timeoutMs: 60_000,
      messages: [
        { role: "system", content: system },
        {
          role: "user",
          content: `Job brief:\n${text.slice(0, 4000)}\n\nReply with JSON only.`,
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
  if (!draft.instructions && !draft.profile && !draft.skill) {
    return {
      ok: false,
      title: "Empty draft",
      detail: "The model returned no usable fields. Try rephrasing the brief.",
    };
  }

  return { ok: true, draft };
}
