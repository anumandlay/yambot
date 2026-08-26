/**
 * @fileoverview Common-chat agent router — heuristics + optional LLM pick.
 * Purpose: Phase D auto-dispatch when user types a natural goal without @mention.
 * Downstream: `POST /api/chats/:id/messages` for common chats with `autoRoute` enabled.
 */

import { resolveLlmCredentials } from "./llmCredentials.js";
import { llmChatCompletion } from "./llmChat.js";
import { findSkillBySlash, parseSkillSlash } from "./skillSlash.js";

/** Confidence at or above this dispatches without user confirmation. */
export const ROUTER_AUTO_THRESHOLD = 0.72;

/**
 * @typedef {{ agentId: string, agentName: string, confidence: number, reason: string, source: string, needsConfirm?: boolean }} RouteResult
 */

/**
 * @param {object[]} agents
 * @param {object[]} skills
 * @param {string} goalText
 * @param {object|null} [invokedSkill]
 * @returns {RouteResult|null}
 */
export function scoreAgentsHeuristic(agents, skills, goalText, invokedSkill = null) {
  const goal = String(goalText || "").toLowerCase();
  if (!goal || !agents?.length) return null;

  /** @type {{ agentId: string, agentName: string, score: number, source: string }[]} */
  const scores = agents.map((agent) => {
    let score = 0;
    const name = String(agent.name || "").toLowerCase();
    const skill = String(agent.skill || "").toLowerCase();
    if (name && goal.includes(name)) score += 4;
    if (skill && goal.includes(skill)) score += 2;
    for (const word of name.split(/\s+/)) {
      if (word.length > 2 && goal.includes(word)) score += 1;
    }
    const notes = String(agent.instructions || "").toLowerCase().slice(0, 400);
    for (const word of notes.split(/\s+/).slice(0, 40)) {
      if (word.length > 4 && goal.includes(word)) score += 0.25;
    }
    return {
      agentId: String(agent._id),
      agentName: agent.name,
      score,
      source: "heuristic",
    };
  });

  for (const sk of skills || []) {
    let skillScore = 0;
    for (const trigger of sk.triggers || []) {
      const pat = String(trigger || "").trim();
      if (!pat) continue;
      try {
        if (new RegExp(pat, "i").test(goalText)) skillScore += 2;
      } catch {
        if (goal.includes(pat.toLowerCase())) skillScore += 1;
      }
    }
    if (sk.slug && goal.includes(String(sk.slug).replace(/-/g, " "))) skillScore += 2;
    const agentRef = sk.agent?._id || sk.agent;
    if (skillScore > 0 && agentRef) {
      const row = scores.find((s) => s.agentId === String(agentRef));
      if (row) {
        row.score += skillScore;
        row.source = "skill_match";
      }
    }
  }

  if (invokedSkill) {
    const agentRef = invokedSkill.agent?._id || invokedSkill.agent;
    if (agentRef) {
      const row = scores.find((s) => s.agentId === String(agentRef));
      if (row) {
        row.score += 12;
        row.source = "skill_invoke";
      }
    }
  }

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const second = scores[1];
  if (!best || best.score <= 0) return null;

  const gap = best.score - (second?.score || 0);
  const confidence = Math.min(0.92, 0.4 + best.score * 0.06 + (gap >= 2 ? 0.18 : gap >= 1 ? 0.08 : 0));

  return {
    agentId: best.agentId,
    agentName: best.agentName,
    confidence,
    reason: `Keyword/skill match (score ${best.score.toFixed(1)})`,
    source: best.source,
  };
}

/**
 * @param {string} raw
 * @returns {object|null}
 */
