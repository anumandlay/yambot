/**
 * @fileoverview Draft goal fields from a plain-English brief via the user's LLM.
 * Purpose: Fill title, description, run instructions, and success criteria on Goal create/edit.
 * Downstream: POST /api/goals/draft-from-brief, GoalEditPage Generate with AI.
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
 *   title: string,
 *   description: string,
 *   instructions: string,
 *   successCriteria: string,
 * }}
 */
function normalizeDraft(parsed) {
  return {
    title: String(parsed?.title || parsed?.name || "")
      .trim()
      .slice(0, 120),
    description: String(parsed?.description || "").trim().slice(0, 500),
    instructions: String(parsed?.instructions || "").trim().slice(0, 8000),
    successCriteria: String(parsed?.successCriteria || "").trim().slice(0, 2000),
  };
}

/**
 * Generates goal definition fields from a user brief.
 * @param {string} userId
 * @param {string} brief
 * @returns {Promise<{ ok: true, draft: object } | { ok: false, title: string, detail: string, hint?: string }>}
 */
export async function draftGoalFromBrief(userId, brief) {
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
      detail: "Connect your LLM in Settings before generating goal fields.",
      hint: "Open Settings → LLM, save an API key or OAuth, then try again.",
    };
  }

  const system = [
    "You write YamBot Goal definitions from a short plain-English job brief.",
    "A Goal is a job assigned to an Agent (browser worker). You only draft the goal fields — not the agent persona.",
    "Return JSON only (no markdown) with keys:",
    "title, description, instructions, successCriteria.",
    "",
    "Rules:",
    "- title: short goal name (e.g. Daily weather for NYC, Find USA travel agencies).",
    "- description: one short sentence summary of the job.",
    "- instructions: concrete steps the worker should follow THIS run (numbered). Be specific.",
    "  This text is sent to the cloud agent when the user clicks Run or autonomy fires.",
    "- If the brief involves leads/CRM/database: include create_entity / search_entities / update_entity.",
    "  Entity type is fixed: lead | customer | vendor | product | process | document | ticket | custom.",
    "  Prospects: type lead, status \"new\", optional kind (airlines, corporate, travel_agency_leads), attributes email/phone/website.",
    "  Skip duplicates; skip rows without email when prospecting.",
    "- Custom datasets: type custom + kind \"<table>\" (e.g. weather) with fields in attributes.",
    "- Support: create_ticket / search_tickets / update_ticket. Email: send_email / check_email.",
    "- Do NOT invent agent names, country folders, or tell the user to pick an agent — humans assign the agent separately.",
    "- successCriteria: clear finish conditions for calling finish.",
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
  if (!draft.instructions && !draft.title && !draft.successCriteria) {
    return {
      ok: false,
      title: "Empty draft",
      detail: "The model returned no usable fields. Try rephrasing the brief.",
    };
  }

  return { ok: true, draft };
}