function parseRouterJson(raw) {
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
 * @param {object} user
 * @param {object[]} agents
 * @param {object[]} skills
 * @param {string} goalText
 * @returns {Promise<RouteResult|null>}
 */
export async function routeWithLlm(user, agents, skills, goalText) {
  const creds = await resolveLlmCredentials(user);
  if (!creds.apiKey) return null;

  const agentLines = agents
    .map(
      (a) =>
        `- id: ${a._id}, name: ${a.name}, skill: ${a.skill || "general"}, notes: ${String(a.instructions || "").slice(0, 100)}`
    )
    .join("\n");
  const skillLines = (skills || [])
    .slice(0, 20)
    .map((s) => {
      const agentRef = s.agent?._id || s.agent;
      return `- /${s.slug || s.name}: ${s.name}${agentRef ? ` (agent id ${agentRef})` : ""}`;
    })
    .join("\n");

  const messages = [
    {
      role: "system",
      content:
        "You route user goals to the best agent. Reply with JSON only: " +
        '{"agentId":"...","confidence":0.0-1.0,"reason":"short plain English"}',
    },
    {
      role: "user",
      content: `Agents:\n${agentLines}\n\nProduction skills:\n${skillLines || "(none)"}\n\nUser goal:\n${goalText}`,
    },
  ];

  const raw = await llmChatCompletion({
    apiKey: creds.apiKey,
    baseUrl: creds.llmBaseUrl,
    model: creds.llmModel,
    openAiAccountId: creds.openAiAccountId,
    messages,
    temperature: 0,
    maxTokens: 180,
    timeoutMs: 18_000,
  });

  const parsed = parseRouterJson(raw);
  if (!parsed?.agentId) return null;
  const agent = agents.find((a) => String(a._id) === String(parsed.agentId));
  if (!agent) return null;

  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0.5));
  return {
    agentId: String(agent._id),
    agentName: agent.name,
    confidence,
    reason: String(parsed.reason || "LLM router pick").slice(0, 200),
    source: "llm",
  };
}

/**
 * Picks an agent for a common-chat goal.
 * @param {{ user: object, agents: object[], skills: object[], goalText: string, invokedSkill?: object|null, threshold?: number }} opts
 * @returns {Promise<RouteResult|null>}
 */
export async function routeCommonChat(opts) {
  const threshold = opts.threshold ?? ROUTER_AUTO_THRESHOLD;
  const goalText = String(opts.goalText || "").trim();
  if (!goalText || !opts.agents?.length) return null;

  const heuristic = scoreAgentsHeuristic(
    opts.agents,
    opts.skills,
    goalText,
    opts.invokedSkill || null
  );

  let pick = heuristic;
  const needsLlm =
    !heuristic || heuristic.confidence < threshold || heuristic.source === "heuristic";

  if (needsLlm) {
    try {
      const llmPick = await routeWithLlm(opts.user, opts.agents, opts.skills || [], goalText);
      if (llmPick) {
        if (!heuristic || llmPick.confidence >= heuristic.confidence) {
          pick = llmPick;
        }
      }
    } catch {
      /* keep heuristic */
    }
  }

  if (!pick) return null;
  return {
    ...pick,
    needsConfirm: pick.confidence < threshold,
  };
}

/**
 * Resolves slash-invoked skill early for routing (before agent pick).
 * @param {string} userId
 * @param {string} goalText
 * @param {import('mongoose').Model} Skill
 */
export async function resolveInvokedSkillForGoal(userId, goalText, Skill) {
  const slash = parseSkillSlash(goalText);
  if (!slash) return { goalText, invokedSkill: null, skillSlashMeta: null };
  const skills = await Skill.find({ user: userId, status: "production" })
    .select("name slug triggers description agent")
    .lean();
  const invoked = findSkillBySlash(skills, slash.slug);
  if (!invoked) return { goalText, invokedSkill: null, skillSlashMeta: null, slashError: slash.slug };
  return {
    goalText: slash.goal || invoked.description || invoked.name,
    invokedSkill: invoked,
    skillSlashMeta: {
      slug: slash.slug,
      skillId: invoked._id,
      skillName: invoked.name,
    },
  };
}
